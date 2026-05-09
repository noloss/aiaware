// Content script — injected into every page at document_idle.
// Scaffold only: no active analysis yet.

(() => {
  // Guard against double-injection.
  if (window.__promptSentinelLoaded) return;
  window.__promptSentinelLoaded = true;

  console.debug('[PromptSentinel] Content script loaded on', location.hostname);
})();
