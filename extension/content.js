// Content script — injected into Claude.ai and Gemini.google.com at document_idle.

(() => {
  // Guard against double-injection (e.g. same-page navigation in SPAs).
  if (window.__aiAwareLoaded) return;
  window.__aiAwareLoaded = true;

  // Defence-in-depth: ensure we only activate on the intended hosts even if
  // Chrome injects this script somewhere unexpected during development.
  const SUPPORTED_HOSTS = ['claude.ai', 'gemini.google.com', 'chat.openai.com'];
  const host = location.hostname;
  if (!SUPPORTED_HOSTS.some(h => host === h || host.endsWith('.' + h))) return;

  console.log('[AI Aware] active on', host);

  // ---------------------------------------------------------------------------
  // Structured logger — all diagnostic messages share a common prefix and
  // an 'aiAware' context object so they are easy to filter in DevTools.
  // ---------------------------------------------------------------------------
  const LOG_CTX = { extension: 'AI Aware', host };

  function warnSelectors(selectors, context) {
    console.warn(
      '[AI Aware] No elements matched — UI may have changed.',
      { ...LOG_CTX, context, selectors },
    );
  }

  // ---------------------------------------------------------------------------
  // Chat-response container selectors (per host).
  // A link is only intercepted when it lives inside one of these containers.
  // Add more selectors here as the host UIs evolve — order is irrelevant.
  // ---------------------------------------------------------------------------
  const CHAT_RESPONSE_SELECTORS = [
    // Claude.ai — assistant message wrappers
    '[data-testid="assistant-message"]',
    '.font-claude-message',
    // Claude.ai — tighter attribute-based selectors for assistant turns;
    // preferred over the broad .prose class which can also match user bubbles.
    '[data-message-author-role="assistant"]',
    '[data-is-streaming]',
    // Claude.ai — rendered markdown prose block (broad fallback; kept for
    // UI versions that lack the above attributes).
    '.prose',
    // Gemini — model response containers
    'model-response',
    '.model-response-text',
    // ChatGPT — assistant turn wrappers
    '[data-message-author-role="assistant"]',
    '.agent-turn',
    // ChatGPT — rendered markdown block inside assistant turns.
    // Scoped to assistant turns so that any element carrying the generic
    // `.markdown` utility class in the composer area is never mistaken for
    // a chat-response container.
    '[data-message-author-role="assistant"] .markdown',
  ];

  // Elements whose subtrees we explicitly want to leave alone.
  // Hoisted to module scope to avoid re-allocating the array on every click.
  const EXCLUDED_SELECTORS = ['nav', 'header', 'footer', '[role="navigation"]'];

  /**
   * Walk up the DOM from `el` and return true if any ancestor matches one of
   * the chat-response selectors.  Returns false if we hit a nav / header /
   * footer first, ensuring navigation-bar links are never intercepted.
   *
   * @param {Element} el
   * @returns {boolean}
   */
  function isInsideChatResponse(el) {
    let node = el;
    while (node && node !== document.body) {
      // Bail out early if we're inside a nav / header / footer.
      if (node.matches && EXCLUDED_SELECTORS.some(s => node.matches(s))) {
        return false;
      }
      // Match against any known chat-response container.
      if (node.matches && CHAT_RESPONSE_SELECTORS.some(s => {
        try { return node.matches(s); } catch { return false; }
      })) {
        return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  /**
   * Find the closest <a> ancestor of (or equal to) `el`, if any.
   *
   * @param {EventTarget} el
   * @returns {HTMLAnchorElement|null}
   */
  function closestAnchor(el) {
    if (!(el instanceof Element)) return null;
    return el.closest('a[href]');
  }

  // ---------------------------------------------------------------------------
  // Intercept link clicks with capture-phase listener so we run before any
  // in-page handlers and before the browser starts navigation.
  // ---------------------------------------------------------------------------
  document.addEventListener('click', (event) => {
    try {
      const anchor = closestAnchor(/** @type {Element} */ (event.target));
      if (!anchor) return;                          // Not a link click — ignore.
      if (!isInsideChatResponse(anchor)) return;   // Outside chat bubble — ignore.

      // Cancel default navigation.
      // preventDefault() is sufficient — stopPropagation() must NOT be called here
      // because this listener runs in capture phase and would silently swallow
      // the event before Claude.ai / Gemini's own UI handlers can react.
      event.preventDefault();

      const url = anchor.href;
      console.log('[AI Aware] Intercepted link click inside chat response:', url);

      // Dispatch a custom event so other modules (safety check, warning modal,
      // etc.) can react without coupling to this listener directly.
      document.dispatchEvent(new CustomEvent('aiaware:linkclick', {
        detail: { url, anchor },
        bubbles: false,
      }));
    } catch (err) {
      // An unexpected error inside our listener must never propagate as an
      // uncaught exception — that would interfere with the host page's own
      // click handlers running in the same capture phase.
      console.error('[AI Aware] Unexpected error in click handler:', err, LOG_CTX);
    }
  }, /* capture = */ true);

  // ---------------------------------------------------------------------------
  // Diagnostic — check that at least one chat-response container is present.
  // Deferred by 3 s so SPA frameworks have time to render their initial UI
  // before we evaluate the selectors.  Logs a structured warning (never throws)
  // if the page has no recognisable chat containers, which would indicate that
  // the host platform's DOM structure has changed in an incompatible way.
  // ---------------------------------------------------------------------------
  setTimeout(() => {
    const anyMatch = CHAT_RESPONSE_SELECTORS.some(sel => {
      try { return document.querySelector(sel) !== null; } catch { return false; }
    });
    if (!anyMatch) {
      warnSelectors(CHAT_RESPONSE_SELECTORS, 'chat-response containers');
    }
  }, 3000);

})();
