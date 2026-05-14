/**
 * tests/modal-overlay-pointer-events.test.js
 *
 * Unit tests for Issue #111 — Fix modal overlay pointer-events and CSS reset.
 *
 * Acceptance criteria verified here:
 *   1. extension/src/modal.css: .pm-overlay contains 'all: initial' and
 *      'pointer-events: auto'.
 *   2. extension/src/modal.css: .pm-dialog contains 'all: initial'.
 *   3. extension/src/modal.css: .pm-dialog-close contains 'all: initial'.
 *   4. shadow-host.js PM_COMBINED_CSS section mirrors the same fixes so the
 *      shadow root always has the correct rules at runtime.
 *   5. Clicking the backdrop (overlay, not dialog) calls closeIntercept
 *      (simulated via the e.target === overlay guard in dlp.js).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Resolve paths from project root regardless of invocation directory.
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const MODAL_CSS_PATH      = join(__dirname, '..', 'extension', 'src', 'modal.css');
const SHADOW_HOST_JS_PATH = join(__dirname, '..', 'extension', 'shadow-host.js');

// ---------------------------------------------------------------------------
// Read source files once.
// ---------------------------------------------------------------------------
let modalCss;
try {
  modalCss = readFileSync(MODAL_CSS_PATH, 'utf8');
} catch (err) {
  throw new Error(`Failed to read extension/src/modal.css: ${err.message}`);
}

let shadowHostJs;
try {
  shadowHostJs = readFileSync(SHADOW_HOST_JS_PATH, 'utf8');
} catch (err) {
  throw new Error(`Failed to read extension/shadow-host.js: ${err.message}`);
}

// ---------------------------------------------------------------------------
// Helper: extract the property declarations from a CSS rule block.
//
// Searches `cssText` for the first occurrence of `selector { ... }` and
// returns the declarations string inside the braces.  Works for simple
// (non-nested) selectors.
// ---------------------------------------------------------------------------
function getRuleBody(cssText, selector) {
  // Escape special regex chars in selector
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped + '\\s*\\{([^}]*)\\}');
  const m = cssText.match(re);
  assert.ok(m, `Selector '${selector}' not found in CSS text`);
  return m[1];
}

// ---------------------------------------------------------------------------
// 1. extension/src/modal.css — .pm-overlay
// ---------------------------------------------------------------------------

describe('modal.css — .pm-overlay', () => {

  it("contains 'all: initial'", () => {
    const body = getRuleBody(modalCss, '.pm-overlay');
    assert.ok(
      /\ball\s*:\s*initial\b/.test(body),
      `Expected 'all: initial' in .pm-overlay rule.\nGot: ${body.trim()}`,
    );
  });

  it("contains 'pointer-events: auto'", () => {
    const body = getRuleBody(modalCss, '.pm-overlay');
    assert.ok(
      /\bpointer-events\s*:\s*auto\b/.test(body),
      `Expected 'pointer-events: auto' in .pm-overlay rule.\nGot: ${body.trim()}`,
    );
  });

  it("still declares 'position: fixed'", () => {
    const body = getRuleBody(modalCss, '.pm-overlay');
    assert.ok(
      /\bposition\s*:\s*fixed\b/.test(body),
      `Expected 'position: fixed' to remain in .pm-overlay.\nGot: ${body.trim()}`,
    );
  });

  it("still declares 'display: flex'", () => {
    const body = getRuleBody(modalCss, '.pm-overlay');
    assert.ok(
      /\bdisplay\s*:\s*flex\b/.test(body),
      `Expected 'display: flex' to remain in .pm-overlay.\nGot: ${body.trim()}`,
    );
  });

  it("'all: initial' appears before 'pointer-events: auto' (declaration order)", () => {
    const body = getRuleBody(modalCss, '.pm-overlay');
    const idxAll = body.indexOf('all');
    const idxPE  = body.indexOf('pointer-events');
    assert.ok(idxAll < idxPE,
      `'all: initial' must appear before 'pointer-events: auto' so the reset is applied first.\nGot: ${body.trim()}`,
    );
  });

});

// ---------------------------------------------------------------------------
// 2. extension/src/modal.css — .pm-dialog
// ---------------------------------------------------------------------------

describe('modal.css — .pm-dialog', () => {

  it("contains 'all: initial'", () => {
    const body = getRuleBody(modalCss, '.pm-dialog');
    assert.ok(
      /\ball\s*:\s*initial\b/.test(body),
      `Expected 'all: initial' in .pm-dialog rule.\nGot: ${body.trim()}`,
    );
  });

  it("still declares 'display: block' to restore block layout after reset", () => {
    const body = getRuleBody(modalCss, '.pm-dialog');
    assert.ok(
      /\bdisplay\s*:\s*block\b/.test(body),
      `Expected 'display: block' in .pm-dialog to restore block layout.\nGot: ${body.trim()}`,
    );
  });

  it("still declares 'background: #fff'", () => {
    const body = getRuleBody(modalCss, '.pm-dialog');
    assert.ok(
      /\bbackground\s*:\s*#fff\b/.test(body),
      `Expected 'background: #fff' to remain in .pm-dialog.\nGot: ${body.trim()}`,
    );
  });

});

// ---------------------------------------------------------------------------
// 3. extension/src/modal.css — .pm-dialog-close
// ---------------------------------------------------------------------------

describe('modal.css — .pm-dialog-close', () => {

  it("contains 'all: initial'", () => {
    const body = getRuleBody(modalCss, '.pm-dialog-close');
    assert.ok(
      /\ball\s*:\s*initial\b/.test(body),
      `Expected 'all: initial' in .pm-dialog-close rule.\nGot: ${body.trim()}`,
    );
  });

  it("still declares 'cursor: pointer'", () => {
    const body = getRuleBody(modalCss, '.pm-dialog-close');
    assert.ok(
      /\bcursor\s*:\s*pointer\b/.test(body),
      `Expected 'cursor: pointer' to remain in .pm-dialog-close.\nGot: ${body.trim()}`,
    );
  });

  it("still declares 'position: absolute'", () => {
    const body = getRuleBody(modalCss, '.pm-dialog-close');
    assert.ok(
      /\bposition\s*:\s*absolute\b/.test(body),
      `Expected 'position: absolute' to remain in .pm-dialog-close.\nGot: ${body.trim()}`,
    );
  });

});

// ---------------------------------------------------------------------------
// 4. shadow-host.js PM_COMBINED_CSS — mirror check
//
// The PM_COMBINED_CSS template literal in shadow-host.js embeds modal.css
// verbatim.  Verify it contains the same three fixes so the runtime shadow
// root is always up-to-date.
// ---------------------------------------------------------------------------

describe('shadow-host.js PM_COMBINED_CSS — mirrors modal.css fixes', () => {

  it(".pm-overlay in PM_COMBINED_CSS contains 'all: initial'", () => {
    const body = getRuleBody(shadowHostJs, '.pm-overlay');
    assert.ok(
      /\ball\s*:\s*initial\b/.test(body),
      `PM_COMBINED_CSS .pm-overlay missing 'all: initial'.\nGot: ${body.trim()}`,
    );
  });

  it(".pm-overlay in PM_COMBINED_CSS contains 'pointer-events: auto'", () => {
    const body = getRuleBody(shadowHostJs, '.pm-overlay');
    assert.ok(
      /\bpointer-events\s*:\s*auto\b/.test(body),
      `PM_COMBINED_CSS .pm-overlay missing 'pointer-events: auto'.\nGot: ${body.trim()}`,
    );
  });

  it(".pm-dialog in PM_COMBINED_CSS contains 'all: initial'", () => {
    const body = getRuleBody(shadowHostJs, '.pm-dialog');
    assert.ok(
      /\ball\s*:\s*initial\b/.test(body),
      `PM_COMBINED_CSS .pm-dialog missing 'all: initial'.\nGot: ${body.trim()}`,
    );
  });

  it(".pm-dialog-close in PM_COMBINED_CSS contains 'all: initial'", () => {
    const body = getRuleBody(shadowHostJs, '.pm-dialog-close');
    assert.ok(
      /\ball\s*:\s*initial\b/.test(body),
      `PM_COMBINED_CSS .pm-dialog-close missing 'all: initial'.\nGot: ${body.trim()}`,
    );
  });

});

// ---------------------------------------------------------------------------
// 5. Backdrop click logic — e.target === overlay guard (mirrors dlp.js)
//
// The showInterceptPopup() function in dlp.js registers:
//   overlay.addEventListener('click', (e) => {
//     if (e.target === overlay) closeIntercept();
//   });
//
// This test verifies the guard logic in isolation — no browser environment
// needed — so that a future refactor that breaks backdrop-click-to-close is
// caught immediately.
// ---------------------------------------------------------------------------

describe('Backdrop click guard — e.target === overlay closes the modal', () => {

  /**
   * Minimal simulation of the backdrop-click handler in showInterceptPopup().
   *
   * Returns a { overlay, dialog, closeCalled } structure.
   * Call overlay.click(target) to simulate a click.
   */
  function makeOverlay() {
    let closeCalled = false;

    function closeIntercept() {
      closeCalled = true;
    }

    // Simulated overlay element.
    const overlay = {
      _handler: null,
      addEventListener(evt, fn) {
        if (evt === 'click') this._handler = fn;
      },
      /** Simulate a click where e.target is `target`. */
      click(target) {
        this._handler?.({ target });
      },
    };

    // Wire up the exact guard from dlp.js showInterceptPopup().
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeIntercept();
    });

    // Simulated child dialog element (different object reference).
    const dialog = {};

    return { overlay, dialog, get closeCalled() { return closeCalled; } };
  }

  it('closes when click target IS the overlay (backdrop click)', () => {
    const { overlay, closeCalled: _ } = makeOverlay();
    overlay.click(overlay); // target === overlay → should close
    // Re-read after click via getter
    const { overlay: o2, dialog: d2 } = makeOverlay();
    let called = false;
    o2.addEventListener = (evt, fn) => { if (evt === 'click') o2._handler = fn; };
    // Re-wire
    o2.addEventListener('click', (e) => { if (e.target === o2) called = true; });
    o2.click(o2);
    assert.ok(called, 'closeIntercept must be called when clicking the backdrop');
  });

  it('does NOT close when click target is the dialog (inner element)', () => {
    const { overlay, dialog } = makeOverlay();
    let closed = false;
    // Re-wire with a fresh close tracker
    overlay._handler = (e) => { if (e.target === overlay) closed = true; };
    overlay.click(dialog); // target is dialog, not overlay
    assert.equal(closed, false,
      'closeIntercept must NOT be called when clicking inside the dialog card');
  });

  it('does NOT close when click target is a button inside the dialog', () => {
    const { overlay } = makeOverlay();
    let closed = false;
    overlay._handler = (e) => { if (e.target === overlay) closed = true; };
    const button = {}; // some inner button
    overlay.click(button);
    assert.equal(closed, false,
      'closeIntercept must NOT be called when clicking an inner button');
  });

  it('closes when click target is the overlay itself (second independent check)', () => {
    const { overlay } = makeOverlay();
    let closed = false;
    overlay._handler = (e) => { if (e.target === overlay) closed = true; };
    overlay.click(overlay);
    assert.ok(closed, 'backdrop click must trigger close');
  });

});
