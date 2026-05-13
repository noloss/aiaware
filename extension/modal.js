// modal.js — Warning modal for intercepted link clicks.
// Listens for the 'promptmasker:linkclick' custom event fired by content.js
// and renders an educational overlay inside the shadow root created by
// shadow-host.js.  Navigation is already cancelled by content.js before this
// module receives the event.

(() => {
  if (window.__promptMaskerModalLoaded) return;
  window.__promptMaskerModalLoaded = true;

  // ---------------------------------------------------------------------------
  // Shadow root reference — all extension UI is appended here so that host-page
  // CSS cannot affect it.  shadow-host.js runs first and guarantees the root
  // is available by the time this module initialises.
  // ---------------------------------------------------------------------------
  function getSR() {
    if (!window.__pmShadowRoot) {
      console.error('[Prompt Masker] modal.js: shadow root not available.');
      return document.body; // last-resort fallback
    }
    return window.__pmShadowRoot;
  }

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------

  /** @type {HTMLElement|null} Currently open overlay element. */
  let activeOverlay = null;

  /** Close and remove the active modal, if one exists. */
  function closeModal() {
    if (!activeOverlay) return;
    activeOverlay.remove();
    activeOverlay = null;
  }

  /**
   * Create and display the warning modal for the given destination URL.
   *
   * @param {string} url - The intercepted link destination.
   */
  function showModal(url) {
    closeModal(); // dismiss any previously open modal

    const sr = getSR();

    // ── Overlay (full-screen backdrop) ──────────────────────────────────────
    const overlay = document.createElement('div');
    overlay.className = 'pm-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'pm-modal-title');

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    // ── Dialog box ──────────────────────────────────────────────────────────
    const dialog = document.createElement('div');
    dialog.className = 'pm-dialog';

    // ── Icon ────────────────────────────────────────────────────────────────
    const icon = document.createElement('div');
    icon.className = 'pm-icon';
    icon.textContent = '⚠️';
    icon.setAttribute('aria-hidden', 'true');

    // ── Heading ─────────────────────────────────────────────────────────────
    const heading = document.createElement('h2');
    heading.id = 'pm-modal-title';
    heading.className = 'pm-heading';
    heading.textContent = 'This is a learning moment!';

    // ── Body copy ───────────────────────────────────────────────────────────
    const body = document.createElement('p');
    body.className = 'pm-body';
    body.textContent =
      'You clicked a link inside an AI response. ' +
      'AI can suggest harmful or misleading links — ' +
      'think before you proceed.';

    // ── Destination URL display ──────────────────────────────────────────────
    const urlBox = document.createElement('div');
    urlBox.className = 'pm-url-box';

    const urlLabel = document.createElement('span');
    urlLabel.className = 'pm-url-label';
    urlLabel.textContent = 'Destination URL:';

    const urlValue = document.createElement('span');
    urlValue.className = 'pm-url-value';
    urlValue.textContent = url;

    urlBox.append(urlLabel, urlValue);

    // ── Action buttons ───────────────────────────────────────────────────────
    const actions = document.createElement('div');
    actions.className = 'pm-actions';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'pm-btn pm-btn-close';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', closeModal);

    const proceedBtn = document.createElement('button');
    proceedBtn.className = 'pm-btn pm-btn-proceed';
    proceedBtn.textContent = 'I understand – continue';
    proceedBtn.addEventListener('click', () => {
      // Ask the background service worker to open the URL.
      // chrome.tabs.create() is not available in content scripts, so we
      // delegate via messaging. window.open() is intentionally avoided
      // because page-level CSP can block it from a content script.
      chrome.runtime.sendMessage({ type: 'openTab', url });
      closeModal();
    });

    actions.append(closeBtn, proceedBtn);

    // ── Assemble ─────────────────────────────────────────────────────────────
    dialog.append(icon, heading, body, urlBox, actions);
    overlay.appendChild(dialog);

    // Append into shadow root — not document.body — for style encapsulation.
    sr.appendChild(overlay);

    activeOverlay = overlay;

    closeBtn.focus();
  }

  // ---------------------------------------------------------------------------
  // Keyboard: close on Escape
  // ---------------------------------------------------------------------------
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activeOverlay) {
      e.preventDefault();
      closeModal();
    }
  }, /* capture = */ true);

  // ---------------------------------------------------------------------------
  // Listen for the custom event dispatched by content.js
  // ---------------------------------------------------------------------------
  document.addEventListener('promptmasker:linkclick', (e) => {
    const { url } = /** @type {CustomEvent} */ (e).detail;
    showModal(url);
  });

})();
