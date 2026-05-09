// Service worker — runs in the background (Manifest V3).
// Initialises extension state on first install.

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.storage.local.set({ initialized: true, version: '0.1.0' });
    console.log('[PromptSentinel] Extension installed.');
  }
});

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

/**
 * Handle messages from content scripts that need privileged Chrome APIs.
 *
 * 'openTab' — open a URL in a new tab.
 *   Content scripts cannot call chrome.tabs.create() directly, and
 *   window.open() may be blocked by the host page's CSP, so they delegate
 *   here instead.
 */
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'openTab' && typeof message.url === 'string') {
    chrome.tabs.create({ url: message.url });
  }
});
