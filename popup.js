// popup.js
//
// No note input, no manual button. On open this popup:
//   1. Checks if a Keka session/token is available -> if not, shows a warning.
//   2. Checks if already clocked in today -> if so, just shows that status.
//   3. Otherwise, calls the clock-in API automatically and shows the result.

document.addEventListener("DOMContentLoaded", init);

function sendMessage(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

async function init() {
  const statusEl = document.getElementById("status");
  const warningBox = document.getElementById("warningBox");
  const resultBox = document.getElementById("resultBox");
  const openKekaBtn = document.getElementById("openKekaBtn");
  const retryBtn = document.getElementById("retryBtn");
  const optionsLink = document.getElementById("optionsLink");

  openKekaBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: "https://hr.keka.com/" });
  });
  retryBtn.addEventListener("click", run);
  optionsLink.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  async function run() {
    statusEl.classList.remove("hidden");
    statusEl.textContent = "Checking your Keka session…";
    warningBox.classList.add("hidden");
    resultBox.classList.add("hidden");

    const status = await sendMessage({ type: "GET_STATUS" });

    if (!status || !status.hasToken) {
      statusEl.classList.add("hidden");
      warningBox.classList.remove("hidden");
      return;
    }

    if (status.alreadyClockedInToday) {
      const t = status.lastClockinTime
        ? new Date(status.lastClockinTime).toLocaleTimeString()
        : "";
      statusEl.textContent = t
        ? `✅ Already clocked in today at ${t}`
        : "✅ Already clocked in today";
      return;
    }

    // Token available and not yet clocked in today -> call the API directly.
    statusEl.textContent = "Marking your attendance…";
    const result = await sendMessage({ type: "DO_CLOCKIN" });

    statusEl.classList.add("hidden");
    resultBox.classList.remove("hidden");

    if (result && result.success) {
      resultBox.textContent = "Clockin is marked";
      resultBox.className = "result success";
    } else {
      resultBox.textContent =
        (result && result.message) || "Clockin could not be marked.";
      resultBox.className = "result error";
    }
  }

  run();
}
