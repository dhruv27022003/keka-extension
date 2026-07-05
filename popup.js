// popup.js
//
// Fully automatic: no note input, no manual button.
//
// Flow on open:
//   1. GET_STATUS from background.
//   2. No token  → show warning card (no API call).
//   3. Token OK, clockin not needed (fresh today) → show "already clocked in" status.
//   4. Token OK, clockin needed (not done yet OR stale > 6 hrs) → call DO_CLOCKIN.

document.addEventListener("DOMContentLoaded", init);

function sendMessage(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

function fmt(isoString) {
  if (!isoString) return "";
  return new Date(isoString).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function init() {
  const statusEl   = document.getElementById("status");
  const warningBox = document.getElementById("warningBox");
  const resultBox  = document.getElementById("resultBox");
  const openKekaBtn = document.getElementById("openKekaBtn");
  const retryBtn   = document.getElementById("retryBtn");
  const optionsLink = document.getElementById("optionsLink");

  openKekaBtn.addEventListener("click", () =>
    chrome.tabs.create({ url: "https://hr.keka.com/" })
  );
  retryBtn.addEventListener("click", run);
  optionsLink.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  async function run() {
    // Reset UI to loading state.
    statusEl.textContent = "Checking your Keka session…";
    statusEl.classList.remove("hidden");
    warningBox.classList.add("hidden");
    resultBox.classList.add("hidden");
    resultBox.className = "result hidden";

    const status = await sendMessage({ type: "GET_STATUS" });

    if (!status || !status.hasToken) {
      statusEl.classList.add("hidden");
      warningBox.classList.remove("hidden");
      return;
    }

    // Clock-in is current — nothing to do.
    if (!status.clockinNeeded) {
      statusEl.textContent = status.lastClockinTime
        ? `✅ Already clocked in today at ${fmt(status.lastClockinTime)}`
        : "✅ Already clocked in today";
      return;
    }

    // Clock-in is needed (first time today, or stale > 6 hours).
    const isStale = status.clockinReason === "stale";
    statusEl.textContent = isStale
      ? `Last clockin was over 6 hours ago (${fmt(status.lastClockinTime)}). Re-clocking in…`
      : "Session found. Marking your attendance…";

    const result = await sendMessage({ type: "DO_CLOCKIN" });

    statusEl.classList.add("hidden");
    resultBox.classList.remove("hidden");

    if (result && result.success) {
      resultBox.textContent = isStale
        ? "Clockin is marked (re-clocked after 6 hrs)"
        : "Clockin is marked";
      resultBox.className = "result success";
    } else {
      resultBox.textContent =
        (result && result.message) || "Clockin could not be marked.";
      resultBox.className = "result error";
    }
  }

  run();
}
