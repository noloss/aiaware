// shadow-host.js — Creates the Shadow DOM host for all Prompt Masker extension UI.
//
// Must be listed FIRST in manifest.json content_scripts so that
// window.__pmShadowRoot is available before dlp.js and audit.js run.
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
//   <style>          — DLP CSS injected once, synchronously,
//                      so styles are always ready before the first UI element appears.
//
// Exposes:  window.__pmShadowRoot  (ShadowRoot)

// ── DLP CSS ───────────────────────────────────────────────────────────────────
// Declared BEFORE the IIFE to avoid a Temporal Dead Zone (TDZ) ReferenceError.
// `const` bindings are not initialised until their declaration is evaluated;
// if this string were placed after the IIFE, accessing PM_COMBINED_CSS inside
// the IIFE (which runs first) would throw ReferenceError and prevent
// window.__pmShadowRoot from ever being assigned.
const PM_COMBINED_CSS = /* css */`

/* ==========================================================================
   src/dlp.css — DLP banner and severity variants.
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

/* ==========================================================================
   src/modal.css — Security Intercept overlay styles.
   ========================================================================== */
/* modal.css — Security Intercept overlay styles.
 *
 * These rules style the popup built by showInterceptPopup() in dlp.js.
 * All selectors use the pm- prefix for isolation.
 *
 * NOTE: This file is mirrored into the PM_COMBINED_CSS string in shadow-host.js
 * so the shadow root always has the styles available synchronously.
 * Keep both copies in sync when making changes.
 */

/* ── Full-screen semi-transparent backdrop ───────────────────────────────── */
.pm-overlay {
  all: initial;
  pointer-events: auto;
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2147483646;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

/* ── Centered dialog card ────────────────────────────────────────────────── */
.pm-dialog {
  all: initial;
  display: block;
  position: relative;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.22);
  padding: 28px 28px 20px;
  max-width: 380px;
  width: calc(100vw - 48px);
  box-sizing: border-box;
  text-align: center;
  color: #111;
}

/* ── Shield icon ─────────────────────────────────────────────────────────── */
.pm-icon {
  font-size: 36px;
  line-height: 1;
  margin-bottom: 10px;
}

/* ── Dialog heading ──────────────────────────────────────────────────────── */
.pm-heading {
  font-size: 17px;
  font-weight: 700;
  margin: 0 0 8px;
  color: #111;
}

/* ── Body text ───────────────────────────────────────────────────────────── */
.pm-body {
  font-size: 13px;
  color: #555;
  margin: 0 0 18px;
  line-height: 1.5;
}

/* ── Corner × dismiss button ─────────────────────────────────────────────── */
.pm-dialog-close {
  all: initial;
  display: inline-block;
  position: absolute;
  top: 10px;
  right: 12px;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 20px;
  color: #888;
  line-height: 1;
  padding: 2px 4px;
}

.pm-dialog-close:hover {
  color: #333;
}

/* ── Action button row ───────────────────────────────────────────────────── */
.pm-actions {
  display: flex;
  flex-direction: row;
  gap: 8px;
}

/* ── Base button ─────────────────────────────────────────────────────────── */
.pm-btn {
  all: initial;
  box-sizing: border-box;
  flex: 1;
  pointer-events: auto;
  padding: 10px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  text-align: center;
  cursor: pointer;
  transition: opacity 0.15s;
}

.pm-btn:hover {
  opacity: 0.88;
}

/* ── Primary action: Mask & Send ─────────────────────────────────────────── */
.pm-btn-close {
  background: #4F46E5;
  color: #fff;
  border: 1px solid #4338CA;
}

/* ── Secondary action: Continue anyway ──────────────────────────────────── */
.pm-btn-proceed {
  background: #F3F4F6;
  color: #4F46E5;
  border: 1px solid #D1D5DB;
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
  // Keep this string in sync with src/dlp.css.
  const style = document.createElement('style');
  style.textContent = PM_COMBINED_CSS;
  shadow.appendChild(style);

  window.__pmShadowRoot = shadow;
})();
