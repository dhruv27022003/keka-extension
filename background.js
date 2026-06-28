// background.js (Manifest V3 service worker)
//
// Responsibilities:
//  1. Trigger a "Mark as Clock-In" popup window when Chrome starts up.
//  2. If Chrome was already running, trigger the same popup on the next
//     new tab opened (once per browser session, unless the user enabled
//     "always show" in settings).
//  3. Fetch the freshest possible Keka access token (prefer reading it
//     live from an open hr.keka.com tab; fall back to the last cached
//     value synced by content.js, or a manually pasted override token).
//  4. Perform the actual clock-in POST request to Keka's API.

const KEKA_ORIGIN = "https://hr.keka.com";
const CLOCKIN_URL =
  "https://hr.keka.com/k/attendance/api/mytime/attendance/webclockin";
const DEFAULT_TOKEN_KEY = "access_token";

// ---------- Helpers ----------

function todayString() {
  return new Date().toDateString();
}

async function isAlreadyClockedInToday() {
  const { lastClockinDate } = await chrome.storage.local.get(
    "lastClockinDate"
  );
  return lastClockinDate === todayString();
}

// Reads the token straight out of an open hr.keka.com tab's localStorage,
// falling back to the cached / manually-entered token if no tab is open
// or the read fails for any reason.
async function getFreshToken() {
  try {
    const tabs = await chrome.tabs.query({ url: `${KEKA_ORIGIN}/*` });
    if (tabs.length > 0) {
      const { tokenKey } = await chrome.storage.local.get("tokenKey");
      const keyHint = tokenKey || DEFAULT_TOKEN_KEY;

      const results = await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: (keyHint) => {
          function extractToken(keyHint) {
            try {
              if (keyHint) {
                const direct = localStorage.getItem(keyHint);
                if (direct) return direct;
              }
              for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.toLowerCase().includes("token")) {
                  const v = localStorage.getItem(k);
                  if (v && v.length > 20) return v;
                }
              }
            } catch (e) {}
            return null;
          }
          return extractToken(keyHint);
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

  // Fall back to a manually entered override, then the last cached value.
  const { manualToken, kekaToken } = await chrome.storage.local.get([
    "manualToken",
    "kekaToken",
  ]);
  if (manualToken) return manualToken;
  if (kekaToken) return kekaToken;
  return null;
}

// Performs the actual clock-in call against Keka's API.
// Note is always fixed (no user input) per the simplified, fully automatic flow.
async function doClockin() {
  const token = await getFreshToken();
  if (!token) {
    return {
      success: false,
      message:
        "No Keka access token found. Open hr.keka.com, log in, then try again.",
    };
  }

  const finalNote = "Clockin marked automatically";

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
        note: finalNote,
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
    try {
      bodyText = (await response.text()).slice(0, 200);
    } catch (e) {}

    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        message:
          "Clock-in failed: your session/token has expired. Open hr.keka.com, log in again, then retry.",
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

// Opens (or focuses, if already open) the small popup window that asks
// the user to "Mark as Clock-In" / shows the missing-token warning.
async function showReminderPopup() {
  const { reminderWindowId } = await chrome.storage.session.get(
    "reminderWindowId"
  );

  if (reminderWindowId) {
    try {
      await chrome.windows.update(reminderWindowId, { focused: true });
      return;
    } catch (e) {
      // window no longer exists - fall through and create a new one
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

// 1) Fires once, right when Chrome itself starts up.
chrome.runtime.onStartup.addListener(async () => {
  await chrome.storage.session.set({ shownThisSession: false });
  const alreadyDone = await isAlreadyClockedInToday();
  if (!alreadyDone) {
    await showReminderPopup();
    await chrome.storage.session.set({ shownThisSession: true });
  }
});

// 2) If Chrome was already open, fire on the next new tab instead
//    (once per session by default, or every new tab if the user
//    enabled "always show" in Settings).
chrome.tabs.onCreated.addListener(async (tab) => {
  try {
    const ownPrefix = chrome.runtime.getURL("");
    if (
      (tab.url && tab.url.startsWith(ownPrefix)) ||
      (tab.pendingUrl && tab.pendingUrl.startsWith(ownPrefix))
    ) {
      return; // ignore our own reminder popup window/tab
    }
  } catch (e) {}

  const { shownThisSession } = await chrome.storage.session.get(
    "shownThisSession"
  );
  const { settings } = await chrome.storage.local.get("settings");
  const alwaysShow = !!(settings && settings.alwaysShowOnNewTab);

  // Never show the reminder once today's clock-in is already marked.
  const alreadyDone = await isAlreadyClockedInToday();
  if (alreadyDone) return;

  if (shownThisSession && !alwaysShow) return;

  await showReminderPopup();
  if (!alwaysShow) {
    await chrome.storage.session.set({ shownThisSession: true });
  }
});

// ---------- Messaging with popup.js / options.js ----------

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
      sendResponse({
        hasToken: !!token,
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
  return true; // keep the message channel open for the async response
});
