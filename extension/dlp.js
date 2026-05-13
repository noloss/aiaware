(() => {
  if (window.__promptMaskerDlpLoaded) return;
  window.__promptMaskerDlpLoaded = true;

  // ---------------------------------------------------------------------------
  // Shadow root reference — all extension UI (banner, intercept overlay) is
  // appended here so host-page CSS cannot bleed in.  shadow-host.js runs first
  // and guarantees the root is available before this module initialises.
  // ---------------------------------------------------------------------------
  function getSR() {
    if (!window.__pmShadowRoot) {
      console.error('[Prompt Masker] dlp.js: shadow root not available.');
      return document.body; // last-resort fallback
    }
    return window.__pmShadowRoot;
  }

  // ---------------------------------------------------------------------------
  // Luhn algorithm — returns true when the digit string has a valid check digit.
  // ---------------------------------------------------------------------------
  function luhn(digits) {
    let sum = 0;
    let doubled = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let d = parseInt(digits[i], 10);
      if (doubled) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
      doubled = !doubled;
    }
    return sum % 10 === 0;
  }

  // ---------------------------------------------------------------------------
  // Shannon entropy — bits per character for a given string.
  // Used to catch high-entropy tokens that don't match a known prefix.
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Masking helpers.
  //
  // Each function takes the matched string and returns a masked replacement of
  // identical length (where practical), preserving surrounding text positions.
  // ---------------------------------------------------------------------------

  /**
   * Mask an email address.
   * john.doe@example.com  →  jo***@ex***.com
   * Keep first 2 chars of local part, first 2 chars of domain name, full TLD.
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

  /**
   * Mask a credit card number.
   * 4532 0151 1283 0366  →  4532 **** **** 0366
   * Keep first and last digit group; mask all middle groups.
   * Preserves the original separator character (space or dash).
   */
  function maskCreditCard(match) {
    const sepMatch = match.match(/[ \-]/);
    if (sepMatch) {
      const sep = sepMatch[0];
      const parts = match.split(sep);
      const n = parts.length;
      const masked = parts.map((part, i) =>
        (i === 0 || i === n - 1) ? part : '*'.repeat(part.length)
      );
      return masked.join(sep);
    }
    // No separator: keep first 4 and last 4 digits, mask the rest.
    const digits = match.replace(/\D/g, '');
    if (digits.length <= 8) return '*'.repeat(match.length);
    return digits.slice(0, 4) + '*'.repeat(digits.length - 8) + digits.slice(-4);
  }

  /**
   * Factory for API key masking.
   * Keeps the first `prefixLen + 2` characters; masks the remainder with '*'.
   *
   * Example (prefixLen = 3 for "sk-"):
   *   sk-1234567890abcdefghij  →  sk-12******************
   */
  function apiKeyMask(prefixLen) {
    return (match) => {
      const keep = prefixLen + 2;
      return match.slice(0, keep) + '*'.repeat(Math.max(0, match.length - keep));
    };
  }

  /**
   * Mask a US Social Security Number.
   * 123-45-6789  →  123-**-****
   * Keep area segment; mask group and serial.
   */
  function maskSsn(match) {
    const parts = match.split('-');
    if (parts.length !== 3) return '***-**-****';
    return parts[0] + '-**-****';
  }

  /**
   * Mask an IBAN.
   * GB29NWBK60161331926819  →  GB29******************19
   * Keep first 4 characters (country + check digits) and last 2.
   */
  function maskIban(match) {
    if (match.length <= 6) return match;
    return match.slice(0, 4) + '*'.repeat(match.length - 6) + match.slice(-2);
  }

  // ---------------------------------------------------------------------------
  // Pattern registry.
  //
  // Each entry may include:
  //   re       – RegExp to find candidates (required)
  //   label    – Human-readable label shown in the banner (required)
  //   severity – 'warning' (yellow, default) | 'high' (red)
  //   validate – Optional function(matchString) => boolean for extra validation.
  //              When present, only validated matches are reported.
  //   maskFn   – Optional function(matchString) => maskedString.
  //              Used by maskText() to replace a detected match in-place.
  // ---------------------------------------------------------------------------
  const PATTERNS = {
    // --- Known-prefix API keys / tokens (all high severity) -----------------
    anthropic_key:  { re: /sk-ant-[a-zA-Z0-9\-]{20,}/,   label: 'Anthropic API key',        severity: 'high', maskFn: apiKeyMask(7)  },
    openai_key:     { re: /\bsk-[a-zA-Z0-9]{20,}/,         label: 'OpenAI API key',            severity: 'high', maskFn: apiKeyMask(3)  },
    openai_proj:    { re: /\bsk-proj-[a-zA-Z0-9\-]{20,}/, label: 'OpenAI project key',         severity: 'high', maskFn: apiKeyMask(8)  },
    google_key:     { re: /AIza[0-9A-Za-z_\-]{35}/,        label: 'Google API key',             severity: 'high', maskFn: apiKeyMask(4)  },
    github_pat:     { re: /ghp_[a-zA-Z0-9]{36}/,           label: 'GitHub PAT',                 severity: 'high', maskFn: apiKeyMask(4)  },
    github_oauth:   { re: /gho_[a-zA-Z0-9]{36}/,           label: 'GitHub OAuth token',         severity: 'high', maskFn: apiKeyMask(4)  },
    github_server:  { re: /ghs_[a-zA-Z0-9]{36}/,           label: 'GitHub server token',        severity: 'high', maskFn: apiKeyMask(4)  },
    github_refresh: { re: /ghr_[a-zA-Z0-9]{76}/,           label: 'GitHub refresh token',       severity: 'high', maskFn: apiKeyMask(4)  },
    github_user:    { re: /ghu_[a-zA-Z0-9]{36}/,           label: 'GitHub user token',          severity: 'high', maskFn: apiKeyMask(4)  },
    gitlab_pat:     { re: /glpat-[a-zA-Z0-9\-_]{20,}/,    label: 'GitLab PAT',                 severity: 'high', maskFn: apiKeyMask(6)  },
    aws_key:        { re: /AKIA[0-9A-Z]{16}/,               label: 'AWS access key',             severity: 'high', maskFn: apiKeyMask(4)  },
    slack_bot:      { re: /xoxb-[0-9A-Za-z\-]{24,}/,      label: 'Slack bot token',            severity: 'high', maskFn: apiKeyMask(5)  },
    slack_user:     { re: /xoxp-[0-9A-Za-z\-]{24,}/,      label: 'Slack user token',           severity: 'high', maskFn: apiKeyMask(5)  },
    slack_app:      { re: /xoxa-[0-9A-Za-z\-]{24,}/,      label: 'Slack app token',            severity: 'high', maskFn: apiKeyMask(5)  },
    slack_config:   { re: /xoxs-[0-9A-Za-z\-]{24,}/,      label: 'Slack config token',         severity: 'high', maskFn: apiKeyMask(5)  },
    stripe_live:    { re: /sk_live_[0-9a-zA-Z]{24,}/,      label: 'Stripe live secret key',     severity: 'high', maskFn: apiKeyMask(8)  },
    stripe_test:    { re: /sk_test_[0-9a-zA-Z]{24,}/,      label: 'Stripe test secret key',     severity: 'high', maskFn: apiKeyMask(8)  },
    npm_token:      { re: /\bnpm_[a-zA-Z0-9]{36}/,         label: 'npm access token',           severity: 'high', maskFn: apiKeyMask(4)  },
    // JWTs: three base64url segments.
    jwt:            { re: /eyJ[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]{10,}/, label: 'JWT / Bearer token', severity: 'high', maskFn: apiKeyMask(3) },

    // --- PII patterns -------------------------------------------------------
    ssn: {
      re: /\b\d{3}-\d{2}-\d{4}\b/,
      label: 'US Social Security Number (SSN)',
      severity: 'high',
      validate(match) {
        const area = parseInt(match.slice(0, 3), 10);
        return area !== 0 && area !== 666 && area < 900;
      },
      maskFn: maskSsn,
    },
    email:    { re: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/, label: 'email address',    severity: 'low',  maskFn: maskEmail },
    password: { re: /(?:password|passwd|pwd|salasana)\s*[:=]\s*\S+/i,     label: 'password pattern', severity: 'medium' },
    iban:     {
      // ReDoS-safe IBAN pattern.
      //
      // Structure: CC (exactly 2 uppercase letters) + check digits (exactly 2
      // digits) + BBAN head (exactly 4 alphanumeric chars, fixed width) +
      // BBAN tail (0-26 alphanumeric chars, bounded, no nesting).
      //
      // All quantifiers are either fixed-width or a single bounded range applied
      // to a non-overlapping character class. There are no nested quantifiers or
      // adjacent groups with overlapping character classes, so catastrophic
      // backtracking is impossible. Total BBAN length is 4-30 chars, covering
      // all current IBAN country formats.
      re: /\b[A-Z]{2}\d{2}[A-Z0-9]{4}[A-Z0-9]{0,26}\b/,
      label: 'IBAN number',
      severity: 'low',
      maskFn: maskIban,
    },
    credit_card: {
      // ReDoS-safe credit card pattern — three non-overlapping alternatives:
      //
      // 1. Amex 4-6-5 layout with a space or dash separator (e.g. 3782 822463
      //    10005).  Listed first so it is preferred over the generic run below
      //    when the input matches this specific format.
      //
      // 2. Uniform separated groups: exactly 4 digits, then 2-4 more groups of
      //    exactly 4 digits, joined by a single space or dash.  No digit-class
      //    overlap between the groups and the separators.
      //    Covers: 4-4-4-4 (Visa/MC/Discover), 4-4-4-4-4 (19-digit Maestro).
      //
      // 3. Unseparated run: 13-19 consecutive digits with word boundaries.
      //    Catches the compact (no separator) form of all card types including
      //    Amex (15 digits).
      //
      // The validate() Luhn check filters false positives from all alternatives.
      re: /\b\d{4}[ \-]\d{6}[ \-]\d{5}\b|\b\d{4}(?:[ \-]\d{4}){2,4}\b|\b\d{13,19}\b/,
      label: 'credit card number',
      severity: 'high',
      validate(match) {
        const digits = match.replace(/[\s\-]/g, '');
        return digits.length >= 13 && digits.length <= 19 && luhn(digits);
      },
      maskFn: maskCreditCard,
    },
  };

  // ---------------------------------------------------------------------------
  // Entropy scanner — catches high-entropy tokens with no known prefix.
  //
  // Finds every alphanumeric run of 20+ characters in the text and flags runs
  // whose Shannon entropy exceeds ENTROPY_THRESHOLD as a potential API key /
  // secret token with high severity.
  // ---------------------------------------------------------------------------
  const ENTROPY_THRESHOLD = 4.5;
  const ENTROPY_MIN_LEN   = 20;
  const TOKEN_RE = new RegExp(`[a-zA-Z0-9+/]{${ENTROPY_MIN_LEN},}`, 'g');

  function scanEntropy(text) {
    const hits = [];
    for (const match of text.matchAll(TOKEN_RE)) {
      if (shannonEntropy(match[0]) > ENTROPY_THRESHOLD) {
        hits.push({
          label: 'high-entropy token (possible API key/secret)',
          severity: 'high',
          match: match[0],
          index: match.index,
          maskFn: apiKeyMask(0),
        });
        break; // one entropy hit per scan is enough
      }
    }
    return hits;
  }

  const BANNER_ID = 'pm-dlp-banner';

  // Tracks whether the last scan produced a high-severity hit, independently
  // of banner visibility.  Used by isHighBannerActive() so that dismissing the
  // banner (visual-only) does not suppress the Send intercept popup.
  let _hasHighAlert = false;

  // ---------------------------------------------------------------------------
  // Banner positioning — fixed, anchored below the entire composer area.
  //
  // "Composer area" = the ancestor of the input that also contains the send
  // button(s).  Anchoring to this element (rather than the raw input) means
  // the banner appears below the toolbar row (Tools / Fast / Send buttons),
  // not overlapping it.
  //
  // State is kept at module level so hideBanner() can clean up listeners even
  // when it doesn't have a reference to the original anchorEl.
  // ---------------------------------------------------------------------------

  /** @type {ResizeObserver|null} */
  let _bannerResizeObs = null;
  /** @type {(() => void)|null} */
  let _bannerScrollFn = null;

  /**
   * Walk up from inputEl and return the first ancestor that also contains a
   * known send button — i.e. the full composer area including toolbar.
   * Falls back to the input element itself if no send button is found.
   *
   * @param {Element} inputEl
   * @returns {Element}
   */
  function findComposerEl(inputEl) {
    let el = inputEl.parentElement;
    while (el && el !== document.body) {
      const hasSend = SUBMIT_SELECTORS.some(sel => {
        try { return el.querySelector(sel) !== null; } catch { return false; }
      });
      if (hasSend) return el;
      el = el.parentElement;
    }
    return inputEl;
  }

  /**
   * Position the banner directly below `anchorEl` using fixed coordinates.
   *
   * @param {HTMLElement} banner
   * @param {Element}     anchorEl
   */
  function positionBanner(banner, anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    banner.style.left  = rect.left + 'px';
    banner.style.width = rect.width + 'px';
    banner.style.top   = (rect.bottom + 4) + 'px';
    banner.style.bottom    = '';
    banner.style.transform = '';
  }

  /**
   * Attach ResizeObserver + scroll listener so the banner follows the composer.
   *
   * @param {HTMLElement} banner
   * @param {Element}     anchorEl
   */
  function attachBannerPositioning(banner, anchorEl) {
    detachBannerPositioning();
    positionBanner(banner, anchorEl);
    _bannerResizeObs = new ResizeObserver(() => positionBanner(banner, anchorEl));
    _bannerResizeObs.observe(anchorEl);
    _bannerScrollFn = () => positionBanner(banner, anchorEl);
    window.addEventListener('scroll', _bannerScrollFn, { passive: true, capture: true });
  }

  /** Disconnect ResizeObserver and remove the scroll listener. */
  function detachBannerPositioning() {
    if (_bannerResizeObs) {
      _bannerResizeObs.disconnect();
      _bannerResizeObs = null;
    }
    if (_bannerScrollFn) {
      window.removeEventListener('scroll', _bannerScrollFn, { capture: true });
      _bannerScrollFn = null;
    }
  }

  // ---------------------------------------------------------------------------
  // scanText(text) — returns an array of hit objects for every detected match.
  //
  // Each hit: { label, severity, match, index, maskFn? }
  //   label    – human-readable pattern name
  //   severity – 'high' | 'medium' | 'low'
  //   match    – the exact matched substring
  //   index    – character position of match in text
  //   maskFn   – (match: string) => string, if the pattern supports masking
  //
  // Multiple occurrences of the same pattern each produce a separate hit so
  // that maskText() can replace every instance.  showBanner() deduplicates by
  // label when building the user-facing message.
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Scan timeout — if wall-clock time inside scanText() exceeds this many
  // milliseconds the scan is aborted and an empty result is returned so the
  // tab never freezes due to a pathological input string.
  // ---------------------------------------------------------------------------
  const SCAN_TIMEOUT_MS = 50;

  function scanText(text) {
    const t0 = performance.now();

    /**
     * Returns true when the scan has already consumed more than SCAN_TIMEOUT_MS
     * wall-clock milliseconds.  Call this between each major work unit so we
     * can bail out without blocking the main thread for longer than the budget.
     */
    function timedOut() {
      if (performance.now() - t0 > SCAN_TIMEOUT_MS) {
        console.warn(
          '[Prompt Masker] DLP: scanText() aborted — scan exceeded ' + SCAN_TIMEOUT_MS +
          ' ms on the current input. Returning empty result.',
          DLP_LOG_CTX,
        );
        return true;
      }
      return false;
    }

    const hits = [];

    // 1. Known-prefix and PII pattern checks — collect every occurrence.
    for (const [, pattern] of Object.entries(PATTERNS)) {
      // Check the budget before each pattern so a single slow regex cannot
      // push us past the deadline without us noticing.
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

    // 2. Entropy-based check — only when no high-severity hit was already found.
    if (!hits.some(h => h.severity === 'high') && !timedOut()) {
      hits.push(...scanEntropy(text));
    }

    return hits;
  }

  // ---------------------------------------------------------------------------
  // maskText(text) — returns text with every detected sensitive match replaced
  // by its masked equivalent.
  //
  // Replacements are applied in reverse index order so that earlier positions
  // are not shifted by substitutions that precede them.
  // ---------------------------------------------------------------------------
  function maskText(text) {
    const hits = scanText(text);

    // Only mask hits that have both a position and a masking function.
    const maskable = hits.filter(h => h.maskFn && h.match !== undefined && h.index !== undefined);

    // Sort descending by index so replacements don't shift subsequent positions.
    maskable.sort((a, b) => b.index - a.index);

    let result = text;
    for (const hit of maskable) {
      const masked = hit.maskFn(hit.match);
      result = result.slice(0, hit.index) + masked + result.slice(hit.index + hit.match.length);
    }
    return result;
  }

  function getInputText(el) {
    return el.tagName === 'TEXTAREA' ? el.value : el.innerText || el.textContent;
  }

  /**
   * Write `text` back into an input element in a way that updates the
   * platform's internal framework state (React, Lit, etc.), not just the DOM.
   *
   * - Textarea (ChatGPT): Use the native HTMLTextAreaElement value setter so
   *   React's synthetic event system sees a real value change.
   * - Contenteditable (Gemini, Claude.ai): Use execCommand('insertText') which
   *   the browser treats as a trusted user edit, correctly syncing all frameworks.
   *
   * @param {Element} el   - The monitored input (textarea or contenteditable).
   * @param {string}  text - The new value to set.
   */
  function setInputValue(el, text) {
    if (el.tagName === 'TEXTAREA') {
      // Native setter bypasses React's property interception and triggers the
      // internal onChange machinery when followed by a bubbling 'input' event.
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype, 'value'
      ).set;
      nativeSetter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // execCommand('insertText') is treated as a genuine user keystroke by
      // React, Lit, and every other framework — the only reliable way to update
      // a contenteditable's internal state programmatically.
      el.focus();
      document.execCommand('selectAll');
      document.execCommand('insertText', false, text);
    }
  }

  // ---------------------------------------------------------------------------
  // Severity tier helpers.
  //
  // Tier ranking (highest → lowest): high > medium > low.
  // A pattern without an explicit severity defaults to 'low'.
  // ---------------------------------------------------------------------------
  const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };

  function topSeverity(hits) {
    return hits.reduce((best, h) => {
      const rank = SEVERITY_RANK[h.severity] ?? 1;
      return rank > (SEVERITY_RANK[best] ?? 1) ? h.severity : best;
    }, 'low');
  }

  const TIER_CONFIG = {
    high: {
      cssClass: 'pm-high',
      buildText: (labels) => `🔴 High – sensitive data detected: ${labels.join(', ')}`,
    },
    medium: {
      cssClass: 'pm-medium',
      buildText: () => '🟠 Medium – potentially sensitive data',
    },
    low: {
      cssClass: '',
      buildText: () => '🟡 Low – personal data detected',
    },
  };

  // hits — array of { label, severity, ... } from scanText()
  function showBanner(hits, anchorEl) {
    const severity = topSeverity(hits);
    _hasHighAlert = (severity === 'high');
    const tier = TIER_CONFIG[severity] ?? TIER_CONFIG.low;
    const uniqueLabels = [...new Set(hits.map(h => h.label))];

    // Anchor to the full composer element (input + buttons) so the banner
    // appears below the toolbar, not floating over it.
    const composerEl = findComposerEl(anchorEl);

    const sr = getSR();
    let banner = sr.getElementById(BANNER_ID);
    if (!banner) {
      banner = document.createElement('div');
      banner.id = BANNER_ID;
      banner.dataset.labels = '';
      const btn = document.createElement('button');
      btn.id = 'pm-dlp-dismiss';
      btn.textContent = '✕';
      btn.addEventListener('click', () => {
        hideBanner();
      });
      banner.appendChild(btn);
      // Append into shadow root — not document.body — for style encapsulation.
      sr.appendChild(banner);
    }

    // Apply exactly one severity modifier class; remove the others.
    banner.classList.remove('pm-high', 'pm-medium');
    if (tier.cssClass) banner.classList.add(tier.cssClass);

    // Rebuild text content, preserving the dismiss button.
    const dismiss = banner.querySelector('#pm-dlp-dismiss');
    banner.textContent = '';
    const msg = document.createElement('span');
    msg.textContent = tier.buildText(uniqueLabels);
    banner.appendChild(msg);
    banner.appendChild(dismiss);
    banner.dataset.labels = uniqueLabels.join(', ');
    banner.style.display = 'flex';

    attachBannerPositioning(banner, composerEl);
  }

  function hideBanner() {
    const banner = getSR().getElementById(BANNER_ID);
    if (banner) banner.style.display = 'none';
    detachBannerPositioning();
  }

  // ---------------------------------------------------------------------------
  // Debounce — detection runs at most once per DEBOUNCE_MS after the last
  // input event, keeping fast typing lag-free.
  //
  // Timers are tracked per element so that simultaneous inputs (e.g. two
  // textareas in the same page) never cancel each other's pending scans.
  // ---------------------------------------------------------------------------
  const DEBOUNCE_MS = 300;

  /** @type {WeakMap<Element, ReturnType<typeof setTimeout>>} */
  const debounceTimers = new WeakMap();

  function onInput(el) {
    activeInputEl = el;
    clearTimeout(debounceTimers.get(el));
    if (!getInputText(el).trim()) {
      _hasHighAlert = false;
      hideBanner();
      window.promptMaskerHighlight?.clearHighlights(el);
      return;
    }
    debounceTimers.set(el, setTimeout(() => {
      debounceTimers.delete(el);
      const text = getInputText(el);
      const hits = scanText(text);
      if (hits.length > 0) {
        showBanner(hits, el);
        // Append a record to the local audit log (no matched text stored).
        // audit.js is injected before dlp.js and exposes this global.
        window.promptMaskerAudit?.append(hits);
        // Render in-field colour highlights so users see exactly which words
        // are risky before they send.  aiAwareHighlight is loaded by
        // highlight.js which is injected before dlp.js.
        window.promptMaskerHighlight?.highlightText(el, hits);
      } else {
        _hasHighAlert = false;
        hideBanner();
        window.promptMaskerHighlight?.clearHighlights(el);
      }
    }, DEBOUNCE_MS));
  }

  // ---------------------------------------------------------------------------
  // Structured logger for DLP diagnostics.
  // ---------------------------------------------------------------------------
  const DLP_LOG_CTX = { extension: 'Prompt Masker', module: 'dlp' };

  const attached = new WeakSet();
  // Plain counter so we can detect "nothing was ever attached" without iterating
  // a WeakSet (which does not expose its size).
  let attachedCount = 0;

  function attachToInput(el) {
    if (attached.has(el)) return;
    attached.add(el);
    attachedCount++;

    el.addEventListener('input', () => {
      try { onInput(el); } catch (err) {
        console.error('[Prompt Masker] DLP input handler error:', err, DLP_LOG_CTX);
      }
    });
  }

  const INPUT_SELECTORS = [
    // ChatGPT — ProseMirror contenteditable div (newer UI, ~2024+).
    '#prompt-textarea',
    'div[contenteditable="true"][data-placeholder]',
    // Generic contenteditable textboxes (Claude.ai, older ChatGPT versions).
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    // Claude.ai rich-textarea wrapper and plain textareas (Gemini, others).
    'rich-textarea textarea',
    'textarea',
  ];

  function findAndAttach() {
    for (const sel of INPUT_SELECTORS) {
      let els;
      try {
        els = document.querySelectorAll(sel);
      } catch (err) {
        // An invalid CSS selector (e.g. after a future refactor) must never
        // propagate — log it and skip this selector silently.
        console.warn(
          '[Prompt Masker] DLP: querySelectorAll failed for selector — skipping.',
          { ...DLP_LOG_CTX, selector: sel, error: err.message },
        );
        continue;
      }
      for (const el of els) {
        if (el.closest('#pm-dlp-banner')) continue;
        try {
          attachToInput(el);
        } catch (err) {
          console.error('[Prompt Masker] DLP: attachToInput failed:', err, DLP_LOG_CTX);
        }
      }
    }
  }

  // Observe DOM for late-loading input fields (Gemini SPA).
  // The callback is wrapped in try/catch so a crash here never silently kills
  // the observer — MutationObserver swallows exceptions after the first one.
  const observer = new MutationObserver(() => {
    try {
      findAndAttach();
      // SPA navigation (e.g. "New chat") removes the old input from the DOM.
      // Hide the banner immediately rather than waiting for the first keystroke.
      if (activeInputEl && !document.contains(activeInputEl)) {
        activeInputEl = null;
        _hasHighAlert = false;
        hideBanner();
      } else if (activeInputEl && !getInputText(activeInputEl).trim()) {
        _hasHighAlert = false;
        hideBanner();
        window.promptMaskerHighlight?.clearHighlights(activeInputEl);
      }
    } catch (err) {
      console.error('[Prompt Masker] DLP: MutationObserver callback error:', err, DLP_LOG_CTX);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  findAndAttach();

  // ---------------------------------------------------------------------------
  // Diagnostic — warn if no input elements were found after SPA hydration.
  // Runs 3 s after init; by then all three platforms have rendered their
  // composer areas.  A zero count means our INPUT_SELECTORS no longer match
  // the page structure and DLP monitoring is inactive.
  // ---------------------------------------------------------------------------
  setTimeout(() => {
    if (attachedCount === 0) {
      console.warn(
        '[Prompt Masker] DLP: no input fields found — UI may have changed. ' +
        'DLP monitoring is inactive.',
        { ...DLP_LOG_CTX, selectors: INPUT_SELECTORS },
      );
    }
  }, 3000);

  // ---------------------------------------------------------------------------
  // Shadow Block — intercept Enter key submission when a 🔴 High alert is
  // active.  Always enabled; no user toggle required.
  // ---------------------------------------------------------------------------

  /** Returns true when the last scan detected a High-severity hit.
   *  Intentionally decoupled from banner visibility so that dismissing the
   *  banner (visual-only) does not suppress the Send intercept popup. */
  function isHighBannerActive() {
    return _hasHighAlert;
  }

  // Submit-button selectors tried in order across all supported platforms.
  const SUBMIT_SELECTORS = [
    // ChatGPT (chatgpt.com and chat.openai.com)
    'button[data-testid="send-button"]',
    'button[aria-label="Send message"]',
    // Claude.ai
    'button[aria-label="Send Message"]',
    // Gemini
    'button.send-button',
    'button[aria-label="Send"]',
  ];

  // Flag that allows the programmatic re-click (from "Send anyway") to bypass
  // the send-button click interceptor below.
  let _bypassSendClick = false;

  // Tracks the most recently active monitored input element so that
  // showInterceptPopup() can read and rewrite its value for Mask & Send.
  let activeInputEl = null;

  /** Click the platform's native send / submit button. */
  function clickPlatformSubmit() {
    for (const sel of SUBMIT_SELECTORS) {
      const btn = document.querySelector(sel);
      if (btn) {
        _bypassSendClick = true;
        btn.click();
        return;
      }
    }
  }

  const INTERCEPT_OVERLAY_ID = 'pm-intercept-overlay';

  function closeIntercept() {
    const el = getSR().getElementById(INTERCEPT_OVERLAY_ID);
    if (el) el.remove();
  }

  /** Show the Security Intercept popup, giving the user a chance to cancel. */
  function showInterceptPopup() {
    closeIntercept(); // dismiss any stale overlay

    const sr = getSR();

    const overlay = document.createElement('div');
    overlay.id = INTERCEPT_OVERLAY_ID;
    overlay.className = 'pm-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'pm-intercept-title');
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeIntercept();
    });

    const dialog = document.createElement('div');
    dialog.className = 'pm-dialog';

    const icon = document.createElement('div');
    icon.className = 'pm-icon';
    icon.textContent = '🛡️';
    icon.setAttribute('aria-hidden', 'true');

    const heading = document.createElement('h2');
    heading.id = 'pm-intercept-title';
    heading.className = 'pm-heading';
    heading.textContent = 'Security Warning';

    const body = document.createElement('p');
    body.className = 'pm-body';
    body.textContent =
      (() => {
        const labels = getSR().getElementById(BANNER_ID)?.dataset.labels;
        const detail = labels ? `: ${labels}` : '';
        return `Your message appears to contain sensitive data${detail}. Are you sure you want to send it?`;
      })();

    // Corner × close button — dismisses the popup without sending.
    const closeBtn = document.createElement('button');
    closeBtn.className = 'pm-dialog-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', closeIntercept);

    const actions = document.createElement('div');
    actions.className = 'pm-actions';

    // Primary action — mask sensitive data and send.
    const maskBtn = document.createElement('button');
    maskBtn.className = 'pm-btn pm-btn-close';
    maskBtn.textContent = 'Mask & Send';
    maskBtn.addEventListener('click', () => {
      if (activeInputEl) {
        // Remove highlight spans before rewriting the value so that no
        // <span data-pm-hl> tags are present in the contenteditable when
        // setInputValue() reads or replaces the content.
        window.promptMaskerHighlight?.clearHighlights(activeInputEl);
        const masked = maskText(getInputText(activeInputEl));
        setInputValue(activeInputEl, masked);
      }
      closeIntercept();
      // Defer submit by one tick so the platform's framework (React/Lit) has
      // time to process the input event and sync its internal state before the
      // send button is clicked.  Without this, some platforms read their own
      // cached (unmasked) value from state rather than the updated DOM value.
      setTimeout(clickPlatformSubmit, 0);
    });

    // Secondary action — send the original unmasked message.
    const sendBtn = document.createElement('button');
    sendBtn.className = 'pm-btn pm-btn-proceed';
    sendBtn.textContent = 'Continue anyway';
    sendBtn.addEventListener('click', () => {
      closeIntercept();
      // Strip highlight spans before submitting so the platform never receives
      // raw <span data-pm-hl> tags as part of the message content.
      if (activeInputEl) window.promptMaskerHighlight?.clearHighlights(activeInputEl);
      clickPlatformSubmit();
    });

    actions.append(maskBtn, sendBtn);
    dialog.append(closeBtn, icon, heading, body, actions);
    overlay.appendChild(dialog);
    // Append into shadow root — not document.body — for style encapsulation.
    sr.appendChild(overlay);

    maskBtn.focus();
  }

  // Close the intercept popup with Escape.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && getSR().getElementById(INTERCEPT_OVERLAY_ID)) {
      e.preventDefault();
      closeIntercept();
    }
  }, /* capture = */ true);

  // Capture-phase listener so we run before the platform's own submit handler.
  document.addEventListener('keydown', (e) => {
    // Only plain Enter triggers submission; Shift+Enter is a newline.
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey) return;
    if (!isHighBannerActive()) return;

    const target = /** @type {Element} */ (e.target);
    if (!(target instanceof Element)) return;
    // Only intercept inputs that DLP is actively monitoring.
    if (!attached.has(target)) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    showInterceptPopup();
  }, /* capture = */ true);

  // ---------------------------------------------------------------------------
  // Send-button click intercept — mirrors the Enter-key intercept above so
  // that mouse-driven submission is also protected when a 🔴 High alert is
  // active.
  // ---------------------------------------------------------------------------
  document.addEventListener('click', (e) => {
    // Allow the programmatic re-click from "Send anyway" to pass through.
    if (_bypassSendClick) {
      _bypassSendClick = false;
      return;
    }

    if (!isHighBannerActive()) return;

    const target = /** @type {Element} */ (e.target);
    if (!(target instanceof Element)) return;

    // Check whether the click landed on (or inside) a recognised send button.
    const isSendButton = SUBMIT_SELECTORS.some(sel => {
      try { return target.closest(sel) !== null; } catch { return false; }
    });
    if (!isSendButton) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    showInterceptPopup();
  }, /* capture = */ true);

  // ---------------------------------------------------------------------------
  // Capture-phase paste interceptor — fires before any stopPropagation call
  // inside host-page components (e.g. Gemini's <rich-textarea>), which would
  // prevent a bubble-phase listener on our monitored element from running.
  //
  // Walks up from e.target to find the nearest monitored ancestor, then reads
  // clipboardData synchronously and shows the banner with zero delay.
  // ---------------------------------------------------------------------------
  document.addEventListener('paste', (e) => {
    let monitoredEl = null;
    let node = e.target instanceof Element ? e.target : null;
    while (node instanceof Element) {
      if (attached.has(node)) { monitoredEl = node; break; }
      node = node.parentElement;
    }
    if (!monitoredEl) return;

    activeInputEl = monitoredEl;
    clearTimeout(debounceTimers.get(monitoredEl));
    debounceTimers.delete(monitoredEl);

    const clipText = e.clipboardData?.getData('text/plain') ?? '';

    if (!clipText.trim()) {
      setTimeout(() => {
        try { onInput(monitoredEl); } catch (err) {
          console.error('[Prompt Masker] DLP paste handler error:', err, DLP_LOG_CTX);
        }
      }, 0);
      return;
    }

    const hits = scanText(clipText);
    if (hits.length > 0) {
      showBanner(hits, monitoredEl);
      window.promptMaskerAudit?.append(hits);
      requestAnimationFrame(() => {
        try {
          window.promptMaskerHighlight?.highlightText(monitoredEl, hits);
        } catch (err) {
          console.error('[Prompt Masker] DLP paste highlight error:', err, DLP_LOG_CTX);
        }
      });
    } else {
      _hasHighAlert = false;
      hideBanner();
      window.promptMaskerHighlight?.clearHighlights(monitoredEl);
    }
  }, /* capture = */ true);

  // ---------------------------------------------------------------------------
  // Public API — exposed for use by other extension scripts and tests.
  // ---------------------------------------------------------------------------
  window.promptMasker = { scanText, maskText };

})();
