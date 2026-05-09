// modal.js — Warning modal for intercepted link clicks.
// Listens for the 'promptsentinel:linkclick' custom event fired by content.js
// and renders an educational overlay.  Navigation is already cancelled by
// content.js before this module receives the event.

(() => {
  // Guard: this module should only be initialised once per page.
  if (window.__promptSentinelModalLoaded) return;
  window.__promptSentinelModalLoaded = true;

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
    overlay.className = 'ps-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'ps-modal-title');

    // Clicking directly on the backdrop (not on the dialog) also closes.
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    // ── Dialog box ──────────────────────────────────────────────────────────
    const dialog = document.createElement('div');
    dialog.className = 'ps-dialog';

    // ── Icon ────────────────────────────────────────────────────────────────
    const icon = document.createElement('div');
    icon.className = 'ps-icon';
    icon.textContent = '⚠️';
    icon.setAttribute('aria-hidden', 'true');

    // ── Heading ─────────────────────────────────────────────────────────────
    const heading = document.createElement('h2');
    heading.id = 'ps-modal-title';
    heading.className = 'ps-heading';
    heading.textContent = 'Tämä on opetushetki!';

    // ── Body copy ───────────────────────────────────────────────────────────
    const body = document.createElement('p');
    body.className = 'ps-body';
    body.textContent =
      'Klikkasit linkkiä tekoälyn vastauksessa. ' +
      'Tekoäly voi ehdottaa haitallisia tai harhaanjohtavia linkkejä — ' +
      'harkitse ennen kuin jatkat.';

    // ── Destination URL display ──────────────────────────────────────────────
    const urlBox = document.createElement('div');
    urlBox.className = 'ps-url-box';

    const urlLabel = document.createElement('span');
    urlLabel.className = 'ps-url-label';
    urlLabel.textContent = 'Kohde-URL:';

    const urlValue = document.createElement('span');
    urlValue.className = 'ps-url-value';
    urlValue.textContent = url;

    urlBox.append(urlLabel, urlValue);

    // ── Action buttons ───────────────────────────────────────────────────────
    const actions = document.createElement('div');
    actions.className = 'ps-actions';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'ps-btn ps-btn-close';
    closeBtn.textContent = 'Sulje';
    closeBtn.addEventListener('click', closeModal);

    const proceedBtn = document.createElement('button');
    proceedBtn.className = 'ps-btn ps-btn-proceed';
    proceedBtn.textContent = 'Jatka silti';
    proceedBtn.addEventListener('click', () => {
      closeModal();
      // Open in a new tab so the user makes a deliberate choice.
      window.open(url, '_blank', 'noopener,noreferrer');
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
  document.addEventListener('promptsentinel:linkclick', (e) => {
    const { url } = /** @type {CustomEvent} */ (e).detail;
    showModal(url);
  });

})();
