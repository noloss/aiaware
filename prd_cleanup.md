# PRD: Pre-Release Cleanup & Hardening (v0.1 launch)

## Overview
Final cleanup pass before Chrome Web Store submission. Fixes one accessibility gap in the popup, removes internal dev comments from public code, corrects two DLP engine bugs (one a ReDoS vulnerability, one a false-positive source), and adds a defensive guard to the Mask & Send flow.

---

## Issues to create

### Issue 1 — Remove internal dev comment from popup.html
**Label:** cleanup  
**File:** `extension/popup/popup.html`

Remove the HTML comment block (lines 32–40) that references internal ticket Issue #36, Finnish text, and CLAUDE.md. This is internal development history that must not appear in publicly shipped code.

**Acceptance criteria:**
- The comment block starting with `<!-- Issue #36 AC specified...` is deleted entirely.
- The Zero-Network `<section>` it precedes is unchanged and still renders correctly.

---

### Issue 2 — Add :focus-visible style to popup Clear History button
**Label:** cleanup  
**File:** `extension/popup/popup.css`

The `Mask & Send` and `Continue anyway` buttons in `modal.css` have proper `:focus-visible` outlines for keyboard navigation. The popup's `Clear history` button (`.pm-btn-clear`) has a `:hover` state but no `:focus-visible`, breaking keyboard accessibility.

Add after the existing `.pm-btn-clear:hover` rule:
```css
.pm-btn-clear:focus-visible {
  outline: 3px solid #6366f1;
  outline-offset: 2px;
}
```

**Acceptance criteria:**
- Tabbing to the Clear history button shows a visible purple focus ring.
- Hover behaviour is unchanged.

---

### Issue 3 — Update privacy policy "Last updated" date
**Label:** cleanup  
**File:** `extension/privacy_policy.html`

The "Last updated" date in the privacy policy header reads `2026-05-10`. Update it to `2026-05-14`.

**Acceptance criteria:**
- The date string `2026-05-10` is replaced with `2026-05-14`.
- No other content in the file is changed.

---

### Issue 4 — Fix ReDoS vulnerability in password DLP pattern
**Label:** bug  
**File:** `extension/dlp.js`

The password regex uses an unbounded `\S+` quantifier. On a pathological input (e.g. a long line beginning with `password:` followed by many non-whitespace chars), the regex engine can backtrack catastrophically, consuming the full 50ms scan timeout and silently aborting the DLP scan — leaving sensitive content undetected.

Find the `password` entry in the `PATTERNS` object:
```js
password: { re: /(?:password|passwd|pwd|salasana)\s*[:=]\s*\S+/i, ... }
```
Change `\S+` to `\S{1,200}`:
```js
password: { re: /(?:password|passwd|pwd|salasana)\s*[:=]\s*\S{1,200}/i, ... }
```

**Acceptance criteria:**
- Pattern still matches `password: mysecret123` and `pwd=abc`.
- Pattern does not match `password:` with no value.
- DevTools console shows no scanText timeout warning when pasting 500+ chars of non-whitespace after `password:`.

---

### Issue 5 — Add email validate() to suppress consecutive-dot false positives
**Label:** bug  
**File:** `extension/dlp.js`

The email regex does not enforce RFC 5321 rules on the local part, causing false positives on Markdown tables, code snippets, and dot-heavy technical content (e.g. `..@example.com`, `foo..bar@example.com`). The `validate` hook already exists on the credit card and phone patterns — extend it to email.

In the `PATTERNS` object, add a `validate` function to the `email` entry:
```js
email: {
  re: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/,
  label: 'email address',
  severity: 'low',
  validate(match) {
    const local = match.slice(0, match.indexOf('@'));
    return !local.startsWith('.') && !local.endsWith('.') && !local.includes('..');
  },
  maskFn: maskEmail,
},
```

**Acceptance criteria:**
- `test..dot@example.com` does NOT trigger a banner.
- `.@example.com` does NOT trigger a banner.
- `test.dot@example.com` DOES trigger a banner.
- `user@domain.co.uk` DOES trigger a banner.

---

### Issue 6 — Guard activeInputEl with document.contains() in Mask & Send handler
**Label:** bug  
**File:** `extension/dlp.js`

If the user navigates away (SPA route change) between the moment the Security Intercept popup appears and the moment they click "Mask & Send", `activeInputEl` may already be detached from the DOM. Calling `getInputText()` or `setInputValue()` on a detached element produces no effect, but could throw in edge cases.

In the `maskBtn` click handler inside `showInterceptPopup()`, change:
```js
if (activeInputEl) {
  const masked = maskText(getInputText(activeInputEl));
  setInputValue(activeInputEl, masked);
}
```
To:
```js
if (activeInputEl && document.contains(activeInputEl)) {
  const masked = maskText(getInputText(activeInputEl));
  setInputValue(activeInputEl, masked);
}
```

**Acceptance criteria:**
- Clicking Mask & Send when `activeInputEl` is still attached works as before.
- No JS errors appear in the console if the intercept popup is somehow triggered on a detached input.

---

## Out of scope for this release
- `setInputValue` execCommand replacement (risk to Mask & Send reliability)
- JWT / IBAN validate() functions (complexity vs. value for v0.1)
- maskEmail / maskCreditCard strategy changes (behavioural, defer)
- `_hasHighAlert` SPA reset (edge case, low real-world risk)
