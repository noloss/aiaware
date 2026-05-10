// modal.js — Warning modal for intercepted link clicks.
// Listens for the 'aiaware:linkclick' custom event fired by content.js
// and renders an educational overlay.  Navigation is already cancelled by
// content.js before this module receives the event.

(() => {
  // Guard: this module should only be initialised once per page.
  if (window.__aiAwareModalLoaded) return;
  window.__aiAwareModalLoaded = true;

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------

  /** @type {HTMLElement|null} Currently open overlay element. */
  let activeOverlay = null;

  /**
   * Close and remove the active modal, if one exists.
   */
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
    // Dismiss any previously open modal before creating a new one.
    closeModal();

    // ── Overlay (full-screen backdrop) ──────────────────────────────────────
    const overlay = document.createElement('div');
    overlay.className = 'aa-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'aa-modal-title');

    // Clicking directly on the backdrop (not on the dialog) also closes.
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    // ── Dialog box ──────────────────────────────────────────────────────────
    const dialog = document.createElement('div');
    dialog.className = 'aa-dialog';

    // ── Icon ────────────────────────────────────────────────────────────────
    const icon = document.createElement('div');
    icon.className = 'aa-icon';
    icon.textContent = '⚠️';
    icon.setAttribute('aria-hidden', 'true');

    // ── Heading ─────────────────────────────────────────────────────────────
    const heading = document.createElement('h2');
    heading.id = 'aa-modal-title';
    heading.className = 'aa-heading';
    heading.textContent = 'This is a learning moment!';

    // ── Body copy ───────────────────────────────────────────────────────────
    const body = document.createElement('p');
    body.className = 'aa-body';
    body.textContent =
      'You clicked a link inside an AI response. ' +
      'AI can suggest harmful or misleading links — ' +
      'think before you proceed.';

    // ── Destination URL display ──────────────────────────────────────────────
    const urlBox = document.createElement('div');
    urlBox.className = 'aa-url-box';

    const urlLabel = document.createElement('span');
    urlLabel.className = 'aa-url-label';
    urlLabel.textContent = 'Destination URL:';

    const urlValue = document.createElement('span');
    urlValue.className = 'aa-url-value';
    urlValue.textContent = url;

    urlBox.append(urlLabel, urlValue);

    // ── Action buttons ───────────────────────────────────────────────────────
    const actions = document.createElement('div');
    actions.className = 'aa-actions';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'aa-btn aa-btn-close';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', closeModal);

    const proceedBtn = document.createElement('button');
    proceedBtn.className = 'aa-btn aa-btn-proceed';
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
    document.body.appendChild(overlay);

    activeOverlay = overlay;

    // Focus the close button so keyboard users can immediately act.
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
  document.addEventListener('aiaware:linkclick', (e) => {
    const { url } = /** @type {CustomEvent} */ (e).detail;
    showModal(url);
  });

})();
