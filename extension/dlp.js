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
    anthropic_key: { re: /sk-ant-[a-zA-Z0-9\-]{20,}/, label: 'Anthropic API key' },
    openai_key:    { re: /sk-[a-zA-Z0-9]{20,}/,        label: 'OpenAI API key' },
    google_key:    { re: /AIza[0-9A-Za-z_\-]{35}/,      label: 'Google API key' },
    github_token:  { re: /ghp_[a-zA-Z0-9]{36}/,         label: 'GitHub token' },
    aws_key:       { re: /AKIA[0-9A-Z]{16}/,             label: 'AWS access key' },
    email:         { re: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/, label: 'sähköpostiosoite' },
    password:      { re: /(?:password|passwd|pwd|salasana)\s*[:=]\s*\S+/i,     label: 'salasana' },
    iban:          { re: /\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/,                   label: 'IBAN-tilinumero' },
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

  const BANNER_ID = 'ps-dlp-banner';
  const DISMISS_KEY = 'ps-dlp-dismissed';

  // Returns an array of { label, severity } objects for every pattern that fires.
  function scanText(text) {
    const hits = [];
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
