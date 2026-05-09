// Service worker — runs in the background (Manifest V3).
// Initialises extension state on first install.

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.storage.local.set({ initialized: true, version: '0.1.0' });
    console.log('[PromptSentinel] Extension installed.');
  }
});
