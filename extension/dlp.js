(() => {
  if (window.__aiAwareDlpLoaded) return;
  window.__aiAwareDlpLoaded = true;

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
      re: /\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/,
      label: 'IBAN number',
      severity: 'low',
      maskFn: maskIban,
    },
    credit_card: {
      // Match 13–19 digits optionally separated by spaces or dashes.
      re: /\b\d[\d \t\-]{11,20}\d\b/,
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

  const BANNER_ID = 'aa-dlp-banner';
  const DISMISS_KEY = 'aa-dlp-dismissed';

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
  function scanText(text) {
    const hits = [];

    // 1. Known-prefix and PII pattern checks — collect every occurrence.
    for (const [, pattern] of Object.entries(PATTERNS)) {
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
    if (!hits.some(h => h.severity === 'high')) {
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
      cssClass: 'aa-high',
      buildText: (labels) => `🔴 High – sensitive data detected: ${labels.join(', ')}`,
    },
    medium: {
      cssClass: 'aa-medium',
      buildText: () => '🟠 Medium – potentially sensitive data',
    },
    low: {
      cssClass: '',
      buildText: () => '🟡 Low – personal data detected',
    },
  };

  // hits — array of { label, severity, ... } from scanText()
  function showBanner(hits, anchorEl) {
    if (sessionStorage.getItem(DISMISS_KEY)) return;

    const severity = topSeverity(hits);
    const tier = TIER_CONFIG[severity] ?? TIER_CONFIG.low;
    const uniqueLabels = [...new Set(hits.map(h => h.label))];

    let banner = document.getElementById(BANNER_ID);
    if (!banner) {
      banner = document.createElement('div');
      banner.id = BANNER_ID;
      banner.dataset.labels = '';
      const btn = document.createElement('button');
      btn.id = 'aa-dlp-dismiss';
      btn.textContent = '✕';
      btn.addEventListener('click', () => {
        sessionStorage.setItem(DISMISS_KEY, '1');
        hideBanner();
      });
      banner.appendChild(btn);
      // Append to <body> so the fixed-position banner is never clipped by a
      // parent element's overflow or flex layout on any supported platform.
      document.body.appendChild(banner);
    }

    // Apply exactly one severity modifier class; remove the others.
    banner.classList.remove('aa-high', 'aa-medium');
    if (tier.cssClass) banner.classList.add(tier.cssClass);

    // Rebuild text content, preserving the dismiss button.
    const dismiss = banner.querySelector('#aa-dlp-dismiss');
    banner.textContent = '';
    const msg = document.createElement('span');
    msg.textContent = tier.buildText(uniqueLabels);
    banner.appendChild(msg);
    banner.appendChild(dismiss);
    banner.dataset.labels = uniqueLabels.join(', ');
    banner.style.display = 'flex';
  }

  function hideBanner() {
    const banner = document.getElementById(BANNER_ID);
    if (banner) banner.style.display = 'none';
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
    debounceTimers.set(el, setTimeout(() => {
      debounceTimers.delete(el);
      const text = getInputText(el);
      const hits = scanText(text);
      if (hits.length > 0) {
        showBanner(hits, el);
        // Render in-field colour highlights so users see exactly which words
        // are risky before they send.  aiAwareHighlight is loaded by
        // highlight.js which is injected before dlp.js.
        window.aiAwareHighlight?.highlightText(el, hits);
      } else {
        hideBanner();
        window.aiAwareHighlight?.clearHighlights(el);
        // Reset dismiss so banner can reappear if user pastes again later.
        sessionStorage.removeItem(DISMISS_KEY);
      }
    }, DEBOUNCE_MS));
  }

  // ---------------------------------------------------------------------------
  // Structured logger for DLP diagnostics.
  // ---------------------------------------------------------------------------
  const DLP_LOG_CTX = { extension: 'AI Aware', module: 'dlp' };

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
        console.error('[AI Aware] DLP input handler error:', err, DLP_LOG_CTX);
      }
    });
    el.addEventListener('paste', () => {
      // paste fires before input, wait one tick
      setTimeout(() => {
        try { onInput(el); } catch (err) {
          console.error('[AI Aware] DLP paste handler error:', err, DLP_LOG_CTX);
        }
      }, 0);
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
          '[AI Aware] DLP: querySelectorAll failed for selector — skipping.',
          { ...DLP_LOG_CTX, selector: sel, error: err.message },
        );
        continue;
      }
      for (const el of els) {
        if (el.closest('#aa-dlp-banner')) continue;
        try {
          attachToInput(el);
        } catch (err) {
          console.error('[AI Aware] DLP: attachToInput failed:', err, DLP_LOG_CTX);
        }
      }
    }
  }

  // Observe DOM for late-loading input fields (Gemini SPA).
  // The callback is wrapped in try/catch so a crash here never silently kills
  // the observer — MutationObserver swallows exceptions after the first one.
  const observer = new MutationObserver(() => {
    try { findAndAttach(); } catch (err) {
      console.error('[AI Aware] DLP: MutationObserver callback error:', err, DLP_LOG_CTX);
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
        '[AI Aware] DLP: no input fields found — UI may have changed. ' +
        'DLP monitoring is inactive.',
        { ...DLP_LOG_CTX, selectors: INPUT_SELECTORS },
      );
    }
  }, 3000);

  // ---------------------------------------------------------------------------
  // Shadow Block — intercept Enter key submission when a 🔴 High alert is
  // active.  Always enabled; no user toggle required.
  // ---------------------------------------------------------------------------

  /** Returns true when the DLP banner is currently showing a High-severity hit. */
  function isHighBannerActive() {
    const banner = document.getElementById(BANNER_ID);
    return (
      banner != null &&
      banner.style.display !== 'none' &&
      banner.classList.contains('aa-high')
    );
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

  const INTERCEPT_OVERLAY_ID = 'aa-intercept-overlay';

  function closeIntercept() {
    const el = document.getElementById(INTERCEPT_OVERLAY_ID);
    if (el) el.remove();
  }

  /** Show the Security Intercept popup, giving the user a chance to cancel. */
  function showInterceptPopup() {
    closeIntercept(); // dismiss any stale overlay

    const overlay = document.createElement('div');
    overlay.id = INTERCEPT_OVERLAY_ID;
    overlay.className = 'aa-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'aa-intercept-title');
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeIntercept();
    });

    const dialog = document.createElement('div');
    dialog.className = 'aa-dialog';

    const icon = document.createElement('div');
    icon.className = 'aa-icon';
    icon.textContent = '🛡️';
    icon.setAttribute('aria-hidden', 'true');

    const heading = document.createElement('h2');
    heading.id = 'aa-intercept-title';
    heading.className = 'aa-heading';
    heading.textContent = 'Security Warning';

    const body = document.createElement('p');
    body.className = 'aa-body';
    body.textContent =
      (() => {
        const labels = document.getElementById(BANNER_ID)?.dataset.labels;
        const detail = labels ? `: ${labels}` : '';
        return `Your message appears to contain sensitive data${detail}. Are you sure you want to send it?`;
      })();

    // Corner × close button — dismisses the popup without sending.
    const closeBtn = document.createElement('button');
    closeBtn.className = 'aa-dialog-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', closeIntercept);

    const actions = document.createElement('div');
    actions.className = 'aa-actions';

    // Primary action — mask sensitive data and send.
    const maskBtn = document.createElement('button');
    maskBtn.className = 'aa-btn aa-btn-close';
    maskBtn.textContent = 'Mask & Send';
    maskBtn.addEventListener('click', () => {
      if (activeInputEl) {
        // Remove highlight spans before rewriting the value so that no
        // <span data-aa-hl> tags are present in the contenteditable when
        // setInputValue() reads or replaces the content.
        window.aiAwareHighlight?.clearHighlights(activeInputEl);
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
    sendBtn.className = 'aa-btn aa-btn-proceed';
    sendBtn.textContent = 'Continue anyway';
    sendBtn.addEventListener('click', () => {
      closeIntercept();
      // Strip highlight spans before submitting so the platform never receives
      // raw <span data-aa-hl> tags as part of the message content.
      if (activeInputEl) window.aiAwareHighlight?.clearHighlights(activeInputEl);
      clickPlatformSubmit();
    });

    actions.append(maskBtn, sendBtn);
    dialog.append(closeBtn, icon, heading, body, actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    maskBtn.focus();
  }

  // Close the intercept popup with Escape.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById(INTERCEPT_OVERLAY_ID)) {
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
  // Public API — exposed for use by other extension scripts and tests.
  // ---------------------------------------------------------------------------
  window.aiAware = { scanText, maskText };

})();
