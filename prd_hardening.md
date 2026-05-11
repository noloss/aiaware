# PRD — Security & Robustness Hardening

## Background

AI Aware is a zero-network Chrome extension that detects and masks sensitive
data before it is sent to AI chat services. A security review identified
several hardening opportunities. This PRD covers the practical, high-value
items only — it deliberately excludes suggestions that are premature or
disproportionate (WASM NER, PBKDF2 storage encryption, SBOM pipeline).

---

## Issues to implement

### H1 — Validate URLs and message senders in background.js

**Problem:** `background.js` receives `{ type: 'openTab', url }` from any
content script but (a) does not verify the sender and (b) passes the URL
directly to `chrome.tabs.create()` without checking the scheme.

**Fix:**
- In the `chrome.runtime.onMessage` listener, verify `sender.id ===
  chrome.runtime.id` to reject messages from unknown senders.
- Before calling `chrome.tabs.create()`, reject any URL whose scheme is not
  `http:` or `https:` (guard against `javascript:`, `data:`, `file:` URIs).

**File:** `extension/background.js`

---

### H2 — Add explicit Content Security Policy to manifest.json

**Problem:** No CSP is declared; the extension relies on Chrome MV3 defaults.
An explicit policy is defence-in-depth.

**Fix:** Add to `manifest.json`:
```json
"content_security_policy": {
  "extension_pages": "default-src 'self'; script-src 'self'; object-src 'none';"
}
```

**File:** `extension/manifest.json`

---

### H3 — Audit regex patterns in dlp.js for ReDoS

**Problem:** `dlp.js` contains 25+ regex patterns. Some (especially the
credit card pattern `\b\d[\d \t\-]{11,20}\d\b` and the IBAN pattern
`\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b`) use nested quantifiers or wide character
classes that could cause exponential backtracking on adversarially crafted
input.

**Fix:**
- Review each pattern for catastrophic backtracking.
- Rewrite any dangerous pattern to be unambiguous (anchor groups, use
  possessive quantifiers where possible, or split into two passes).
- Add a 50 ms `setTimeout`-based guard: if `scanText()` takes longer than
  50 ms, abort and log a warning rather than hanging the tab.

**File:** `extension/dlp.js`

---

### H4 — Encapsulate modal and DLP banner in Shadow DOM

**Problem:** The warning modal (`modal.js`), the DLP banner, and the intercept
popup are injected as plain DOM elements. The host page's CSS can leak into
them, breaking the layout and potentially making them unreadable or invisible.

**Fix:**
- Create a single `<div id="aa-shadow-host">` appended to `document.body`.
- Attach an open Shadow DOM to it (`host.attachShadow({ mode: 'open' })`).
- Inject all extension UI (modal overlay, DLP banner, intercept popup) inside
  the shadow root.
- Move `modal.css` and the banner/highlight styles into the shadow root so
  they are scoped and cannot be overridden by host-page stylesheets.

**Files:** `extension/modal.js`, `extension/dlp.js`, `extension/modal.css`,
`extension/dlp.css`

---

### H5 — Local audit log: history panel in popup

**Problem:** Users have no visibility into what the extension has done. This
reduces trust and makes debugging difficult.

**Fix:**
- In `dlp.js`, when a scan finds hits, append a compact record to
  `chrome.storage.local` under key `aa-audit-log` (max 50 entries, FIFO):
  `{ ts: Date.now(), severity, labels: ['email address', ...], host }`.
  Never store the actual matched text — only the label and severity.
- In `popup/popup.js` and `popup/popup.html`, add a "Recent activity" section
  that reads and displays the last 10 log entries in human-readable form
  (e.g. "Today 14:32 — High: API key on claude.ai").
- Add a "Clear history" button.

**Files:** `extension/dlp.js`, `extension/popup/popup.js`,
`extension/popup/popup.html`

---

## Out of scope (deliberately excluded)

- WASM-based NER model — disproportionate complexity for current stage
- PBKDF2 encrypted storage — extension stores no PII; nothing sensitive to encrypt
- Synthetic data generator — out of scope
- SBOM / CI vulnerability scanning — premature
- `chrome.alarms` memory clearing — background script holds no sensitive state
