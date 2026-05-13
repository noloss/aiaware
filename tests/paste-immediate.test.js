/**
 * tests/paste-immediate.test.js
 *
 * Unit tests for Issue #86 — Immediate Warning Banner on Clipboard Paste.
 *
 * The DLP engine's paste handler must:
 *   1. Read clipboard text synchronously from e.clipboardData (not from the DOM)
 *   2. Scan the pasted text immediately — without waiting for debounce
 *   3. Produce hits for the patterns present in the pasted content
 *
 * Because dlp.js is a browser IIFE, these tests extract and exercise the pure
 * scan logic directly.  We replicate the minimum subset of PATTERNS, luhn(),
 * and scanText() needed to validate the acceptance criteria from the issue.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Inline the pure functions under test — no browser globals needed.
// ---------------------------------------------------------------------------

function luhn(digits) {
  let sum = 0;
  let doubled = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i], 10);
    if (doubled) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    doubled = !doubled;
  }
  return sum % 10 === 0;
}

function shannonEntropy(str) {
  if (!str.length) return 0;
  const freq = {};
  for (const ch of str) freq[ch] = (freq[ch] || 0) + 1;
  let h = 0;
  for (const count of Object.values(freq)) {
    const p = count / str.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const PATTERNS = {
  email: {
    re: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/,
    label: 'email address',
    severity: 'low',
  },
  credit_card: {
    re: /\b\d{4}[ \-]\d{6}[ \-]\d{5}\b|\b\d{4}(?:[ \-]\d{4}){2,4}\b|\b\d{13,19}\b/,
    label: 'credit card number',
    severity: 'high',
    validate(match) {
      const digits = match.replace(/[\s\-]/g, '');
      return digits.length >= 13 && digits.length <= 19 && luhn(digits);
    },
  },
  anthropic_key: {
    re: /sk-ant-[a-zA-Z0-9\-]{20,}/,
    label: 'Anthropic API key',
    severity: 'high',
  },
  ssn: {
    re: /\b\d{3}-\d{2}-\d{4}\b/,
    label: 'US Social Security Number (SSN)',
    severity: 'high',
    validate(match) {
      const area = parseInt(match.slice(0, 3), 10);
      return area !== 0 && area !== 666 && area < 900;
    },
  },
};

const ENTROPY_THRESHOLD = 4.5;
const ENTROPY_MIN_LEN   = 20;
const TOKEN_RE = new RegExp(`[a-zA-Z0-9+/]{${ENTROPY_MIN_LEN},}`, 'g');
const SCAN_TIMEOUT_MS   = 50;

function scanEntropy(text) {
  const hits = [];
  for (const match of text.matchAll(TOKEN_RE)) {
    if (shannonEntropy(match[0]) > ENTROPY_THRESHOLD) {
      hits.push({ label: 'high-entropy token (possible API key/secret)', severity: 'high', match: match[0], index: match.index });
      break;
    }
  }
  return hits;
}

function scanText(text) {
  const t0 = Date.now();
  function timedOut() { return Date.now() - t0 > SCAN_TIMEOUT_MS; }

  const hits = [];
  for (const [, pattern] of Object.entries(PATTERNS)) {
    if (timedOut()) return [];
    const { re, label, severity = 'low', validate } = pattern;
    const globalRe = new RegExp(re.source, 'g');
    for (const m of text.matchAll(globalRe)) {
      if (!validate || validate(m[0])) {
        hits.push({ label, severity, match: m[0], index: m.index });
      }
    }
  }
  if (!hits.some(h => h.severity === 'high') && !timedOut()) {
    hits.push(...scanEntropy(text));
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Helper — simulate the synchronous paste-handler logic from dlp.js.
// Returns { hitsFromClipboard, bannerShownImmediately }.
// ---------------------------------------------------------------------------
function simulatePasteHandler(clipboardText) {
  const clipText = clipboardText ?? '';
  let hitsFromClipboard = null;
  let bannerShownImmediately = false;
  let debounceQueued = false;

  if (clipText.trim()) {
    const hits = scanText(clipText);
    if (hits.length > 0) {
      hitsFromClipboard = hits;
      bannerShownImmediately = true;
      return { hitsFromClipboard, bannerShownImmediately, debounceQueued };
    }
  }
  // Clean paste — falls through to debounced path
  debounceQueued = true;
  return { hitsFromClipboard, bannerShownImmediately, debounceQueued };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Issue #86 — Immediate paste detection', () => {

  // ── Acceptance criterion: email in pasted text triggers the banner ───────

  it('detects email address in pasted text immediately', () => {
    const { hitsFromClipboard, bannerShownImmediately } =
      simulatePasteHandler('otto@te.com');

    assert.equal(bannerShownImmediately, true, 'banner should be shown immediately');
    assert.ok(hitsFromClipboard && hitsFromClipboard.length > 0, 'should have at least one hit');
    const labels = hitsFromClipboard.map(h => h.label);
    assert.ok(labels.includes('email address'), 'should flag email address');
  });

  // ── Acceptance criterion: issue scenario text triggers the banner ─────────

  it('detects email in the issue scenario paste "v 4032034653092067 otto@te.com"', () => {
    // Note: 4032034653092067 does not pass Luhn, but otto@te.com is a valid email.
    const { hitsFromClipboard, bannerShownImmediately } =
      simulatePasteHandler('v 4032034653092067 otto@te.com');

    assert.equal(bannerShownImmediately, true, 'banner should show immediately for issue scenario');
    assert.ok(hitsFromClipboard && hitsFromClipboard.length > 0, 'should produce at least one hit');
    const labels = hitsFromClipboard.map(h => h.label);
    assert.ok(labels.includes('email address'), 'email address hit expected');
  });

  // ── Luhn-valid credit card is detected as high severity ──────────────────

  it('detects a Luhn-valid credit card as high severity', () => {
    // 4532015112830366 is a known Visa test PAN that passes Luhn.
    const { hitsFromClipboard, bannerShownImmediately } =
      simulatePasteHandler('Please charge 4532015112830366 for this order.');

    assert.equal(bannerShownImmediately, true);
    assert.ok(hitsFromClipboard.some(h => h.label === 'credit card number' && h.severity === 'high'));
  });

  it('does not flag a number that fails Luhn as a credit card', () => {
    // 1234567890123456 has 16 digits but fails Luhn.
    const { hitsFromClipboard } =
      simulatePasteHandler('1234567890123456');

    const cardHits = hitsFromClipboard?.filter(h => h.label === 'credit card number') ?? [];
    assert.equal(cardHits.length, 0, 'should not flag Luhn-invalid number as credit card');
  });

  // ── API key in pasted text triggers high-severity hit ────────────────────

  it('detects an Anthropic API key in pasted text', () => {
    const key = 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdef';
    const { hitsFromClipboard, bannerShownImmediately } =
      simulatePasteHandler(`My key: ${key}`);

    assert.equal(bannerShownImmediately, true);
    assert.ok(hitsFromClipboard.some(h => h.label === 'Anthropic API key' && h.severity === 'high'));
  });

  // ── SSN in pasted text triggers high-severity hit ─────────────────────────

  it('detects a US SSN in pasted text', () => {
    const { hitsFromClipboard, bannerShownImmediately } =
      simulatePasteHandler('SSN: 123-45-6789');

    assert.equal(bannerShownImmediately, true);
    assert.ok(hitsFromClipboard.some(h => h.label === 'US Social Security Number (SSN)'));
  });

  // ── Clean paste does NOT show the banner immediately ─────────────────────

  it('does not show banner for clean (non-sensitive) pasted text', () => {
    const { bannerShownImmediately, debounceQueued } =
      simulatePasteHandler('Hello, how are you today?');

    assert.equal(bannerShownImmediately, false, 'banner must NOT show for clean text');
    assert.equal(debounceQueued, true, 'debounced scan should be queued for clean text');
  });

  it('does not show banner for empty paste', () => {
    const { bannerShownImmediately, debounceQueued } =
      simulatePasteHandler('');

    assert.equal(bannerShownImmediately, false);
    assert.equal(debounceQueued, true);
  });

  it('does not show banner for whitespace-only paste', () => {
    const { bannerShownImmediately, debounceQueued } =
      simulatePasteHandler('   \t\n  ');

    assert.equal(bannerShownImmediately, false);
    assert.equal(debounceQueued, true);
  });
});

// ---------------------------------------------------------------------------
// Luhn helper tests — sanity-check the credit card validator
// ---------------------------------------------------------------------------

describe('luhn()', () => {
  it('returns true for 4532015112830366 (Visa test PAN)', () => {
    assert.equal(luhn('4532015112830366'), true);
  });

  it('returns false for 4532015112830367 (off by one)', () => {
    assert.equal(luhn('4532015112830367'), false);
  });

  it('returns true for 378282246310005 (Amex test PAN)', () => {
    assert.equal(luhn('378282246310005'), true);
  });
});

// ---------------------------------------------------------------------------
// scanText edge cases
// ---------------------------------------------------------------------------

describe('scanText()', () => {
  it('returns an empty array for empty string', () => {
    assert.deepEqual(scanText(''), []);
  });

  it('returns an empty array for plain prose', () => {
    const hits = scanText('The quick brown fox jumps over the lazy dog.');
    assert.equal(hits.length, 0);
  });

  it('finds multiple patterns in a single paste', () => {
    const text = 'Email: alice@example.com  Card: 4532015112830366';
    const hits = scanText(text);
    const labels = hits.map(h => h.label);
    assert.ok(labels.includes('email address'), 'email detected');
    assert.ok(labels.includes('credit card number'), 'credit card detected');
  });
});
