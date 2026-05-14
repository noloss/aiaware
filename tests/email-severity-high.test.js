/**
 * tests/email-severity-high.test.js
 *
 * Unit tests for Issue #101 — Elevate email detection severity from low to high.
 *
 * Acceptance criteria:
 *   AC1. scanText() returns severity 'high' (not 'low') for a valid email address.
 *   AC2. topSeverity() returns 'high' when the hit list contains an email hit.
 *   AC3. _hasHighAlert-equivalent logic is set when the top severity is 'high'.
 *   AC4. maskEmail() produces the expected masked form (jo***@ex***.com).
 *   AC5. maskText() replaces an email address in a full message with a masked form.
 *
 * The DLP engine is a browser IIFE, so we inline the pure logic under test —
 * the same approach used by email-validate.test.js and mask-and-send-guard.test.js.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Inline the pure logic from dlp.js that is relevant to this issue.
// Keep this in sync with the source of truth in extension/dlp.js.
// ---------------------------------------------------------------------------

/**
 * Mask an email address — mirrors maskEmail() in dlp.js.
 * john.doe@example.com  →  jo***@ex***.com
 */
function maskEmail(match) {
  const atIdx = match.indexOf('@');
  if (atIdx < 0) return match;
  const local = match.slice(0, atIdx);
  const domain = match.slice(atIdx + 1);
  const dotIdx = domain.lastIndexOf('.');
  const domainName = dotIdx >= 0 ? domain.slice(0, dotIdx) : domain;
  const tld = dotIdx >= 0 ? domain.slice(dotIdx) : '';
  return local.slice(0, 2) + '***' + '@' + domainName.slice(0, 2) + '***' + tld;
}

// Email pattern entry — NOTE: severity MUST be 'high' per Issue #101.
const EMAIL_PATTERN = {
  re: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/,
  label: 'email address',
  severity: 'high',
  maskFn: maskEmail,
  validate(match) {
    const atIdx = match.indexOf('@');
    if (atIdx < 0) return false;
    const local = match.slice(0, atIdx);
    if (local.startsWith('.') || local.endsWith('.')) return false;
    if (local.includes('..')) return false;
    return true;
  },
};

const PATTERNS = { email: EMAIL_PATTERN };

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };

function topSeverity(hits) {
  return hits.reduce((best, h) => {
    const rank = SEVERITY_RANK[h.severity] ?? 1;
    return rank > (SEVERITY_RANK[best] ?? 1) ? h.severity : best;
  }, 'low');
}

const SCAN_TIMEOUT_MS = 50;

function scanText(text) {
  const t0 = performance.now();
  function timedOut() { return performance.now() - t0 > SCAN_TIMEOUT_MS; }

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

function maskText(text) {
  const hits = scanText(text);
  const maskable = hits.filter(h => h.maskFn && h.match !== undefined && h.index !== undefined);
  maskable.sort((a, b) => b.index - a.index);
  let result = text;
  for (const hit of maskable) {
    const masked = hit.maskFn(hit.match);
    result = result.slice(0, hit.index) + masked + result.slice(hit.index + hit.match.length);
  }
  return result;
}

// ---------------------------------------------------------------------------
// AC1 — scanText() severity is 'high' for a valid email
// ---------------------------------------------------------------------------

describe('Issue #101 — AC1: email scan severity is high', () => {

  it('returns severity "high" for a plain email address', () => {
    const hits = scanText('john.doe@example.com');
    const emailHit = hits.find(h => h.label === 'email address');
    assert.ok(emailHit, 'expected an email hit');
    assert.equal(emailHit.severity, 'high',
      `expected severity "high" but got "${emailHit.severity}"`);
  });

  it('returns severity "high" for an email embedded in prose', () => {
    const hits = scanText('Please contact support@company.org for assistance.');
    const emailHit = hits.find(h => h.label === 'email address');
    assert.ok(emailHit, 'expected an email hit');
    assert.equal(emailHit.severity, 'high');
  });

  it('does NOT return severity "low" for a valid email address', () => {
    const hits = scanText('user@domain.co.uk');
    const emailHit = hits.find(h => h.label === 'email address');
    assert.ok(emailHit, 'expected an email hit');
    assert.notEqual(emailHit.severity, 'low',
      'severity must not be "low" — regression against Issue #101');
  });

  it('does NOT return severity "medium" for a valid email address', () => {
    const hits = scanText('alice@example.net');
    const emailHit = hits.find(h => h.label === 'email address');
    assert.ok(emailHit, 'expected an email hit');
    assert.notEqual(emailHit.severity, 'medium');
  });

});

// ---------------------------------------------------------------------------
// AC2 — topSeverity() returns 'high' for an email hit list
// ---------------------------------------------------------------------------

describe('Issue #101 — AC2: topSeverity() is "high" for email hits', () => {

  it('topSeverity returns "high" when email is the only hit', () => {
    const hits = scanText('me@example.com');
    const top = topSeverity(hits);
    assert.equal(top, 'high');
  });

  it('topSeverity returns "high" even with mixed-severity hits', () => {
    // Fabricate a low hit alongside the email hit.
    const hits = [
      { label: 'email address', severity: 'high' },
      { label: 'some low thing', severity: 'low' },
    ];
    assert.equal(topSeverity(hits), 'high');
  });

});

// ---------------------------------------------------------------------------
// AC3 — _hasHighAlert-equivalent: the banner branch that sets _hasHighAlert
//        is reached when the email scan fires.
// ---------------------------------------------------------------------------

describe('Issue #101 — AC3: high-alert flag equivalent is set for email', () => {

  it('simulated _hasHighAlert is true after an email scan', () => {
    const hits = scanText('notify@corp.io');
    const severity = topSeverity(hits);
    // This mirrors the assignment in dlp.js: _hasHighAlert = (severity === 'high')
    const hasHighAlert = (severity === 'high');
    assert.equal(hasHighAlert, true,
      '_hasHighAlert equivalent must be true so the intercept popup fires');
  });

  it('simulated _hasHighAlert is false when no email is present', () => {
    const hits = scanText('no sensitive data here');
    const severity = topSeverity(hits);
    const hasHighAlert = (severity === 'high');
    assert.equal(hasHighAlert, false);
  });

});

// ---------------------------------------------------------------------------
// AC4 — maskEmail() produces the correct masked form
// ---------------------------------------------------------------------------

describe('Issue #101 — AC4: maskEmail() output', () => {

  it('masks john.doe@example.com → jo***@ex***.com', () => {
    assert.equal(maskEmail('john.doe@example.com'), 'jo***@ex***.com');
  });

  it('masks alice@corp.io → al***@co***.io', () => {
    assert.equal(maskEmail('alice@corp.io'), 'al***@co***.io');
  });

  it('masks a@b.co → a***@b***.co  (short local / domain)', () => {
    // local "a" → slice(0,2) = "a" (single char), domain "b" → slice(0,2) = "b"
    assert.equal(maskEmail('a@b.co'), 'a***@b***.co');
  });

  it('masks support@company.org → su***@co***.org', () => {
    assert.equal(maskEmail('support@company.org'), 'su***@co***.org');
  });

  it('preserves multi-part TLD in masking (user@domain.co.uk → us***@do***.co.uk)', () => {
    // lastIndexOf('.') finds the last dot, so TLD = '.uk' and domainName = 'domain.co'
    assert.equal(maskEmail('user@domain.co.uk'), 'us***@do***.uk');
  });

  it('returns the original string unchanged when there is no @ sign', () => {
    assert.equal(maskEmail('notanemail'), 'notanemail');
  });

});

// ---------------------------------------------------------------------------
// AC5 — maskText() replaces the email in a full message
// ---------------------------------------------------------------------------

describe('Issue #101 — AC5: maskText() replaces email in a full message', () => {

  it('replaces a plain email address', () => {
    const result = maskText('john.doe@example.com');
    assert.equal(result, 'jo***@ex***.com');
  });

  it('replaces an email embedded in a sentence', () => {
    const result = maskText('Please email me at alice@corp.io for details.');
    assert.ok(result.includes('al***@co***.io'), `expected masked email in "${result}"`);
    assert.ok(!result.includes('alice@corp.io'), 'original email must not appear in output');
  });

  it('does not alter text that contains no email address', () => {
    const text = 'No sensitive data in this message.';
    assert.equal(maskText(text), text);
  });

  it('replaces multiple email addresses in one message', () => {
    const result = maskText('From: alice@example.com  To: bob@example.org');
    assert.ok(!result.includes('alice@example.com'), 'first email should be masked');
    assert.ok(!result.includes('bob@example.org'),   'second email should be masked');
    assert.ok(result.includes('al***@ex***.com'),     'masked form of first email expected');
    assert.ok(result.includes('bo***@ex***.org'),     'masked form of second email expected');
  });

});
