// tests/modal-css-sync.test.js
//
// Issue #113 — Sync modal CSS fixes to shadow-host.js PM_COMBINED_CSS.
//
// Acceptance criteria:
//   1. The modal CSS rules embedded in PM_COMBINED_CSS (shadow-host.js) are
//      character-for-character identical to extension/src/modal.css for each
//      of the seven named modal selectors.
//   2. extension/src/modal.css is present verbatim inside shadow-host.js,
//      ensuring no rules can drift silently.
//
// This test has no runtime DOM requirement — it operates on raw file text only.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root      = resolve(__dirname, '..');

// ── Read source files ─────────────────────────────────────────────────────────

const srcModalCss  = readFileSync(resolve(root, 'extension/src/modal.css'), 'utf8');
const shadowHostJs = readFileSync(resolve(root, 'extension/shadow-host.js'), 'utf8');

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Extract the declaration block (text inside `{ … }`) for the first occurrence
 * of `selector` in `cssText`.
 */
function getRuleBlock(selector, cssText) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = cssText.match(new RegExp(escaped + '\\s*\\{([^}]+)\\}'));
  assert.ok(m, `Selector '${selector}' not found in the provided CSS text`);
  return m[1];
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('modal-css-sync (#113) — PM_COMBINED_CSS mirrors src/modal.css', () => {

  // ── 1. Verbatim inclusion ───────────────────────────────────────────────────
  //
  // The simplest and most reliable sync check: extension/src/modal.css must
  // appear as a verbatim substring of extension/shadow-host.js.  Any edit to
  // modal.css that is NOT reflected in shadow-host.js will fail this test.

  it('extension/src/modal.css is embedded verbatim in shadow-host.js PM_COMBINED_CSS', () => {
    assert.ok(
      shadowHostJs.includes(srcModalCss),
      [
        'extension/src/modal.css is NOT present verbatim inside extension/shadow-host.js.',
        'Update the modal section in PM_COMBINED_CSS to be a character-for-character',
        'copy of extension/src/modal.css.',
      ].join('\n'),
    );
  });

  // ── 2. Per-rule character-for-character checks ──────────────────────────────
  //
  // Belt-and-suspenders: even if the verbatim test passes, confirm each of the
  // seven modal rule blocks is identical in both representations.

  const RULES = [
    '.pm-overlay',
    '.pm-dialog',
    '.pm-dialog-close',
    '.pm-actions',
    '.pm-btn',
    '.pm-btn-close',
    '.pm-btn-proceed',
  ];

  for (const selector of RULES) {
    it(`${selector} rule block is character-for-character identical`, () => {
      const srcBlock      = getRuleBlock(selector, srcModalCss);
      const embeddedBlock = getRuleBlock(selector, shadowHostJs);
      assert.strictEqual(
        embeddedBlock,
        srcBlock,
        `${selector} rule block differs between extension/src/modal.css and PM_COMBINED_CSS`,
      );
    });
  }

  // ── 3. Spot-checks for key properties that prior issues fixed ───────────────
  //      (belt-and-suspenders: these must hold regardless of extractor logic)

  describe('key property spot-checks in shadow-host.js PM_COMBINED_CSS', () => {

    it('.pm-overlay has all: initial before pointer-events: auto', () => {
      const block = getRuleBlock('.pm-overlay', shadowHostJs);
      const idxAll = block.indexOf('all: initial');
      const idxPE  = block.indexOf('pointer-events: auto');
      assert.ok(idxAll >= 0, '.pm-overlay missing all: initial');
      assert.ok(idxPE  >= 0, '.pm-overlay missing pointer-events: auto');
      assert.ok(idxAll < idxPE, 'all: initial must appear before pointer-events: auto');
    });

    it('.pm-dialog has all: initial and display: block', () => {
      const block = getRuleBlock('.pm-dialog', shadowHostJs);
      assert.ok(block.includes('all: initial'),  '.pm-dialog missing all: initial');
      assert.ok(block.includes('display: block'), '.pm-dialog missing display: block');
    });

    it('.pm-dialog-close has all: initial and position: absolute', () => {
      const block = getRuleBlock('.pm-dialog-close', shadowHostJs);
      assert.ok(block.includes('all: initial'),       '.pm-dialog-close missing all: initial');
      assert.ok(block.includes('position: absolute'), '.pm-dialog-close missing position: absolute');
    });

    it('.pm-actions has flex-direction: row (not column)', () => {
      const block = getRuleBlock('.pm-actions', shadowHostJs);
      assert.ok( block.includes('flex-direction: row'),    '.pm-actions must have flex-direction: row');
      assert.ok(!block.includes('flex-direction: column'), '.pm-actions must not have flex-direction: column');
    });

    it('.pm-btn has all: initial, flex: 1 and pointer-events: auto', () => {
      const block = getRuleBlock('.pm-btn', shadowHostJs);
      assert.ok(block.includes('all: initial'),        '.pm-btn missing all: initial');
      assert.ok(block.includes('flex: 1'),              '.pm-btn missing flex: 1');
      assert.ok(block.includes('pointer-events: auto'), '.pm-btn missing pointer-events: auto');
    });

    it('.pm-btn-close has background: #4F46E5 and border: 1px solid #4338CA', () => {
      const block = getRuleBlock('.pm-btn-close', shadowHostJs);
      assert.ok(block.includes('background: #4F46E5'),       '.pm-btn-close missing background: #4F46E5');
      assert.ok(block.includes('border: 1px solid #4338CA'), '.pm-btn-close missing border: 1px solid #4338CA');
    });

    it('.pm-btn-proceed has background: #F3F4F6 and color: #4F46E5', () => {
      const block = getRuleBlock('.pm-btn-proceed', shadowHostJs);
      assert.ok(block.includes('background: #F3F4F6'), '.pm-btn-proceed missing background: #F3F4F6');
      assert.ok(block.includes('color: #4F46E5'),      '.pm-btn-proceed missing color: #4F46E5');
    });

  });

});
