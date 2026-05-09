// Content script — injected into Claude.ai and Gemini.google.com at document_idle.

(() => {
  // Guard against double-injection (e.g. same-page navigation in SPAs).
  if (window.__promptSentinelLoaded) return;
  window.__promptSentinelLoaded = true;

  // Defence-in-depth: ensure we only activate on the intended hosts even if
  // Chrome injects this script somewhere unexpected during development.
  const SUPPORTED_HOSTS = ['claude.ai', 'gemini.google.com'];
  const host = location.hostname;
  if (!SUPPORTED_HOSTS.some(h => host === h || host.endsWith('.' + h))) return;

  console.log('[PromptSentinel] PromptSentinel active on', host);
})();
