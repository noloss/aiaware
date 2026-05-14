// shadow-host.js — Creates the Shadow DOM host for all Prompt Masker extension UI.
//
// Must be listed FIRST in manifest.json content_scripts so that
// window.__pmShadowRoot is available before modal.js, dlp.js, and highlight.js run.
//
// Architecture:
//   #aa-shadow-host  — fixed, full-screen, pointer-events:none in the light DOM.
//                      The host is invisible and does not block page interaction.
//                      Children inside the shadow root with pointer-events:auto
//                      (the browser default) still receive pointer events because
//                      pointer-events:none on a parent does not prevent descendant
//                      elements from being hit targets.
//   shadow root      — open shadow root; all extension UI is appended here.
//                      Trade-off: mode:'open' means page scripts can reach the
//                      shadow root via document.getElementById('aa-shadow-host')
//                      .shadowRoot.  This is acceptable because the extension
//                      goal is CSS isolation, not JS isolation.  The stored
//                      window.__pmShadowRoot reference is the canonical access
//                      path for extension scripts.  Switch to mode:'closed' only
//                      if JS isolation from host-page scripts becomes a goal.
//   <style>          — combined modal + DLP CSS injected once, synchronously,
//                      so styles are always ready before the first UI element appears.
//
// Exposes:  window.__pmShadowRoot  (ShadowRoot)

// ── Combined CSS (modal.css + dlp.css) ────────────────────────────────────────
// Declared BEFORE the IIFE to avoid a Temporal Dead Zone (TDZ) ReferenceError.
// `const` bindings are not initialised until their declaration is evaluated;
// if this string were placed after the IIFE, accessing PM_COMBINED_CSS inside
// the IIFE (which runs first) would throw ReferenceError and prevent
// window.__pmShadowRoot from ever being assigned.
const PM_COMBINED_CSS = /* css */`

/* ==========================================================================
   modal.css — Warning overlay for intercepted link clicks + intercept popup.
   Scoped with the .pm- prefix; all values explicit so host resets have no
   effect.  The shadow root provides a hard style boundary.
   ========================================================================== */

/* ── Overlay (full-screen backdrop) ──────────────────────────────────────── */
.pm-overlay {
  all: initial;
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.55);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  animation: pm-fade-in 0.12s ease-out both;
  /* Re-enable pointer events so the backdrop and its children are interactive. */
  pointer-events: auto;
}

@keyframes pm-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

/* ── Dialog box ──────────────────────────────────────────────────────────── */
.pm-dialog {
  all: initial;
  position: relative;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  padding: 32px 28px 24px;
  max-width: 480px;
  width: calc(100vw - 48px);
  display: flex;
  flex-direction: column;
  gap: 16px;
  animation: pm-slide-up 0.15s ease-out both;
}

/* ── Corner × close button ───────────────────────────────────────────────── */
.pm-dialog-close {
  all: initial;
  position: absolute;
  top: 8px;
  right: 8px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 18px;
  line-height: 1;
  color: #888888;
  cursor: pointer;
  opacity: 0.6;
  border-radius: 4px;
}

.pm-dialog-close:hover {
  opacity: 1;
}

.pm-dialog-close:focus-visible {
  outline: 3px solid #0078d4;
  outline-offset: 2px;
  opacity: 1;
}

@keyframes pm-slide-up {
  from { transform: translateY(12px); opacity: 0; }
  to   { transform: translateY(0);    opacity: 1; }
}

/* ── Icon ────────────────────────────────────────────────────────────────── */
.pm-icon {
  font-size: 36px;
  line-height: 1;
  text-align: center;
}

/* ── Heading ─────────────────────────────────────────────────────────────── */
.pm-heading {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 20px;
  font-weight: 700;
  color: #1a1a1a;
  text-align: center;
  line-height: 1.3;
}

/* ── Body copy ───────────────────────────────────────────────────────────── */
.pm-body {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  color: #444444;
  line-height: 1.6;
  text-align: center;
}

/* ── URL box ─────────────────────────────────────────────────────────────── */
.pm-url-box {
  background: #f5f5f5;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: hidden;
}

.pm-url-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #888888;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.pm-url-value {
  font-size: 13px;
  color: #1a1a1a;
  word-break: break-all;
  font-family: 'SFMono-Regular', 'Menlo', 'Consolas', monospace;
}

/* ── Action buttons ──────────────────────────────────────────────────────── */
.pm-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-top: 4px;
}

.pm-btn {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  font-weight: 600;
  padding: 9px 20px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.12s ease, opacity 0.12s ease;
  white-space: nowrap;
  flex: 0 25%;
  text-align: center;
}

.pm-btn:focus-visible {
  outline: 3px solid #0078d4;
  outline-offset: 2px;
}

/* "Close" / primary action */
.pm-btn-close {
  background-color: #0f62fe;
  color: #ffffff;
}

.pm-btn-close:hover {
  background-color: #0043ce;
}

/* "Continue anyway" / secondary action */
.pm-btn-proceed {
  background-color: transparent;
  color: #6b6b6b;
  border: 1px solid #d0d0d0;
}

.pm-btn-proceed:hover {
  background-color: #f0f0f0;
  color: #1a1a1a;
}

/* ==========================================================================
   dlp.css — DLP banner, severity variants, and in-field highlight spans.
   ========================================================================== */

/* ── DLP warning banner ──────────────────────────────────────────────────── */
#pm-dlp-banner {
  all: initial;
  position: fixed;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: #FEF08A;
  color: #854D0E;
  border: 1px solid #EAB308;
  border-radius: 6px;
  padding: 8px 12px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
  line-height: 1.4;
  z-index: 2147483646;
  box-sizing: border-box;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  pointer-events: auto;
}

#pm-dlp-banner span {
  all: initial;
  font-family: inherit;
  font-size: inherit;
  color: inherit;
  line-height: inherit;
}

#pm-dlp-dismiss {
  all: initial;
  cursor: pointer;
  font-size: 14px;
  color: #854D0E;
  opacity: 0.6;
  flex-shrink: 0;
  padding: 0 4px;
  line-height: 1;
}

#pm-dlp-dismiss:hover {
  opacity: 1;
}

/* Medium-severity variant — orange */
#pm-dlp-banner.pm-medium {
  background: #FFEDD5;
  color: #9A3412;
  border-color: #F97316;
}

#pm-dlp-banner.pm-medium #pm-dlp-dismiss {
  color: #9A3412;
}

/* High-severity variant — red */
#pm-dlp-banner.pm-high {
  background: #FEE2E2;
  color: #991B1B;
  border-color: #EF4444;
}

#pm-dlp-banner.pm-high #pm-dlp-dismiss {
  color: #991B1B;
}

/* ── In-field highlight spans ─────────────────────────────────────────────── */
.pm-hl-high {
  background: rgba(239, 68, 68, 0.35);
  border-radius: 2px;
}

.pm-hl-medium {
  background: rgba(249, 115, 22, 0.35);
  border-radius: 2px;
}

.pm-hl-low {
  background: rgba(234, 179, 8, 0.35);
  border-radius: 2px;
}

/* ── Textarea backdrop ────────────────────────────────────────────────────── */
#pm-hl-backdrop {
  all: unset;
  display: block;
}
`;

// ── Shadow host setup ─────────────────────────────────────────────────────────
// Runs after PM_COMBINED_CSS is fully initialised (no TDZ risk).
(() => {
  if (window.__pmShadowRoot) return;

  // Full-screen fixed so fixed-position children (overlays, banner) use the
  // viewport as their containing block.  pointer-events:none makes the host
  // itself transparent to mouse/touch events.
  // Note: do NOT add contain:paint — that would make this element a containing
  // block for position:fixed children, breaking overlay/banner placement.
  const host = document.createElement('div');
  host.id = 'aa-shadow-host';
  host.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:2147483647;' +
    'overflow:visible;';

  // Append to <html> so this works even if <body> is not yet parsed.
  (document.body ?? document.documentElement).appendChild(host);

  // mode:'open' — CSS isolation is the primary goal here.  See trade-off note
  // in the file header comment above.
  const shadow = host.attachShadow({ mode: 'open' });

  // Embedding CSS as a <style> string avoids:
  //  • async loading race conditions (no <link> fetch needed)
  //  • web_accessible_resources entries in manifest.json
  //  • any flash of unstyled content on the first modal open
  //
  // Keep this string in sync with modal.css and dlp.css.
  const style = document.createElement('style');
  style.textContent = PM_COMBINED_CSS;
  shadow.appendChild(style);

  window.__pmShadowRoot = shadow;
})();
