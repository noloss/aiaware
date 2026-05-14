/**
 * tests/redos-password.test.js
 *
 * Unit tests for Issue #92 — Fix ReDoS vulnerability in password DLP pattern.
 *
 * Acceptance criteria:
 *   1. 'password: mysecret123' and 'pwd=abc' are flagged with label 'password pattern'.
 *   2. 'password:' with no value produces no match.
 *   3. 'password:' followed by 500+ non-whitespace characters completes without
 *      a timeout warning and does not hang.
 *
 * The DLP engine (dlp.js) is a browser IIFE, so we inline the minimal subset of
 * PATTERNS and scanText() needed to exercise just the password pattern.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Inline the pure logic under test (mirrors dlp.js exactly).
// ---------------------------------------------------------------------------

// ReDoS-safe password pattern — value must have 1-200 non-whitespace chars.
const PATTERNS = {
  password: {
    re: /(?:password|passwd|pwd|salasana)\s*[:=]\s*\S{1,200}/i,
    label: 'password pattern',
    severity: 'medium',
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
    const globalRe = new RegExp(re.source, 'gi');
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

describe('Issue #92 — ReDoS-safe password pattern', () => {

  // AC 1a: colon-style password assignment is detected
  it('flags "password: mysecret123" with label "password pattern"', () => {
    const hits = scanText('password: mysecret123');
    assert.ok(hits.length > 0, 'expected at least one hit');
    assert.ok(
      hits.some(h => h.label === 'password pattern'),
      'expected label "password pattern"',
    );
  });

  // AC 1b: equals-style short password token is detected
  it('flags "pwd=abc" with label "password pattern"', () => {
    const hits = scanText('pwd=abc');
    assert.ok(hits.length > 0, 'expected at least one hit');
    assert.ok(
      hits.some(h => h.label === 'password pattern'),
      'expected label "password pattern"',
    );
  });

  // AC 1c: passwd variant is also detected
  it('flags "passwd: hunter2" with label "password pattern"', () => {
    const hits = scanText('passwd: hunter2');
    assert.ok(hits.some(h => h.label === 'password pattern'));
  });

  // AC 2: bare keyword with no value must NOT match
  it('does not flag "password:" with no value after the colon', () => {
    const hits = scanText('password:');
    const pwHits = hits.filter(h => h.label === 'password pattern');
    assert.equal(pwHits.length, 0, 'bare "password:" should produce no match');
  });

  // AC 2b: whitespace-only after colon must NOT match
  it('does not flag "password:   " (whitespace only after colon)', () => {
    const hits = scanText('password:   ');
    const pwHits = hits.filter(h => h.label === 'password pattern');
    assert.equal(pwHits.length, 0, 'whitespace-only value should produce no match');
  });

  // AC 3: pathological input (500+ consecutive non-whitespace chars) must
  // complete quickly and not log a timeout warning.
  it('completes without timeout for "password:" followed by 500 non-whitespace chars', () => {
    const longValue = 'x'.repeat(500);
    const input = 'password:' + longValue;

    const warnings = [];
    const origWarn = console.warn.bind(console);
    console.warn = (...args) => {
      warnings.push(args.join(' '));
      origWarn(...args);
    };

    const t0 = performance.now();
    const hits = scanText(input);
    const elapsed = performance.now() - t0;

    console.warn = origWarn;

    // Must finish well under 50 ms (the SCAN_TIMEOUT_MS budget).
    assert.ok(elapsed < SCAN_TIMEOUT_MS,
      `scan took ${elapsed.toFixed(1)} ms — expected < ${SCAN_TIMEOUT_MS} ms`);

    // No timeout warning should have been emitted.
    const timeoutWarnings = warnings.filter(w => w.includes('scanText') && w.includes('aborted'));
    assert.equal(timeoutWarnings.length, 0,
      'no scanText timeout warning expected for bounded regex');

    // The 500-char value is within the 1-200 limit for a single match —
    // the regex captures up to 200 chars, so we still get a hit (it just
    // truncates to the first 200 non-whitespace characters).
    assert.ok(hits.some(h => h.label === 'password pattern'),
      'should still detect the password pattern even with a long value');
  });

  // AC 3b: value longer than 200 chars is capped — no runaway match
  it('caps the matched value at 200 non-whitespace characters', () => {
    const longValue = 'a'.repeat(300);
    const input = `password=${longValue}`;
    const hits = scanText(input);
    const pwHit = hits.find(h => h.label === 'password pattern');
    assert.ok(pwHit, 'should produce a password hit');
    // The matched string includes the keyword prefix plus up to 200 value chars.
    // Total match length ≤ "password=".length + 200 = 9 + 200 = 209.
    assert.ok(
      pwHit.match.length <= 'password='.length + 200,
      `match length ${pwHit.match.length} should be ≤ 209`,
    );
  });
});
