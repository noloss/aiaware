# Prompt Masker

Chrome extension that guards users against accidentally leaking sensitive data (API keys, credit cards, personal information) to AI chat services. The extension monitors the input field in real time and warns before data is sent.

**Zero-Network principle:** Prompt Masker never sends data over the network. Text you type never leaves your device.

**Target users:**
- Developers who copy-paste code and keys into chat
- Business users who handle personal data
- Anyone who uses Claude.ai, Gemini, or ChatGPT daily

GitHub repo: **noloss/promptmasker**

Product requirements live in **prd.md** (and release-specific PRDs such as `prd_hardening.md`).
Read those files for detailed feature requirements before implementing anything.

## Dev environment

Always activate venv before running Python:
```bash
source venv/bin/activate
```

gh CLI: `~/.local/bin/gh` (add to PATH if needed: `export PATH="$HOME/.local/bin:$PATH"`)

## Directory structure

```
extension/            # Chrome extension — all deliverable code lives here
  manifest.json       # Manifest V3
  content.js          # Entry point injected into AI sites
  background.js       # Service worker (openTab message handler)
  dlp.js              # DLP engine: scan, banner, send intercept
  dlp.css             # Banner styles (position:fixed, pm- prefix)
  modal.js            # Link-click warning overlay
  modal.css
  highlight.js        # In-field sensitive-text highlight engine
  audit.js            # Audit log → chrome.storage.local key "aa-audit-log"
  icons/              # icon16/48/128.png
  popup/
    popup.html        # Extension popup
    popup.js
    popup.css
  store/              # Chrome Web Store assets
framework/            # Agent pipeline — not shipped in the extension
  planner.py          # PRD → GitHub Issues
  coder.py            # Issue → branch + code + PR
  reviewer.py         # PR → review + approve/request changes
  run_release.py      # Batch runner: --release <label> runs coder+reviewer loop
  github.py           # gh CLI wrapper
  config.py           # Env vars (GITHUB_REPO etc.)
  prompts/            # System prompts for each agent
    coder.txt
    planner.txt
    reviewer.txt
    splitter.txt
prd.md                # Main product requirements
prd_hardening.md      # Security hardening requirements (Release hardening)
```

## Agent pipeline

```bash
python framework/planner.py                      # Create GitHub Issues from a PRD file
python framework/coder.py --issue <N>            # Implement issue on a branch + open PR
python framework/reviewer.py --pr <N>            # Review PR, approve or request changes
python framework/run_release.py --release <label> # Run full coder+reviewer loop for a label
```

The coder agent runs as a `claude --print --dangerously-skip-permissions` subprocess so it has
full Claude Code tooling (file editing, bash, git) available. It auto-loads CLAUDE.md and the
PRD files from the working directory.

## Extension architecture

**Shadow DOM isolation**
All extension UI (banner, modal, highlight backdrop) is appended to `window.__pmShadowRoot`,
a Shadow DOM host created by `content.js`. This prevents the host page's CSS from leaking in.
Use `getSR()` (defined in `dlp.js`) to get the shadow root or fall back to `document.body`.

**CSS/ID prefix**
All extension CSS classes and IDs use the `pm-` prefix (e.g. `pm-dlp-banner`, `pm-overlay`).
Data attributes use `data-pm-hl` for highlight spans.

**Window globals**
- `window.promptMaskerHighlight` — `{ highlightText, clearHighlights }` (highlight.js)
- `window.promptMasker` — main DLP API exposed by dlp.js

**Storage**
`chrome.storage.local` only. Audit log key: `"aa-audit-log"` (FIFO, max 50 entries).
No backend, no network calls — Zero-Network principle.

**Banner positioning**
The DLP banner is `position:fixed`, anchored below the full composer element (input field +
send button). `findComposerEl()` in dlp.js walks up the DOM until it finds an ancestor that
contains a submit button, capturing the full toolbar area.

**Send intercept**
`_hasHighAlert` flag (module-level in dlp.js) decouples the Security Intercept popup from
banner visibility. Dismissing the banner does not suppress the intercept.

## Supported sites

- claude.ai
- gemini.google.com
- chat.openai.com / chatgpt.com

## Language

All UI text, code comments, agent prompts, and GitHub issues must be in **English**.
No Finnish text anywhere in the extension or framework.

## Technical constraints

- JavaScript ES6+ only — no TypeScript
- Manifest V3
- No backend — all data stays in `chrome.storage.local`
- Do not break or hide the host platform's native UI (Claude, Gemini, ChatGPT)
- CSP: `"extension_pages": "default-src 'self'; script-src 'self'; object-src 'none';"`
