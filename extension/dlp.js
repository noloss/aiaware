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

    // --- PII patterns (warning severity) ------------------------------------
    email:          { re: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/, label: 'sähköpostiosoite' },
    password:       { re: /(?:password|passwd|pwd|salasana)\s*[:=]\s*\S+/i,     label: 'salasana' },
    iban:           { re: /\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/,                   label: 'IBAN-tilinumero' },
    credit_card: {
      // Match 13–19 digits optionally separated by spaces or dashes.
      re: /\b\d[\d \t\-]{11,20}\d\b/,
      label: 'luottokorttinumero',
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

  // hits — array of { label, severity } from scanText()
  function showBanner(hits, anchorEl) {
    if (sessionStorage.getItem(DISMISS_KEY)) return;

    const isHigh = hits.some(h => h.severity === 'high');
    const uniqueLabels = [...new Set(hits.map(h => h.label))];

    let banner = document.getElementById(BANNER_ID);
    if (!banner) {
      banner = document.createElement('div');
      banner.id = BANNER_ID;
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

    // Severity styling — toggle the .ps-high modifier class.
    banner.classList.toggle('ps-high', isHigh);

    // Update text content (keep dismiss button).
    const dismiss = banner.querySelector('#ps-dlp-dismiss');
    banner.textContent = '';
    const icon = isHigh ? '🔴' : '⚠️';
    const msg = document.createElement('span');
    msg.textContent = `${icon} Syötteessäsi saattaa olla arkaluonteista tietoa – havaittu: ${uniqueLabels.join(', ')}`;
    banner.appendChild(msg);
    banner.appendChild(dismiss);
    banner.style.display = 'flex';
  }

  function hideBanner() {
    const banner = document.getElementById(BANNER_ID);
    if (banner) banner.style.display = 'none';
  }

  let debounceTimer = null;
  function onInput(el) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const text = getInputText(el);
      const hits = scanText(text);
      if (hits.length > 0) {
        showBanner(hits, el);
      } else {
        hideBanner();
        // Reset dismiss so banner can reappear if user pastes again later
        sessionStorage.removeItem(DISMISS_KEY);
      }
    }, 300);
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
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
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
})();
