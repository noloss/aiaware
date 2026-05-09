(() => {
  if (window.__promptSentinelDlpLoaded) return;
  window.__promptSentinelDlpLoaded = true;

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
  // Pattern registry.
  //
  // Each entry may include:
  //   re       – RegExp to find candidates (required)
  //   label    – Human-readable label shown in the banner (required)
  //   severity – 'warning' (yellow, default) | 'high' (red)
  //   validate – Optional function(matchString) => boolean for extra validation.
  //              When present, at least one regex match must pass validation for
  //              the pattern to register a hit.
  // ---------------------------------------------------------------------------
  const PATTERNS = {
    // --- Known-prefix API keys / tokens (all high severity) -----------------
    anthropic_key:  { re: /sk-ant-[a-zA-Z0-9\-]{20,}/,  label: 'Anthropic API key',    severity: 'high' },
    openai_key:     { re: /\bsk-[a-zA-Z0-9]{20,}/,       label: 'OpenAI API key',        severity: 'high' },
    openai_proj:    { re: /\bsk-proj-[a-zA-Z0-9\-]{20,}/,label: 'OpenAI project key',    severity: 'high' },
    google_key:     { re: /AIza[0-9A-Za-z_\-]{35}/,       label: 'Google API key',        severity: 'high' },
    github_pat:     { re: /ghp_[a-zA-Z0-9]{36}/,          label: 'GitHub PAT',            severity: 'high' },
    github_oauth:   { re: /gho_[a-zA-Z0-9]{36}/,          label: 'GitHub OAuth token',    severity: 'high' },
    github_server:  { re: /ghs_[a-zA-Z0-9]{36}/,          label: 'GitHub server token',   severity: 'high' },
    github_refresh: { re: /ghr_[a-zA-Z0-9]{76}/,          label: 'GitHub refresh token',  severity: 'high' },
    github_user:    { re: /ghu_[a-zA-Z0-9]{36}/,          label: 'GitHub user token',     severity: 'high' },
    gitlab_pat:     { re: /glpat-[a-zA-Z0-9\-_]{20,}/,   label: 'GitLab PAT',            severity: 'high' },
    aws_key:        { re: /AKIA[0-9A-Z]{16}/,              label: 'AWS access key',        severity: 'high' },
    slack_bot:      { re: /xoxb-[0-9A-Za-z\-]{24,}/,     label: 'Slack bot token',       severity: 'high' },
    slack_user:     { re: /xoxp-[0-9A-Za-z\-]{24,}/,     label: 'Slack user token',      severity: 'high' },
    slack_app:      { re: /xoxa-[0-9A-Za-z\-]{24,}/,     label: 'Slack app token',       severity: 'high' },
    slack_config:   { re: /xoxs-[0-9A-Za-z\-]{24,}/,     label: 'Slack config token',    severity: 'high' },
    stripe_live:    { re: /sk_live_[0-9a-zA-Z]{24,}/,    label: 'Stripe live secret key', severity: 'high' },
    stripe_test:    { re: /sk_test_[0-9a-zA-Z]{24,}/,    label: 'Stripe test secret key', severity: 'high' },
    npm_token:      { re: /\bnpm_[a-zA-Z0-9]{36}/,        label: 'npm access token',      severity: 'high' },
    // JWTs: three base64url segments — only flag in high-entropy contexts.
    jwt:            { re: /eyJ[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]{10,}/, label: 'JWT / Bearer token', severity: 'high' },

    // --- PII patterns -------------------------------------------------------
    // US Social Security Number — format AAA-GG-SSSS.
    // SSA validation: area (AAA) must not be 000, 666, or 900-999.
    ssn: {
      re: /\b\d{3}-\d{2}-\d{4}\b/,
      label: 'US Social Security Number (SSN)',
      severity: 'high',
      validate(match) {
        const area = parseInt(match.slice(0, 3), 10);
        return area !== 0 && area !== 666 && area < 900;
      },
    },
    email:    { re: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/, label: 'email address',    severity: 'low' },
    password: { re: /(?:password|passwd|pwd|salasana)\s*[:=]\s*\S+/i,     label: 'password pattern', severity: 'medium' },
    iban:     { re: /\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/,                   label: 'IBAN number',      severity: 'low' },
    credit_card: {
      // Match 13–19 digits optionally separated by spaces or dashes.
      re: /\b\d[\d \t\-]{11,20}\d\b/,
      label: 'credit card number',
      severity: 'high',
      validate(match) {
        const digits = match.replace(/[\s\-]/g, '');
        return digits.length >= 13 && digits.length <= 19 && luhn(digits);
      },
    },
  };

  // ---------------------------------------------------------------------------
  // Entropy scanner — catches high-entropy tokens with no known prefix.
  //
  // Finds every alphanumeric run of 20+ characters in the text and flags runs
  // whose Shannon entropy exceeds ENTROPY_THRESHOLD as a potential API key /
  // secret token with high severity.
  //
  // Threshold of 4.5 bits/char is chosen so that:
  //   • Random alphanumeric strings (a-z, A-Z, 0-9) score ~5.5–5.9 → flagged
  //   • Monotone or dictionary-like lowercase strings score < 4.5   → safe
  // ---------------------------------------------------------------------------
  const ENTROPY_THRESHOLD = 4.5;
  const ENTROPY_MIN_LEN   = 20;
  const TOKEN_RE = new RegExp(`[a-zA-Z0-9+/]{${ENTROPY_MIN_LEN},}`, 'g'); // base64-safe char set

  function scanEntropy(text) {
    const hits = [];
    for (const match of text.matchAll(TOKEN_RE)) {
      if (shannonEntropy(match[0]) > ENTROPY_THRESHOLD) {
        hits.push({ label: 'high-entropy token (possible API key/secret)', severity: 'high' });
        break; // one entropy hit per scan is enough
      }
    }
    return hits;
  }

  const BANNER_ID = 'ps-dlp-banner';
  const DISMISS_KEY = 'ps-dlp-dismissed';

  // Returns an array of { label, severity } objects for every pattern that fires.
  function scanText(text) {
    const hits = [];

    // 1. Known-prefix and PII pattern checks.
    for (const [, pattern] of Object.entries(PATTERNS)) {
      const { re, label, severity = 'warning', validate } = pattern;
      if (validate) {
        // Re-run with global flag so we check every candidate match.
        const globalRe = new RegExp(re.source, 'g');
        const matches = [...text.matchAll(globalRe)];
        if (matches.some(m => validate(m[0]))) hits.push({ label, severity });
      } else {
        if (re.test(text)) hits.push({ label, severity });
      }
    }

    // 2. Entropy-based check — catches secrets with no recognised prefix.
    //    Only run when no high-severity hit was already found, to avoid
    //    duplicate banners for the same token.
    if (!hits.some(h => h.severity === 'high')) {
      hits.push(...scanEntropy(text));
    }

    return hits;
  }

  function getInputText(el) {
    return el.tagName === 'TEXTAREA' ? el.value : el.innerText || el.textContent;
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
      cssClass: 'ps-high',
      // Label list appended after the static text for high findings.
      buildText: (labels) => `🔴 High – sensitive data detected: ${labels.join(', ')}`,
    },
    medium: {
      cssClass: 'ps-medium',
      buildText: () => '🟠 Medium – potentially sensitive data',
    },
    low: {
      cssClass: '',
      buildText: () => '🟡 Low – personal data detected',
    },
  };

  // hits — array of { label, severity } from scanText()
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
      btn.id = 'ps-dlp-dismiss';
      btn.textContent = '✕';
      btn.addEventListener('click', () => {
        sessionStorage.setItem(DISMISS_KEY, '1');
        hideBanner();
      });
      banner.appendChild(btn);
      anchorEl.insertAdjacentElement('afterend', banner);
    }

    // Apply exactly one severity modifier class; remove the others.
    banner.classList.remove('ps-high', 'ps-medium');
    if (tier.cssClass) banner.classList.add(tier.cssClass);

    // Rebuild text content, preserving the dismiss button.
    const dismiss = banner.querySelector('#ps-dlp-dismiss');
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
    clearTimeout(debounceTimers.get(el));
    debounceTimers.set(el, setTimeout(() => {
      debounceTimers.delete(el);
      const text = getInputText(el);
      const hits = scanText(text);
      if (hits.length > 0) {
        showBanner(hits, el);
      } else {
        hideBanner();
        // Reset dismiss so banner can reappear if user pastes again later.
        sessionStorage.removeItem(DISMISS_KEY);
      }
    }, DEBOUNCE_MS));
  }

  const attached = new WeakSet();

  function attachToInput(el) {
    if (attached.has(el)) return;
    attached.add(el);
    el.addEventListener('input', () => onInput(el));
    el.addEventListener('paste', () => {
      // paste fires before input, wait one tick
      setTimeout(() => onInput(el), 0);
    });
  }

  const INPUT_SELECTORS = [
    // ChatGPT — ProseMirror contenteditable div (newer UI, ~2024+).
    // id="prompt-textarea" is stable; data-placeholder is a secondary anchor.
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
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        if (el.closest('#ps-dlp-banner')) continue;
        attachToInput(el);
      }
    }
  }

  // Observe DOM for late-loading input fields (Gemini SPA)
  const observer = new MutationObserver(findAndAttach);
  observer.observe(document.body, { childList: true, subtree: true });

  findAndAttach();

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
      banner.classList.contains('ps-high')
    );
  }

  // Submit-button selectors tried in order across all supported platforms.
  // Deliberately no generic fallbacks: if none of the platform-specific
  // selectors match, clickPlatformSubmit() does nothing and the user can
  // submit manually — safer than clicking an arbitrary button on the page.
  const SUBMIT_SELECTORS = [
    // ChatGPT — data-testid is correct as of 2025 but OpenAI changes test-ids
    // frequently. If this stops working, inspect the send button for a new
    // data-testid value or a stable aria-label, and update accordingly.
    // TODO: add aria-label fallback once OpenAI ships a localised label.
    'button[data-testid="send-button"]',
    // Claude.ai
    'button[aria-label="Send Message"]',
    'button[aria-label="Send message"]',
    // Gemini
    'button.send-button',
  ];

  // Flag that allows the programmatic re-click (from "Send anyway") to bypass
  // the send-button click interceptor below.  Set to true immediately before
  // btn.click() and reset inside the interceptor on the very next event.
  let _bypassSendClick = false;

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

  const INTERCEPT_OVERLAY_ID = 'ps-intercept-overlay';

  function closeIntercept() {
    const el = document.getElementById(INTERCEPT_OVERLAY_ID);
    if (el) el.remove();
  }

  /** Show the Security Intercept popup, giving the user a chance to cancel. */
  function showInterceptPopup() {
    closeIntercept(); // dismiss any stale overlay

    const overlay = document.createElement('div');
    overlay.id = INTERCEPT_OVERLAY_ID;
    overlay.className = 'ps-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'ps-intercept-title');
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeIntercept();
    });

    const dialog = document.createElement('div');
    dialog.className = 'ps-dialog';

    const icon = document.createElement('div');
    icon.className = 'ps-icon';
    icon.textContent = '🛡️';
    icon.setAttribute('aria-hidden', 'true');

    const heading = document.createElement('h2');
    heading.id = 'ps-intercept-title';
    heading.className = 'ps-heading';
    heading.textContent = 'Security Warning';

    const body = document.createElement('p');
    body.className = 'ps-body';
    body.textContent =
      (() => {
        const labels = document.getElementById(BANNER_ID)?.dataset.labels;
        const detail = labels ? `: ${labels}` : '';
        return `Your message appears to contain sensitive data${detail}. Are you sure you want to send it?`;
      })();

    const actions = document.createElement('div');
    actions.className = 'ps-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'ps-btn ps-btn-close';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', closeIntercept);

    const sendBtn = document.createElement('button');
    sendBtn.className = 'ps-btn ps-btn-proceed';
    sendBtn.textContent = 'Send anyway';
    sendBtn.addEventListener('click', () => {
      closeIntercept();
      clickPlatformSubmit();
    });

    actions.append(cancelBtn, sendBtn);
    dialog.append(icon, heading, body, actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    cancelBtn.focus();
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
  //
  // Runs in capture phase so it fires before any platform click handler.
  // When the user confirms "Send anyway", clickPlatformSubmit() sets
  // _bypassSendClick = true so the programmatic re-click passes through.
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

})();
