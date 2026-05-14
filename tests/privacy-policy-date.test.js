import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '../extension/privacy_policy.html'), 'utf8');

describe('privacy_policy.html last-updated date', () => {
  it('contains the updated date 2026-05-14', () => {
    assert.ok(
      html.includes('2026-05-14'),
      'Expected to find "2026-05-14" in privacy_policy.html'
    );
  });

  it('does not contain the old date 2026-05-10', () => {
    assert.ok(
      !html.includes('2026-05-10'),
      'Expected "2026-05-10" to be absent from privacy_policy.html'
    );
  });
});
