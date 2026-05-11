// Service worker — runs in the background (Manifest V3).
// Initialises extension state on first install.

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.storage.local.set({ initialized: true, version: '0.1.0' });
    console.log('[Prompt Masker] Extension installed.');
  }
});

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

// URL schemes that must never be opened via chrome.tabs.create.
const BLOCKED_SCHEMES = new Set(['javascript:', 'data:', 'file:']);

/**
 * Handle messages from content scripts that need privileged Chrome APIs.
 *
 * 'openTab' — open a URL in a new tab.
 *   Content scripts cannot call chrome.tabs.create() directly, and
 *   window.open() may be blocked by the host page's CSP, so they delegate
 *   here instead.
 *
 * Security:
 *   - Only messages from this extension's own origin are accepted.
 *   - The target URL must use a safe scheme (http: or https:).
 */
chrome.runtime.onMessage.addListener((message, sender) => {
  // 1. Validate sender — must originate from this extension itself.
  if (sender.id !== chrome.runtime.id) {
    // Silently drop messages from unknown origins.
    return;
  }

  if (message.type === 'openTab' && typeof message.url === 'string') {
    // 2. Validate URL scheme before opening a tab.
    let parsed;
    try {
      parsed = new URL(message.url);
    } catch {
      console.error('[Prompt Masker] openTab rejected: invalid URL', message.url);
      return;
    }

    if (BLOCKED_SCHEMES.has(parsed.protocol)) {
      console.error('[Prompt Masker] openTab rejected: disallowed scheme', parsed.protocol);
      return;
    }

    chrome.tabs.create({ url: message.url });
  }
});
