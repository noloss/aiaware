# PRD: AI Aware – Release Highlighting

## Overview

Add inline visual highlighting of sensitive text directly inside the AI chat input field, so users can see exactly which parts of their message are risky before they send it.

Currently the extension shows a banner below the input field when sensitive data is detected. This release adds a second, more immediate signal: the risky text itself is highlighted with a coloured background inside the field, matching the severity (red = high, orange = medium, yellow = low).

## Release label

`release-highlighting`

## Milestone

`Release Highlighting`

## Scope

Two issues:

---

### Issue 1: Implement sensitive text highlight engine

**Title:** `[R-Highlighting] Implement sensitive text highlight engine for input fields`

New functions in `extension/dlp.js`:

#### `highlightText(el, hits)`
- For **contenteditable** elements (Claude.ai, Gemini):
  - Use a `TreeWalker` to walk text nodes inside `el`.
  - For each hit (from `scanText()`), locate the matching character range across text nodes.
  - Wrap the matched range in `<span data-aa-hl="1" class="aa-hl-{severity}">` where severity is `high`, `medium`, or `low`.
  - Preserve the user's cursor/selection: save `window.getSelection()` range before modification and restore after.
- For **textarea** elements (ChatGPT):
  - Create (or reuse) an absolutely-positioned backdrop `<div id="aa-hl-backdrop">` sized and positioned to exactly overlay the textarea.
  - Mirror the textarea's text into the backdrop with `<mark class="aa-hl-{severity}">` spans around matched ranges and transparent text elsewhere.
  - Sync backdrop scroll position with the textarea's `scroll` event.

#### `clearHighlights(el)`
- For contenteditable: find all `[data-aa-hl]` spans, replace each with its text content (unwrap), then call `el.normalize()` to merge adjacent text nodes.
- For textarea: hide/remove the backdrop div.

#### CSS (add to `extension/dlp.css`)
```css
.aa-hl-high   { background: rgba(239, 68, 68, 0.25); border-radius: 2px; }
.aa-hl-medium { background: rgba(249, 115, 22, 0.20); border-radius: 2px; }
.aa-hl-low    { background: rgba(234, 179, 8, 0.20);  border-radius: 2px; }

#aa-hl-backdrop {
  position: absolute;
  pointer-events: none;
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow: hidden;
  color: transparent;
  z-index: 1;
}
#aa-hl-backdrop mark {
  color: transparent;
  border-radius: 2px;
}
```

**Acceptance criteria:**

Given a contenteditable input containing `sk-1234567890abcdefghij`
When the DLP scanner detects the match
Then the matched text is wrapped in a `<span data-aa-hl="1" class="aa-hl-high">` and visually shows a red background in the input field
And the cursor position is unchanged after highlighting

Given a textarea input containing `sk-1234567890abcdefghij`
When the DLP scanner detects the match
Then an overlay backdrop div appears over the textarea showing a red highlight behind the matched text
And the textarea remains fully interactive (typing, selecting) without interference

Given highlights are currently shown
When `clearHighlights(el)` is called
Then all `[data-aa-hl]` spans are unwrapped (contenteditable) or the backdrop is removed (textarea)
And the element's text content is identical to before highlighting

---

### Issue 2: Wire highlighting into DLP scan and send pipeline

**Title:** `[R-Highlighting] Wire highlight engine into DLP scan and send pipeline`

Modify `extension/dlp.js` to:

1. **Call `highlightText()` from `onInput()` after scanning:**
   - If `hits.length > 0`: call `highlightText(el, hits)` after `showBanner()`.
   - If `hits.length === 0`: call `clearHighlights(el)` and `hideBanner()`.

2. **Strip highlights before every send path:**
   - In the Enter-key intercept: call `clearHighlights(activeInputEl)` before `showInterceptPopup()`.
   - In the send-button click intercept: same.
   - In the "Continue anyway" button handler: call `clearHighlights(activeInputEl)` before `clickPlatformSubmit()`.
   - In the "Mask & Send" button handler: `setInputValue()` replaces all content so no explicit `clearHighlights()` is needed, but call it anyway as a safety measure before `setInputValue()`.

3. **No highlights survive into sent messages** — the clearance must happen before the platform's send handler fires.

**Acceptance criteria:**

Given the user types `sk-1234567890abcdefghij` into the Claude.ai input
When the debounce timer fires
Then the API key text is highlighted red in the input field
And the banner is also shown as before

Given highlights are active and the user clicks "Continue anyway"
When the message is sent
Then no `<span data-aa-hl>` tags appear in the sent message
And the original unmasked text is sent

Given highlights are active and the user clicks "Mask & Send"
When the message is sent
Then the masked text (e.g. `sk-12******************`) is sent
And no highlight spans are present in the sent message

Given highlights are active and the user presses Escape or the input is cleared
When `clearHighlights()` runs
Then the input returns to its normal un-highlighted state
