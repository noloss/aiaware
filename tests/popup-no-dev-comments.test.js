import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../extension/popup/popup.html'), 'utf8');

describe('popup.html dev-comment removal', () => {
  it('does not contain the Issue #36 comment block', () => {
    assert.ok(
      !html.includes('<!-- Issue #36'),
      'Internal dev comment "<!-- Issue #36" must not appear in popup.html'
    );
  });

  it('does not contain any Finnish text', () => {
    const finnishSnippets = ['koskaan', 'koneeltasi', 'kirjoittamasi', 'palvelinta', 'laajennus'];
    for (const snippet of finnishSnippets) {
      assert.ok(
        !html.includes(snippet),
        `Finnish text fragment "${snippet}" must not appear in popup.html`
      );
    }
  });

  it('still renders the Zero-Network section with its heading', () => {
    assert.ok(
      html.includes('pm-zero-network'),
      'Zero-Network section must still be present'
    );
    assert.ok(
      html.includes('Zero-Network'),
      'Zero-Network badge/label must still be present'
    );
  });

  it('still renders the Zero-Network descriptive text', () => {
    assert.ok(
      html.includes('text you type never leaves your device'),
      'Zero-Network privacy message must still be present'
    );
  });

  it('still includes the shield icon', () => {
    assert.ok(
      html.includes('pm-zero-network-icon'),
      'Zero-Network icon element must still be present'
    );
  });
});
