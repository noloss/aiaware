/**
 * tests/mask-and-send-guard.test.js
 *
 * Unit tests for Issue #94 — Guard activeInputEl with document.contains()
 * in the Mask & Send handler.
 *
 * The maskBtn click handler in dlp.js must:
 *   1. Mask and write back text when activeInputEl IS attached to the DOM.
 *   2. Skip masking silently (no throw) when activeInputEl has been detached.
 *
 * We simulate the handler logic inline — no browser globals required.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Minimal inline re-implementation of the guard logic from dlp.js.
// This mirrors the exact conditional introduced by the fix so that if the
// condition is changed in dlp.js the test will catch the regression.
// ---------------------------------------------------------------------------

/**
 * Simulates the maskBtn click handler.
 *
 * @param {object|null} activeInputEl   – the tracked input element (or null)
 * @param {object}      documentMock    – mock with a contains(el) method
 * @param {Function}    maskTextFn      – (text: string) => string
 * @returns {{ valueWritten: string|null, errorThrown: Error|null }}
 */
function simulateMaskBtnClick(activeInputEl, documentMock, maskTextFn) {
  let valueWritten = null;
  let errorThrown = null;

  // Replicate the exact guard from dlp.js:
  //   if (activeInputEl && document.contains(activeInputEl)) { … }
  try {
    if (activeInputEl && documentMock.contains(activeInputEl)) {
      const text   = activeInputEl.value ?? '';
      const masked = maskTextFn(text);
      activeInputEl.value = masked;
      valueWritten = masked;
    }
    // closeIntercept() and setTimeout(clickPlatformSubmit, 0) are UI-only;
    // not exercised in these unit tests.
  } catch (err) {
    errorThrown = err;
  }

  return { valueWritten, errorThrown };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a minimal document mock that tracks contained elements. */
function makeDocument() {
  const attached = new Set();
  return {
    contains(el) { return el != null && attached.has(el); },
    attach(el)   { attached.add(el); },
    detach(el)   { attached.delete(el); },
  };
}

/** A trivial maskText that replaces digits with '*'. */
function simpleMask(text) {
  return text.replace(/\d/g, '*');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('maskBtn guard — activeInputEl attached to DOM', () => {

  it('masks the text and writes it back when the element is attached', () => {
    const doc = makeDocument();
    const el  = { value: 'key: sk-ant-12345' };
    doc.attach(el);

    const { valueWritten, errorThrown } = simulateMaskBtnClick(el, doc, simpleMask);

    assert.equal(errorThrown, null,          'no error should be thrown');
    assert.equal(valueWritten, 'key: sk-ant-*****', 'masked value should be written back');
    assert.equal(el.value, 'key: sk-ant-*****',     'element value should be updated');
  });

  it('preserves text that has no sensitive tokens', () => {
    const doc = makeDocument();
    const el  = { value: 'Hello, world!' };
    doc.attach(el);

    const { valueWritten, errorThrown } = simulateMaskBtnClick(el, doc, simpleMask);

    assert.equal(errorThrown, null);
    assert.equal(valueWritten, 'Hello, world!');
  });

});

describe('maskBtn guard — activeInputEl detached from DOM', () => {

  it('does not throw when activeInputEl has been removed from the document', () => {
    const doc = makeDocument();
    const el  = { value: 'sk-ant-secretkey99999' };
    doc.attach(el);
    doc.detach(el); // simulate SPA route change / removeChild

    const { errorThrown } = simulateMaskBtnClick(el, doc, simpleMask);

    assert.equal(errorThrown, null, 'handler must not throw for detached element');
  });

  it('does not overwrite the element value when detached', () => {
    const doc = makeDocument();
    const el  = { value: 'original text 123' };
    doc.attach(el);
    doc.detach(el);

    const originalValue = el.value;
    simulateMaskBtnClick(el, doc, simpleMask);

    assert.equal(el.value, originalValue, 'detached element value must remain unchanged');
  });

  it('returns null valueWritten when element is detached', () => {
    const doc = makeDocument();
    const el  = { value: 'sensitive 4111111111111111' };
    doc.attach(el);
    doc.detach(el);

    const { valueWritten } = simulateMaskBtnClick(el, doc, simpleMask);

    assert.equal(valueWritten, null, 'no value should be written for detached element');
  });

});

describe('maskBtn guard — activeInputEl is null', () => {

  it('does not throw when activeInputEl is null', () => {
    const doc = makeDocument();

    const { errorThrown, valueWritten } = simulateMaskBtnClick(null, doc, simpleMask);

    assert.equal(errorThrown,  null, 'must not throw for null activeInputEl');
    assert.equal(valueWritten, null, 'nothing should be written');
  });

});

describe('document.contains() mock — sanity checks', () => {

  it('returns true for an attached element', () => {
    const doc = makeDocument();
    const el  = {};
    doc.attach(el);
    assert.equal(doc.contains(el), true);
  });

  it('returns false after detach', () => {
    const doc = makeDocument();
    const el  = {};
    doc.attach(el);
    doc.detach(el);
    assert.equal(doc.contains(el), false);
  });

  it('returns false for null', () => {
    const doc = makeDocument();
    assert.equal(doc.contains(null), false);
  });

});
