// highlight.js — Sensitive text highlight engine for Prompt Masker.
//
// Two public functions exposed on window.promptMaskerHighlight:
//
//   highlightText(el, hits)  — render highlights for the given DLP hits.
//   clearHighlights(el)      — remove all highlights; plain text is unchanged.
//
// Strategy:
//   contenteditable (Claude.ai, Gemini) — wrap matched text nodes in
//     <span data-pm-hl="1" class="pm-hl-{severity}"> elements, preserving
//     the caret position via a character-offset snapshot taken before and
//     restored after the DOM mutation.
//
//   textarea (ChatGPT) — create an absolutely-positioned backdrop div that
//     mirrors the textarea's font metrics and renders the full text with
//     colored <span> backgrounds, then layer it over the textarea with
//     pointer-events:none so the textarea remains fully interactive.
//
// All injected elements are appended to window.__pmShadowRoot (created by
// shadow-host.js) so they are encapsulated and immune to host-page CSS.

(() => {
  if (window.__promptMaskerHlLoaded) return;
  window.__promptMaskerHlLoaded = true;

  const BACKDROP_ID = 'pm-hl-backdrop';

  // Shadow root reference — backdrop lives here, not on document.body.
  function getSR() {
    if (!window.__pmShadowRoot) {
      console.error('[Prompt Masker] highlight.js: shadow root not available.');
      return document.body;
    }
    return window.__pmShadowRoot;
  }

  // ---------------------------------------------------------------------------
  // Escape HTML special characters for safe innerHTML assignment.
  // ---------------------------------------------------------------------------
  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ---------------------------------------------------------------------------
  // Normalise hits: filter out incomplete entries, sort by index, drop
  // overlapping regions (first hit wins when two ranges overlap).
  // ---------------------------------------------------------------------------
  function normalizeHits(hits) {
    const filtered = hits.filter(
      h => h.index !== undefined && h.match && h.match.length > 0,
    );
    filtered.sort((a, b) => a.index - b.index);

    const result = [];
    for (const hit of filtered) {
      const prev = result[result.length - 1];
      if (prev && hit.index < prev.index + prev.match.length) continue; // overlap
      result.push(hit);
    }
    return result;
  }

  // ===========================================================================
  // Contenteditable engine
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // getCaretCharOffset — return the caret's character offset from the start of
  // `root`'s text content, or null if the selection is outside root.
  //
  // We build a Range from the start of root to the cursor and call toString()
  // which yields the plain-text slice, whose length is the offset we need.
  // This works whether startContainer is a Text node or an Element node.
  // ---------------------------------------------------------------------------
  function getCaretCharOffset(root) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.startContainer)) return null;

    const preRange = document.createRange();
    preRange.setStart(root, 0);
    preRange.setEnd(range.startContainer, range.startOffset);
    return preRange.toString().length;
  }

  // ---------------------------------------------------------------------------
  // setCaretCharOffset — walk text nodes in `root` and place the caret at the
  // given character offset.  Falls back to end-of-content if offset exceeds
  // the total text length (e.g. the text shrank since the snapshot was taken).
  // ---------------------------------------------------------------------------
  function setCaretCharOffset(root, offset) {
    if (offset === null) return;
    const sel = window.getSelection();
    if (!sel) return;

    let remaining = offset;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;

    while ((node = walker.nextNode())) {
      const len = node.textContent.length;
      if (remaining <= len) {
        const range = document.createRange();
        range.setStart(node, remaining);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      remaining -= len;
    }

    // Fallback: collapse to end of root.
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // ---------------------------------------------------------------------------
  // clearContenteditableHighlights — unwrap every [data-pm-hl] span inside el,
  // then normalise adjacent text nodes.  Plain text content is unchanged.
  // ---------------------------------------------------------------------------
  function clearContenteditableHighlights(el) {
    // Snapshot first — querySelectorAll is live against the DOM, and splicing
    // nodes while iterating would miss elements.
    const spans = Array.from(el.querySelectorAll('[data-pm-hl]'));
    for (const span of spans) {
      const parent = span.parentNode;
      if (!parent) continue;
      while (span.firstChild) {
        parent.insertBefore(span.firstChild, span);
      }
      parent.removeChild(span);
    }
    el.normalize(); // merge text nodes split by unwrapping
  }

  // ---------------------------------------------------------------------------
  // applyHighlightsToTextNodes — walk text nodes in `root` and wrap the
  // character ranges described by `hits` in highlight spans.
  //
  // Text nodes are collected into an array before any DOM modifications so that
  // TreeWalker state is not affected by the replacements we make mid-loop.
  // ---------------------------------------------------------------------------
  function applyHighlightsToTextNodes(root, hits) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let n;
    while ((n = walker.nextNode())) textNodes.push(n);

    let globalOffset = 0; // character position of the start of the current text node
    let hitIdx = 0;

    for (const textNode of textNodes) {
      if (hitIdx >= hits.length) break;

      const text = textNode.textContent;
      const nodeStart = globalOffset;
      const nodeEnd = globalOffset + text.length;

      // Advance past hits that end before this node begins.
      while (hitIdx < hits.length &&
             hits[hitIdx].index + hits[hitIdx].match.length <= nodeStart) {
        hitIdx++;
      }

      if (hitIdx >= hits.length || hits[hitIdx].index >= nodeEnd) {
        globalOffset = nodeEnd;
        continue; // no hits touch this node — leave it alone
      }

      // Build a DocumentFragment that replaces this text node.
      const frag = document.createDocumentFragment();
      let localPos = 0; // position within `text` consumed so far

      while (hitIdx < hits.length && hits[hitIdx].index < nodeEnd) {
        const hit = hits[hitIdx];
        const hitStart = Math.max(hit.index - nodeStart, localPos);
        const hitEnd   = Math.min((hit.index + hit.match.length) - nodeStart, text.length);

        // Plain text before the hit.
        if (hitStart > localPos) {
          frag.appendChild(document.createTextNode(text.slice(localPos, hitStart)));
        }

        // Highlighted span.
        // data-pm-hl must match the [data-pm-hl] selector in
        // clearContenteditableHighlights() so spans can be removed correctly.
        const span = document.createElement('span');
        span.dataset.pmHl = '1';
        span.className = `pm-hl-${hit.severity}`;
        span.textContent = text.slice(hitStart, hitEnd);
        frag.appendChild(span);

        localPos = hitEnd;

        // Only advance to the next hit if it is fully contained in this node.
        if (hit.index + hit.match.length <= nodeEnd) {
          hitIdx++;
        } else {
          break; // hit continues into the next text node
        }
      }

      // Any remaining plain text after the last hit in this node.
      if (localPos < text.length) {
        frag.appendChild(document.createTextNode(text.slice(localPos)));
      }

      textNode.parentNode.replaceChild(frag, textNode);
      globalOffset = nodeEnd;
    }
  }

  // ---------------------------------------------------------------------------
  // highlightContenteditable — top-level handler for contenteditable elements.
  // ---------------------------------------------------------------------------
  function highlightContenteditable(el, hits) {
    const caretOffset = getCaretCharOffset(el);

    clearContenteditableHighlights(el);

    const normalized = normalizeHits(hits);
    if (normalized.length > 0) {
      applyHighlightsToTextNodes(el, normalized);
    }

    setCaretCharOffset(el, caretOffset);
  }

  // ===========================================================================
  // Textarea engine (backdrop / mirror technique)
  // ===========================================================================
  //
  // A <div id="pm-hl-backdrop"> is placed in the shadow root, positioned with
  // position:fixed over the textarea, and given identical typography so that
  // the text it renders aligns pixel-perfectly with the textarea text.
  // The backdrop text is color:transparent; only highlight span backgrounds
  // are visible.  pointer-events:none keeps the textarea fully interactive.

  const TEXTAREA_STYLE_PROPS = [
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant',
    'lineHeight', 'letterSpacing', 'tabSize', 'textTransform',
    'boxSizing',
  ];

  function syncBackdropGeometry(backdrop, textarea) {
    const rect = textarea.getBoundingClientRect();
    const cs   = window.getComputedStyle(textarea);

    backdrop.style.position = 'fixed';
    backdrop.style.top    = rect.top    + 'px';
    backdrop.style.left   = rect.left   + 'px';
    backdrop.style.width  = rect.width  + 'px';
    backdrop.style.height = rect.height + 'px';
    backdrop.style.margin = '0';

    for (const prop of TEXTAREA_STYLE_PROPS) {
      backdrop.style[prop] = cs[prop];
    }

    // Transparent border preserves the box-model padding offset.
    backdrop.style.borderStyle = 'solid';
    backdrop.style.borderColor = 'transparent';

    // Match textarea text-wrap behaviour.
    backdrop.style.whiteSpace  = 'pre-wrap';
    backdrop.style.wordWrap    = 'break-word';
    backdrop.style.overflowX   = 'hidden';
    backdrop.style.overflowY   = 'hidden';

    // Text invisible — only span backgrounds are shown.
    backdrop.style.color         = 'transparent';
    backdrop.style.userSelect    = 'none';
    backdrop.style.pointerEvents = 'none';

    // Paint above the page but below the DLP banner and intercept overlay.
    backdrop.style.zIndex = '2147483645';

    // Sync scroll so highlight positions track textarea scrolling.
    backdrop.scrollTop  = textarea.scrollTop;
    backdrop.scrollLeft = textarea.scrollLeft;
  }

  function getOrCreateBackdrop() {
    const sr = getSR();
    let bd = sr.getElementById(BACKDROP_ID);
    if (!bd) {
      bd = document.createElement('div');
      bd.id = BACKDROP_ID;
      // Append into shadow root — not document.body — for style encapsulation.
      sr.appendChild(bd);
    }
    return bd;
  }

  function highlightTextarea(el, hits) {
    const normalized = normalizeHits(hits);
    const backdrop   = getOrCreateBackdrop();
    syncBackdropGeometry(backdrop, el);

    // Build innerHTML: plain text with highlight spans for each hit.
    const text = el.value;
    let html = '';
    let lastIdx = 0;

    for (const hit of normalized) {
      html += escapeHtml(text.slice(lastIdx, hit.index));
      const cls = `pm-hl-${escapeHtml(hit.severity)}`;
      html += `<span data-pm-hl="1" class="${cls}">${escapeHtml(
        text.slice(hit.index, hit.index + hit.match.length),
      )}</span>`;
      lastIdx = hit.index + hit.match.length;
    }
    html += escapeHtml(text.slice(lastIdx));

    backdrop.innerHTML = html;

    // Sync scroll on every textarea scroll event (attached once per element).
    if (!el._pmHlScrollAttached) {
      el._pmHlScrollAttached = true;
      el.addEventListener('scroll', () => {
        const bd = getSR().getElementById(BACKDROP_ID);
        if (bd) {
          bd.scrollTop  = el.scrollTop;
          bd.scrollLeft = el.scrollLeft;
        }
      });
    }
  }

  function clearTextareaHighlights() {
    const bd = getSR().getElementById(BACKDROP_ID);
    if (bd) bd.remove();
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * highlightText(el, hits)
   *
   * Render in-field highlights for every entry in `hits`.
   *
   * @param {Element} el   - A monitored input (textarea or contenteditable div).
   * @param {Array}   hits - Hit objects from dlp.js scanText():
   *                         { label, severity, match, index, maskFn? }
   */
  function highlightText(el, hits) {
    if (!el || !Array.isArray(hits)) return;
    if (el.tagName === 'TEXTAREA') {
      highlightTextarea(el, hits);
    } else {
      highlightContenteditable(el, hits);
    }
  }

  /**
   * clearHighlights(el)
   *
   * Remove all highlights from `el`.  The element's plain-text content is
   * byte-for-byte identical to what it was before highlighting was applied.
   *
   * @param {Element} el - The previously highlighted input element.
   */
  function clearHighlights(el) {
    if (!el) return;
    if (el.tagName === 'TEXTAREA') {
      clearTextareaHighlights();
    } else {
      clearContenteditableHighlights(el);
    }
  }

  window.promptMaskerHighlight = { highlightText, clearHighlights };
})();
