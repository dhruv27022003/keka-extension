# Keka Clock-In Reminder (Chrome Extension)

Automatically clocks you in on Keka:
- **When Chrome starts up** → if you haven't clocked in yet today, a small popup window opens and **calls the Keka clock-in API automatically** — no button to click, no note to type.
- **If Chrome is already open**, the same thing happens the next time you open a **new tab** (once per session by default — see Settings).
- **If you've already clocked in today**, the popup does not appear at all.
- If your Keka session/token can't be found, the popup shows a clear **warning** instead, with a button to open hr.keka.com.

It calls Keka's own `webclockin` API directly using the access token from your browser session, with the note always set to `"Clockin marked automatically"`. Nothing is sent anywhere except `hr.keka.com`.

The UI theme (colors, gradients) matches Keka's own dashboard — indigo/purple header, dark navy background, amber warning accents.

---

## 1. Install (load unpacked)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select this `Keka-clockin` folder.
5. The extension icon (a purple clock) should appear in your toolbar.

## 2. One-time setup

1. Open `hr.keka.com` in a tab and log in normally.
2. Click the extension icon → it should detect your session and automatically mark "Clockin is marked".
3. If it instead shows a warning ("No Keka session found"):
   - Open DevTools on hr.keka.com (`F12`) → **Application** tab → **Local Storage** → `hr.keka.com`.
   - Find the key that holds your access/bearer token.
   - Right-click the extension icon → **Options**, and enter that exact key name under **"LocalStorage key on hr.keka.com"** (default guess is `access_token`).
   - The extension also auto-scans for any key containing "token" as a fallback, so this is usually only needed if detection fails.

That's it — from now on it works automatically.

## 3. How the triggers work

| Situation | What happens |
|---|---|
| Chrome launches, not yet clocked in today | `chrome.runtime.onStartup` fires → popup opens → API call happens automatically → shows "Clockin is marked" |
| Chrome was already open, you open a new tab, not yet clocked in today | `chrome.tabs.onCreated` fires → same automatic flow (once per session by default) |
| Already clocked in today | **No popup at all** — the trigger is skipped entirely |
| You click the toolbar icon any time | Same popup opens manually; if already clocked in today it just shows that status instead of calling the API again |
| No valid token found | Popup shows a warning instead of attempting the call |

Chrome's extension model doesn't allow a fully invisible background action — showing a small popup is the closest equivalent to "automatic" that Chrome's APIs allow, but no click is required inside it.

## 4. How the token is fetched

- A **content script** runs quietly on any `hr.keka.com` tab you have open and caches the token in `chrome.storage.local` (local to your machine only).
- When the API call fires, the background service worker tries to read the **freshest** token directly from an open Keka tab (via `chrome.scripting.executeScript`). If no Keka tab is open, it falls back to the last cached token, or a manually pasted override token from Settings.
- Access tokens are usually short-lived (JWTs). If clock-in fails with an auth error, just refresh/re-login on `hr.keka.com` and try again on the next trigger (or click the toolbar icon).

## 5. Settings (right-click icon → Options)

- **LocalStorage key** — override the exact key name if auto-detection doesn't find your token.
- **Manual token override** — paste a token directly as a last-resort fallback.
- **Always show on new tab** — show the reminder on every new tab instead of once per session (still suppressed once today's clock-in is marked).
- **Clear all extension data** — wipes cached tokens/history/settings.

## 6. Files

```
Keka-clockin/
├── manifest.json     Extension configuration (Manifest V3)
├── background.js     Triggers, token lookup, and the actual API call
├── content.js         Passive token sync running on hr.keka.com
├── popup.html/.js/.css  The auto-clockin popup UI (Keka purple theme)
├── options.html/.js   Settings page
└── icons/             Toolbar/extension icons (purple, matching Keka)
```

## 7. Privacy & security notes

- Your token is stored only in `chrome.storage.local` on your own machine — it is never sent anywhere except in the `Authorization` header of the request to `hr.keka.com`, exactly as your browser would do anyway when using Keka normally.
- The extension only has host permission for `hr.keka.com` — it cannot read data from any other site.
- This is an unpacked/personal-use extension, not published to the Chrome Web Store; loading it requires Developer mode.

