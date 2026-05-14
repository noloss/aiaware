/**
 * tests/email-validate.test.js
 *
 * Unit tests for Issue #93 — Add email validate() to suppress false positives.
 *
 * Acceptance criteria:
 *   1. 'test..dot@example.com' (consecutive dots in local part) produces no match.
 *   2. '.@example.com' (local part starts with a dot) produces no match.
 *   3. 'test.dot@example.com' (valid address) IS flagged as an email address.
 *   4. 'user@domain.co.uk' (valid multi-part TLD) IS flagged as an email address.
 *
 * The DLP engine (dlp.js) is a browser IIFE, so we inline the minimal subset of
 * PATTERNS, validate(), and scanText() needed to exercise just the email pattern.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Inline the pure logic under test (mirrors dlp.js exactly).
// ---------------------------------------------------------------------------

const PATTERNS = {
  email: {
    re: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/,
    label: 'email address',
    severity: 'low',
    /**
     * Reject addresses whose local part violates RFC 5321 rules:
     *   – must not start with a dot
     *   – must not end with a dot
     *   – must not contain consecutive dots
     */
    validate(match) {
      const atIdx = match.indexOf('@');
      if (atIdx < 0) return false;
      const local = match.slice(0, atIdx);
      if (local.startsWith('.') || local.endsWith('.')) return false;
      if (local.includes('..')) return false;
      return true;
    },
  },
};

const SCAN_TIMEOUT_MS = 50;

function scanText(text) {
  const t0 = performance.now();

  function timedOut() {
    return performance.now() - t0 > SCAN_TIMEOUT_MS;
  }

  const hits = [];
  for (const [, pattern] of Object.entries(PATTERNS)) {
    if (timedOut()) return [];
    const { re, label, severity = 'warning', validate, maskFn } = pattern;
    const globalRe = new RegExp(re.source, 'g');
    const matches = [...text.matchAll(globalRe)];
    if (validate) {
      for (const m of matches) {
        if (validate(m[0])) hits.push({ label, severity, match: m[0], index: m.index, maskFn });
      }
    } else {
      for (const m of matches) {
        hits.push({ label, severity, match: m[0], index: m.index, maskFn });
      }
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Issue #93 — email validate() suppresses false positives', () => {

  // AC 1: consecutive dots in local part → no match
  it('does not flag "test..dot@example.com" (consecutive dots in local part)', () => {
    const hits = scanText('test..dot@example.com');
    const emailHits = hits.filter(h => h.label === 'email address');
    assert.equal(emailHits.length, 0,
      '"test..dot@example.com" should not produce an email match');
  });

  // AC 2: local part starts with a dot → no match
  it('does not flag ".@example.com" (local part starts with a dot)', () => {
    const hits = scanText('.@example.com');
    const emailHits = hits.filter(h => h.label === 'email address');
    assert.equal(emailHits.length, 0,
      '".@example.com" should not produce an email match');
  });

  // AC 3: valid address with an internal dot IS flagged
  it('flags "test.dot@example.com" as an email address', () => {
    const hits = scanText('test.dot@example.com');
    assert.ok(hits.length > 0, 'expected at least one hit');
    assert.ok(
      hits.some(h => h.label === 'email address'),
      'expected label "email address"',
    );
  });

  // AC 4: valid address with a multi-part TLD IS flagged
  it('flags "user@domain.co.uk" as an email address', () => {
    const hits = scanText('user@domain.co.uk');
    assert.ok(hits.length > 0, 'expected at least one hit');
    assert.ok(
      hits.some(h => h.label === 'email address'),
      'expected label "email address"',
    );
  });

  // Extra: local part ending with a dot → no match
  it('does not flag "trailing.@example.com" (local part ends with a dot)', () => {
    const hits = scanText('trailing.@example.com');
    const emailHits = hits.filter(h => h.label === 'email address');
    assert.equal(emailHits.length, 0,
      '"trailing.@example.com" should not produce an email match');
  });

  // Extra: standard address with no dots in local part IS flagged
  it('flags "alice@example.com" as an email address', () => {
    const hits = scanText('alice@example.com');
    assert.ok(hits.some(h => h.label === 'email address'));
  });

  // Extra: embedded in surrounding text — valid address still detected
  it('flags an email embedded in prose', () => {
    const hits = scanText('Contact us at support@example.org for help.');
    assert.ok(hits.some(h => h.label === 'email address' && h.match === 'support@example.org'));
  });

  // Extra: Markdown table cell with dots should not trigger
  it('does not flag a Markdown table row that looks like it contains dots', () => {
    const hits = scanText('| col1 | ..value.. | col3 |');
    const emailHits = hits.filter(h => h.label === 'email address');
    assert.equal(emailHits.length, 0);
  });
});
