import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const policyPath = join(__dirname, '../extension/privacy_policy.html');
const html = readFileSync(policyPath, 'utf8');

// ── helpers ──────────────────────────────────────────────────────────────────

/** Strip HTML tags for plain-text section matching */
function stripTags(s) {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

const text = stripTags(html).toLowerCase();

// ── Section presence ──────────────────────────────────────────────────────────

describe('privacy_policy.html — required sections', () => {
  it('contains "What the Extension Does" section (section 1)', () => {
    assert.ok(
      html.toLowerCase().includes('what the extension does'),
      'Section 1 "What the Extension Does" is missing'
    );
  });

  it('contains "Data Collected" section (section 2)', () => {
    assert.ok(
      html.toLowerCase().includes('data collected'),
      'Section 2 "Data Collected" is missing'
    );
  });

  it('contains "No Accuracy Guarantee" section (section 3)', () => {
    assert.ok(
      html.toLowerCase().includes('no accuracy guarantee'),
      'Section 3 "No Accuracy Guarantee" is missing'
    );
  });

  it('contains "Permissions" section (section 4)', () => {
    assert.ok(
      html.toLowerCase().includes('permissions'),
      'Section 4 "Permissions" is missing'
    );
  });

  it("contains \"Children's Privacy\" section (section 5)", () => {
    assert.ok(
      html.toLowerCase().includes("children"),
      'Section 5 about children\'s privacy is missing'
    );
  });

  it('contains "Policy Changes" section (section 6)', () => {
    assert.ok(
      html.toLowerCase().includes('policy changes') || html.toLowerCase().includes('changes to this policy'),
      'Section 6 about policy changes is missing'
    );
  });

  it('contains "Contact" section (section 7)', () => {
    assert.ok(
      html.toLowerCase().includes('contact'),
      'Section 7 "Contact" is missing'
    );
  });
});

// ── Date ──────────────────────────────────────────────────────────────────────

describe('privacy_policy.html — last-updated date', () => {
  it('contains the date 2026-05-14', () => {
    assert.ok(
      html.includes('2026-05-14'),
      'Expected "2026-05-14" in privacy_policy.html'
    );
  });
});

// ── No accuracy guarantee content ─────────────────────────────────────────────

describe('privacy_policy.html — No Accuracy Guarantee section content', () => {
  it('states the extension may miss sensitive data (false negatives)', () => {
    assert.ok(
      text.includes('miss sensitive data') || text.includes('false negative'),
      'No accuracy guarantee section must mention missing sensitive data or false negatives'
    );
  });

  it('states the extension may produce false alarms / false positives', () => {
    assert.ok(
      text.includes('false alarm') || text.includes('false positive'),
      'No accuracy guarantee section must mention false alarms or false positives'
    );
  });

  it('states that users remain responsible for reviewing what they send', () => {
    assert.ok(
      text.includes('remain responsible') || text.includes('you remain'),
      'No accuracy guarantee section must state users remain responsible'
    );
  });

  it('mentions submitting to AI services', () => {
    assert.ok(
      text.includes('ai service') || text.includes('ai chat') || text.includes('submit'),
      'No accuracy guarantee section must reference submitting to AI services'
    );
  });
});

// ── Footer link to terms.html ─────────────────────────────────────────────────

describe('privacy_policy.html — footer terms.html link', () => {
  it('contains a hyperlink pointing to terms.html', () => {
    assert.ok(
      html.includes('href="terms.html"'),
      'Footer must contain a hyperlink to terms.html'
    );
  });

  it('terms.html file exists in the extension directory', () => {
    const termsPath = join(__dirname, '../extension/terms.html');
    assert.ok(
      existsSync(termsPath),
      'extension/terms.html must exist so the link is not broken'
    );
  });

  it('terms.html link text is visible (not empty)', () => {
    const match = html.match(/href="terms\.html"[^>]*>([^<]+)</);
    assert.ok(match && match[1].trim().length > 0, 'terms.html link must have non-empty link text');
  });
});
