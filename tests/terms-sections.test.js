import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const termsPath = join(__dirname, '../extension/terms.html');
const html = readFileSync(termsPath, 'utf8');

/** Strip HTML tags and normalise whitespace for plain-text matching. */
function stripTags(s) {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

const text = stripTags(html).toLowerCase();

// ── File basics ───────────────────────────────────────────────────────────────

describe('terms.html — file basics', () => {
  it('is valid HTML5 (has doctype and html/head/body)', () => {
    assert.ok(html.includes('<!DOCTYPE html>'), 'Missing <!DOCTYPE html>');
    assert.ok(html.includes('<html'), 'Missing <html> element');
    assert.ok(html.includes('<head'), 'Missing <head> element');
    assert.ok(html.includes('<body'), 'Missing <body> element');
  });

  it('has the correct page title', () => {
    assert.ok(
      html.includes('Terms of Use') || html.includes('Terms of Service'),
      'Page title must mention Terms of Use or Terms of Service'
    );
  });

  it('contains the last-updated date 2026-05-14', () => {
    assert.ok(html.includes('2026-05-14'), 'Expected "2026-05-14" in terms.html');
  });
});

// ── Dark-theme visual style ───────────────────────────────────────────────────

describe('terms.html — dark-theme visual style', () => {
  it('uses dark background colour matching privacy_policy.html (#0f1117)', () => {
    assert.ok(
      html.includes('#0f1117'),
      'Background colour #0f1117 (dark theme) must be present in terms.html'
    );
  });

  it('uses the same primary text colour as privacy_policy.html (#e2e8f0)', () => {
    assert.ok(
      html.includes('#e2e8f0'),
      'Primary text colour #e2e8f0 must be present in terms.html'
    );
  });

  it('contains a .container wrapper element', () => {
    assert.ok(
      html.includes('class="container"'),
      'A .container element is required for layout consistency'
    );
  });

  it('contains a <header> element with shield icon and title', () => {
    assert.ok(html.includes('<header'), 'Missing <header> element');
    assert.ok(html.includes('shield') || html.includes('🛡️'), 'Header must include shield icon');
  });

  it('contains a <footer> element', () => {
    assert.ok(html.includes('<footer'), 'Missing <footer> element');
  });
});

// ── Required sections (all 8) ─────────────────────────────────────────────────

describe('terms.html — Section 1: Acceptance', () => {
  it('contains an "Acceptance" section heading', () => {
    assert.ok(
      text.includes('acceptance'),
      'Section 1 "Acceptance" is missing'
    );
  });

  it('states that installing/using the extension means agreeing to the terms', () => {
    assert.ok(
      text.includes('agree') || text.includes('accept'),
      'Acceptance section must state that use constitutes agreement'
    );
  });
});

describe('terms.html — Section 2: License', () => {
  it('contains a "License" section heading', () => {
    assert.ok(
      text.includes('license'),
      'Section 2 "License" is missing'
    );
  });

  it('references the GitHub repository or open-source availability', () => {
    assert.ok(
      html.includes('github.com') || text.includes('open-source') || text.includes('open source'),
      'License section must reference GitHub or open-source availability'
    );
  });
});

describe('terms.html — Section 3: Current pricing', () => {
  it('contains a "Current pricing" section heading', () => {
    assert.ok(
      text.includes('current pricing') || text.includes('current price'),
      'Section 3 "Current pricing" is missing'
    );
  });

  it('states the extension is currently free', () => {
    assert.ok(
      text.includes('free') || text.includes('no charge') || text.includes('no cost'),
      'Current pricing section must state the extension is currently free'
    );
  });
});

describe('terms.html — Section 4: Future pricing', () => {
  it('contains a "Future pricing" section heading', () => {
    assert.ok(
      text.includes('future pricing') || text.includes('future price'),
      'Section 4 "Future pricing" is missing'
    );
  });

  it('explicitly states the developer reserves the right to introduce paid features or tiers', () => {
    assert.ok(
      text.includes('paid feature') || text.includes('paid tier') || text.includes('paid subscription'),
      'Future pricing section must state the right to introduce paid features or tiers'
    );
  });

  it('explicitly states that currently-free core functionality will not become paid without reasonable notice', () => {
    const hasNotice =
      (text.includes('notice') || text.includes('notif')) &&
      (text.includes('free') || text.includes('core'));
    assert.ok(
      hasNotice,
      'Future pricing section must state that currently-free core functionality will not become paid without reasonable notice'
    );
  });
});

describe('terms.html — Section 5: No warranty', () => {
  it('contains a "No warranty" section heading', () => {
    assert.ok(
      text.includes('no warranty') || text.includes('warranty'),
      'Section 5 "No warranty" is missing'
    );
  });

  it('includes "as is" language', () => {
    assert.ok(
      text.includes('as is') || html.toLowerCase().includes('&ldquo;as is&rdquo;'),
      'No warranty section must include "as is" language'
    );
  });
});

describe('terms.html — Section 6: Limitation of liability', () => {
  it('contains a "Limitation of liability" section heading', () => {
    assert.ok(
      text.includes('limitation of liability'),
      'Section 6 "Limitation of liability" is missing'
    );
  });

  it('explicitly states the developer is not liable for data inadvertently shared with AI services', () => {
    assert.ok(
      text.includes('inadvertently') || text.includes('inadvertent'),
      'Limitation of liability section must mention data inadvertently shared with AI services'
    );
  });

  it('references the maximum extent permitted by applicable law', () => {
    const hasLegalExtent =
      (text.includes('maximum extent') || text.includes('fullest extent') || text.includes('extent permitted')) &&
      text.includes('law');
    assert.ok(
      hasLegalExtent,
      'Limitation of liability section must reference the maximum extent permitted by applicable law'
    );
  });
});

describe('terms.html — Section 7: Governing law', () => {
  it('contains a "Governing law" section heading', () => {
    assert.ok(
      text.includes('governing law') || text.includes('govern'),
      'Section 7 "Governing law" is missing'
    );
  });

  it('names a specific jurisdiction or country', () => {
    // Accepts any named country / jurisdiction
    const hasJurisdiction =
      text.includes('finland') ||
      text.includes('united states') ||
      text.includes('united kingdom') ||
      text.includes('jurisdiction') ||
      text.includes('courts of');
    assert.ok(
      hasJurisdiction,
      'Governing law section must name a specific jurisdiction or country'
    );
  });
});

describe('terms.html — Section 8: Changes', () => {
  it('contains a "Changes" section heading', () => {
    assert.ok(
      text.includes('changes to these terms') || text.includes('changes to the terms') ||
      text.includes('changes to this') || text.includes('changes'),
      'Section 8 "Changes" is missing'
    );
  });

  it('explains that continued use constitutes acceptance of updated terms', () => {
    assert.ok(
      text.includes('continued use') || text.includes('constitutes acceptance'),
      'Changes section must state that continued use constitutes acceptance of updated terms'
    );
  });
});

// ── Footer ────────────────────────────────────────────────────────────────────

describe('terms.html — footer', () => {
  it('contains a link back to privacy_policy.html', () => {
    assert.ok(
      html.includes('href="privacy_policy.html"') || html.includes("href='privacy_policy.html'"),
      'Footer must link back to privacy_policy.html'
    );
  });
});
