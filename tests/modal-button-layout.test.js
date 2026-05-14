// tests/modal-button-layout.test.js
// Unit tests for Issue #112: modal button layout and brand colours.
//
// Reads the three CSS sources that must stay in sync and asserts the
// acceptance-criteria rules are present in every copy.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function readFile(rel) {
  return readFileSync(resolve(root, rel), 'utf8');
}

// The three files that must contain identical modal CSS rules.
const sources = {
  'extension/src/modal.css': readFile('extension/src/modal.css'),
  'extension/modal.css':     readFile('extension/modal.css'),
  'extension/shadow-host.js (PM_COMBINED_CSS)': readFile('extension/shadow-host.js'),
};

describe('modal button layout and brand colours (#112)', () => {
  for (const [label, css] of Object.entries(sources)) {
    describe(label, () => {

      it('.pm-actions has flex-direction: row', () => {
        // Must NOT be column and MUST be row.
        assert.ok(
          css.includes('flex-direction: row'),
          `.pm-actions must use flex-direction: row in ${label}`
        );
        assert.ok(
          !css.includes('flex-direction: column'),
          `.pm-actions must not use flex-direction: column in ${label}`
        );
      });

      it('.pm-btn has all: initial', () => {
        // The rule block for .pm-btn should contain `all: initial`.
        // We extract the text between `.pm-btn {` and the next `}` that closes it.
        const match = css.match(/\.pm-btn\s*\{([^}]+)\}/);
        assert.ok(match, `.pm-btn rule must exist in ${label}`);
        assert.ok(
          match[1].includes('all: initial'),
          `.pm-btn must have 'all: initial' in ${label}`
        );
      });

      it('.pm-btn has flex: 1', () => {
        const match = css.match(/\.pm-btn\s*\{([^}]+)\}/);
        assert.ok(match, `.pm-btn rule must exist in ${label}`);
        assert.ok(
          match[1].includes('flex: 1'),
          `.pm-btn must have 'flex: 1' in ${label}`
        );
      });

      it('.pm-btn has pointer-events: auto', () => {
        const match = css.match(/\.pm-btn\s*\{([^}]+)\}/);
        assert.ok(match, `.pm-btn rule must exist in ${label}`);
        assert.ok(
          match[1].includes('pointer-events: auto'),
          `.pm-btn must have 'pointer-events: auto' in ${label}`
        );
      });

      it('.pm-btn-close has background: #4F46E5', () => {
        const match = css.match(/\.pm-btn-close\s*\{([^}]+)\}/);
        assert.ok(match, `.pm-btn-close rule must exist in ${label}`);
        assert.ok(
          match[1].includes('background: #4F46E5'),
          `.pm-btn-close must have 'background: #4F46E5' in ${label}`
        );
      });

      it('.pm-btn-close has border: 1px solid #4338CA', () => {
        const match = css.match(/\.pm-btn-close\s*\{([^}]+)\}/);
        assert.ok(match, `.pm-btn-close rule must exist in ${label}`);
        assert.ok(
          match[1].includes('border: 1px solid #4338CA'),
          `.pm-btn-close must have 'border: 1px solid #4338CA' in ${label}`
        );
      });

      it('.pm-btn-proceed has color: #4F46E5', () => {
        const match = css.match(/\.pm-btn-proceed\s*\{([^}]+)\}/);
        assert.ok(match, `.pm-btn-proceed rule must exist in ${label}`);
        assert.ok(
          match[1].includes('color: #4F46E5'),
          `.pm-btn-proceed must have 'color: #4F46E5' in ${label}`
        );
      });

      it('.pm-btn-proceed has background: #F3F4F6', () => {
        const match = css.match(/\.pm-btn-proceed\s*\{([^}]+)\}/);
        assert.ok(match, `.pm-btn-proceed rule must exist in ${label}`);
        assert.ok(
          match[1].includes('background: #F3F4F6'),
          `.pm-btn-proceed must have 'background: #F3F4F6' in ${label}`
        );
      });
    });
  }
});
