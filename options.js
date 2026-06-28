// options.js

document.addEventListener("DOMContentLoaded", load);

async function load() {
  const { settings, tokenKey, manualToken } = await chrome.storage.local.get(
    ["settings", "tokenKey", "manualToken"]
  );

  document.getElementById("tokenKey").value = tokenKey || "access_token";
  document.getElementById("manualToken").value = manualToken || "";
  document.getElementById("alwaysShow").checked = !!(
    settings && settings.alwaysShowOnNewTab
  );

  document.getElementById("saveBtn").addEventListener("click", save);
  document
    .getElementById("clearDataBtn")
    .addEventListener("click", clearAllData);
  document.getElementById("checkBtn").addEventListener("click", checkToken);
}

async function save() {
  const tokenKeyVal =
    document.getElementById("tokenKey").value.trim() || "access_token";
  const manualTokenVal = document.getElementById("manualToken").value.trim();
  const alwaysShow = document.getElementById("alwaysShow").checked;

  await chrome.storage.local.set({
    tokenKey: tokenKeyVal,
    manualToken: manualTokenVal,
    settings: { alwaysShowOnNewTab: alwaysShow },
  });

  const status = document.getElementById("saveStatus");
  status.textContent = "Settings saved!";
  setTimeout(() => (status.textContent = ""), 2500);
}

async function clearAllData() {
  if (
    !confirm(
      "This will clear all saved tokens, history, and settings. Continue?"
    )
  ) {
    return;
  }
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  location.reload();
}

function checkToken() {
  const statusEl = document.getElementById("checkStatus");
  statusEl.style.color = "";
  statusEl.textContent = "Checking…";
  chrome.runtime.sendMessage({ type: "GET_STATUS" }, (res) => {
    if (!res) {
      statusEl.textContent = "Could not reach extension background.";
      return;
    }
    if (res.hasToken) {
      statusEl.style.color = "#5ee0a4";
      statusEl.textContent = `✅ Token found (source: ${
        res.tokenSource || "cached"
      }).`;
    } else {
      statusEl.style.color = "#f29b9b";
      statusEl.textContent =
        "⚠️ No token found. Open hr.keka.com and log in, then check again.";
    }
  });
}
