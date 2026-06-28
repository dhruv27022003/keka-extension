// content.js
// Runs on https://hr.keka.com/* pages.
// Job: passively read the access token out of this page's localStorage
// and cache it in chrome.storage.local so the background service worker
// can use it later, even when no Keka tab is open.

(function () {
  const DEFAULT_KEY = "access_token";

  // Tries the configured key first, then falls back to scanning all
  // localStorage keys for anything that looks like a token.
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
          // crude sanity check - JWTs / bearer tokens are long strings
          if (v && v.length > 20) return v;
        }
      }
    } catch (e) {
      // localStorage may be unavailable in rare edge cases (e.g. sandboxed frame)
    }
    return null;
  }

  function syncToken() {
    chrome.storage.local.get(["tokenKey"], (res) => {
      const keyHint = res.tokenKey || DEFAULT_KEY;
      const token = extractToken(keyHint);
      if (token) {
        chrome.storage.local.set({
          kekaToken: token,
          tokenUpdatedAt: Date.now(),
          tokenSource: "content-script",
        });
      }
    });
  }

  // Sync immediately, then keep syncing periodically while this tab
  // stays open (cheap - just reads localStorage), and on storage events
  // (covers SPA navigation / token refresh in another tab on same origin).
  syncToken();
  const intervalId = setInterval(syncToken, 5000);
  window.addEventListener("storage", syncToken);
  window.addEventListener("beforeunload", () => clearInterval(intervalId));
})();
