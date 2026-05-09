(() => {
  if (window.__promptSentinelDlpLoaded) return;
  window.__promptSentinelDlpLoaded = true;

  const PATTERNS = {
    anthropic_key: { re: /sk-ant-[a-zA-Z0-9\-]{20,}/, label: 'Anthropic API key' },
    openai_key:    { re: /sk-[a-zA-Z0-9]{20,}/,        label: 'OpenAI API key' },
    google_key:    { re: /AIza[0-9A-Za-z_\-]{35}/,      label: 'Google API key' },
    github_token:  { re: /ghp_[a-zA-Z0-9]{36}/,         label: 'GitHub token' },
    aws_key:       { re: /AKIA[0-9A-Z]{16}/,             label: 'AWS access key' },
    email:         { re: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/, label: 'sähköpostiosoite' },
    password:      { re: /(?:password|passwd|pwd|salasana)\s*[:=]\s*\S+/i,     label: 'salasana' },
    iban:          { re: /\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/,                   label: 'IBAN-tilinumero' },
  };

  const BANNER_ID = 'ps-dlp-banner';
  const DISMISS_KEY = 'ps-dlp-dismissed';

  function scanText(text) {
    const hits = [];
    for (const [, { re, label }] of Object.entries(PATTERNS)) {
      if (re.test(text)) hits.push(label);
    }
    return hits;
  }

  function getInputText(el) {
    return el.tagName === 'TEXTAREA' ? el.value : el.innerText || el.textContent;
  }

  function showBanner(labels, anchorEl) {
    if (sessionStorage.getItem(DISMISS_KEY)) return;

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

    const unique = [...new Set(labels)];
    // Update text content (keep dismiss button)
    const dismiss = banner.querySelector('#ps-dlp-dismiss');
    banner.textContent = '';
    const msg = document.createElement('span');
    msg.textContent = `⚠️ Syötteessäsi saattaa olla arkaluonteista tietoa – havaittu: ${unique.join(', ')}`;
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
