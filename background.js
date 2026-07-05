// background.js (Manifest V3 service worker)

const KEKA_ORIGIN = "https://hr.keka.com";
const CLOCKIN_URL =
  "https://hr.keka.com/k/attendance/api/mytime/attendance/webclockin";
const DEFAULT_TOKEN_KEY = "access_token";

// How long after a successful clockin before we treat it as "stale"
// and hit the API again (6 hours in milliseconds).
const RECLOCKIN_AFTER_MS = 6 * 60 * 60 * 1000;

// ---------- State helpers ----------

function todayString() {
  return new Date().toDateString();
}

// Returns an object describing the current clockin state:
//   { needed: bool, reason: string }
//
// "needed" is true in two cases:
//   1. Not clocked in at all today.
//   2. Clocked in today but more than RECLOCKIN_AFTER_MS ago (stale).
async function getClockinState() {
  const { lastClockinDate, lastClockinTime } = await chrome.storage.local.get([
    "lastClockinDate",
    "lastClockinTime",
  ]);

  // Case 1: never clocked in today.
  if (lastClockinDate !== todayString()) {
    return { needed: true, reason: "not_clocked_in" };
  }

  // Case 2: clocked in today but stale (> 6 hours ago).
  if (lastClockinTime) {
    const elapsed = Date.now() - new Date(lastClockinTime).getTime();
    if (elapsed > RECLOCKIN_AFTER_MS) {
      return { needed: true, reason: "stale", elapsed };
    }
  }

  return { needed: false, reason: "ok" };
}

// ---------- Token helpers ----------

async function getFreshToken() {
  try {
    const tabs = await chrome.tabs.query({ url: `${KEKA_ORIGIN}/*` });
    if (tabs.length > 0) {
      const { tokenKey } = await chrome.storage.local.get("tokenKey");
      const keyHint = tokenKey || DEFAULT_TOKEN_KEY;

      const results = await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: (keyHint) => {
          function extractToken(k) {
            try {
              const direct = localStorage.getItem(k);
              if (direct) return direct;
              for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.toLowerCase().includes("token")) {
                  const v = localStorage.getItem(key);
                  if (v && v.length > 20) return v;
                }
              }
            } catch (e) {}
            return null;
          }
          return extractToken(k);
        },
        args: [keyHint],
      });

      const liveToken = results && results[0] && results[0].result;
      if (liveToken) {
        await chrome.storage.local.set({
          kekaToken: liveToken,
          tokenUpdatedAt: Date.now(),
          tokenSource: "live",
        });
        return liveToken;
      }
    }
  } catch (e) {
    console.warn("[Keka Clock-In] Live token read failed:", e);
  }

  const { manualToken, kekaToken } = await chrome.storage.local.get([
    "manualToken",
    "kekaToken",
  ]);
  if (manualToken) return manualToken;
  if (kekaToken) return kekaToken;
  return null;
}

// ---------- Clock-in API call ----------

async function doClockin() {
  const token = await getFreshToken();
  if (!token) {
    return {
      success: false,
      message:
        "No Keka access token found. Open hr.keka.com, log in, then try again.",
    };
  }

  try {
    const response = await fetch(CLOCKIN_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        attendanceLogSource: 1,
        locationAddress: null,
        manualClockinType: 1,
        note: "Clockin marked automatically",
        originalPunchStatus: 0,
      }),
    });

    if (response.ok) {
      await chrome.storage.local.set({
        lastClockinDate: todayString(),
        lastClockinTime: new Date().toISOString(),
      });
      try {
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icons/icon128.png",
          title: "Keka Clock-In",
          message: "Clockin is marked.",
        });
      } catch (e) {}
      return { success: true, message: "Clockin is marked" };
    }

    let bodyText = "";
    try { bodyText = (await response.text()).slice(0, 200); } catch (e) {}

    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        message:
          "Clock-in failed: session/token has expired. Open hr.keka.com, log in again.",
      };
    }

    return {
      success: false,
      message: `Clock-in failed (HTTP ${response.status}). ${bodyText}`,
    };
  } catch (err) {
    return {
      success: false,
      message: "Network error while clocking in: " + err.message,
    };
  }
}

// ---------- Popup window management ----------
//
// We track the reminder window id in session storage so we can re-focus
// it instead of spawning a second one. When the window is closed by the
// user we clear the stored id so the next trigger opens a fresh window.

async function showReminderPopup() {
  const { reminderWindowId } = await chrome.storage.session.get(
    "reminderWindowId"
  );

  if (reminderWindowId) {
    try {
      await chrome.windows.update(reminderWindowId, { focused: true });
      return;
    } catch (e) {
      // window is gone — fall through and open a new one
    }
  }

  const win = await chrome.windows.create({
    url: chrome.runtime.getURL("popup.html"),
    type: "popup",
    width: 380,
    height: 480,
    focused: true,
  });
  await chrome.storage.session.set({ reminderWindowId: win.id });
}

chrome.windows.onRemoved.addListener(async (windowId) => {
  const { reminderWindowId } = await chrome.storage.session.get(
    "reminderWindowId"
  );
  if (reminderWindowId === windowId) {
    await chrome.storage.session.remove("reminderWindowId");
  }
});

// ---------- Triggers ----------

// Helper used by both onStartup and tabs.onCreated.
// Decides whether to open the popup and does so if needed.
async function maybeShowPopup(tabUrl) {
  // Never trigger for our own extension pages.
  try {
    const ownPrefix = chrome.runtime.getURL("");
    if (tabUrl && tabUrl.startsWith(ownPrefix)) return;
  } catch (e) {}

  const state = await getClockinState();

  if (!state.needed) return; // today is fine and not stale — do nothing

  await showReminderPopup();
}

// 1) Chrome just launched.
chrome.runtime.onStartup.addListener(async () => {
  await maybeShowPopup(null);
});

// 2) A new tab was opened (covers the case where Chrome was already running).
//    We check on EVERY new tab — no shownThisSession gate — so a missed or
//    failed clock-in will be retried on the very next tab the user opens.
chrome.tabs.onCreated.addListener(async (tab) => {
  await maybeShowPopup(tab.url || tab.pendingUrl || "");
});

// ---------- Messaging ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === "GET_STATUS") {
      const token = await getFreshToken();
      const { lastClockinDate, lastClockinTime, tokenSource } =
        await chrome.storage.local.get([
          "lastClockinDate",
          "lastClockinTime",
          "tokenSource",
        ]);
      const state = await getClockinState();
      sendResponse({
        hasToken: !!token,
        clockinNeeded: state.needed,
        clockinReason: state.reason,
        alreadyClockedInToday: lastClockinDate === todayString(),
        lastClockinTime: lastClockinTime || null,
        tokenSource: tokenSource || null,
      });
    } else if (msg.type === "DO_CLOCKIN") {
      const result = await doClockin();
      sendResponse(result);
    } else {
      sendResponse({ error: "Unknown message type" });
    }
  })();
  return true;
});
