import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(resolve(__dirname, '../extension/manifest.json'), 'utf8')
);

describe('manifest.json version', () => {
  it('declares version 1.0.0', () => {
    assert.equal(manifest.version, '1.0.0');
  });

  it('is Manifest V3', () => {
    assert.equal(manifest.manifest_version, 3);
  });

  it('contains no other structural changes (key set is stable)', () => {
    const expectedKeys = [
      'manifest_version',
      'name',
      'version',
      'description',
      'icons',
      'action',
      'background',
      'permissions',
      'content_scripts',
      'host_permissions',
      'content_security_policy',
    ];
    assert.deepEqual(Object.keys(manifest), expectedKeys);
  });
});
