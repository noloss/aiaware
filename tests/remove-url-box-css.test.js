/**
 * tests/remove-url-box-css.test.js
 *
 * Unit tests for Issue #104 — Remove URL-box CSS rules from modal.css and
 * shadow-host.js.
 *
 * Acceptance criteria verified here:
 *   1. modal.css does NOT contain '.pm-url-box', '.pm-url-label', or '.pm-url-value'.
 *   2. PM_COMBINED_CSS in shadow-host.js does NOT contain those selectors.
 *   3. modal.css still contains '.pm-overlay', '.pm-dialog', '.pm-btn-proceed',
 *      and '.pm-btn-close'.
 *   4. shadow-host.js PM_COMBINED_CSS still contains all four of those selectors.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const EXT        = join(__dirname, '..', 'extension');

// ---------------------------------------------------------------------------
// Load files once.
// ---------------------------------------------------------------------------
const modalCss = readFileSync(join(EXT, 'modal.css'), 'utf8');

const shadowHostSrc = readFileSync(join(EXT, 'shadow-host.js'), 'utf8');

/**
 * Extract the PM_COMBINED_CSS template-literal string from shadow-host.js.
 * The literal spans from the first backtick after `PM_COMBINED_CSS = ` to the
 * closing backtick + semicolon, so we grab everything between them.
 */
function extractPmCombinedCss(src) {
  // Match: const PM_COMBINED_CSS = `...`;
  const match = src.match(/const\s+PM_COMBINED_CSS\s*=\s*\/\*[^*]*\*\/\s*`([\s\S]*?)`\s*;/);
  if (!match) {
    // Fallback: match without the /* css */ comment
    const plain = src.match(/const\s+PM_COMBINED_CSS\s*=\s*`([\s\S]*?)`\s*;/);
    assert.ok(plain, 'Could not locate PM_COMBINED_CSS template literal in shadow-host.js');
    return plain[1];
  }
  return match[1];
}

const pmCombinedCss = extractPmCombinedCss(shadowHostSrc);

// ---------------------------------------------------------------------------
// Dead selectors that must be absent.
// ---------------------------------------------------------------------------
const DEAD_SELECTORS = ['.pm-url-box', '.pm-url-label', '.pm-url-value'];

// ---------------------------------------------------------------------------
// Live selectors that must still be present.
// ---------------------------------------------------------------------------
const LIVE_SELECTORS = ['.pm-overlay', '.pm-dialog', '.pm-btn-proceed', '.pm-btn-close'];

// ---------------------------------------------------------------------------
// modal.css — dead selectors absent
// ---------------------------------------------------------------------------
describe('modal.css — dead URL-box selectors are absent', () => {
  for (const sel of DEAD_SELECTORS) {
    it(`does NOT contain '${sel}'`, () => {
      assert.ok(
        !modalCss.includes(sel),
        `'${sel}' must not appear in modal.css but was found`,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// modal.css — live modal selectors present
// ---------------------------------------------------------------------------
describe('modal.css — live modal selectors are present', () => {
  for (const sel of LIVE_SELECTORS) {
    it(`contains '${sel}'`, () => {
      assert.ok(
        modalCss.includes(sel),
        `'${sel}' must be present in modal.css`,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// shadow-host.js PM_COMBINED_CSS — dead selectors absent
// ---------------------------------------------------------------------------
describe('shadow-host.js PM_COMBINED_CSS — dead URL-box selectors are absent', () => {
  for (const sel of DEAD_SELECTORS) {
    it(`does NOT contain '${sel}'`, () => {
      assert.ok(
        !pmCombinedCss.includes(sel),
        `'${sel}' must not appear in PM_COMBINED_CSS but was found`,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// shadow-host.js PM_COMBINED_CSS — live modal selectors present
// ---------------------------------------------------------------------------
describe('shadow-host.js PM_COMBINED_CSS — live modal selectors are present', () => {
  for (const sel of LIVE_SELECTORS) {
    it(`contains '${sel}'`, () => {
      assert.ok(
        pmCombinedCss.includes(sel),
        `'${sel}' must be present in PM_COMBINED_CSS in shadow-host.js`,
      );
    });
  }
});
