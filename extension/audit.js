// audit.js — local audit log for DLP detections.
//
// Exposes window.promptMaskerAudit.append(hits) so that dlp.js can record
// scan results to chrome.storage.local under 'aa-audit-log'.
//
// Each log entry: { ts, severity, labels: string[], host }
// Matched text is NEVER stored.

(() => {
  if (window.__promptMaskerAuditLoaded) return;
  window.__promptMaskerAuditLoaded = true;

  const STORAGE_KEY = 'aa-audit-log';
  const MAX_ENTRIES = 50;

  // Mirrors the severity ranking in dlp.js — kept local to avoid coupling.
  const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };

  function topSeverity(hits) {
    return hits.reduce((best, h) => {
      const rank = SEVERITY_RANK[h.severity] ?? 1;
      return rank > (SEVERITY_RANK[best] ?? 1) ? h.severity : best;
    }, 'low');
  }

  /**
   * Append a detection record to the audit log.
   *
   * @param {Array<{label: string, severity: string}>} hits - DLP scan results.
   */
  function append(hits) {
    if (!hits || hits.length === 0) return;

    const entry = {
      ts: Date.now(),
      severity: topSeverity(hits),
      labels: [...new Set(hits.map(h => h.label))],
      host: location.hostname,
    };

    chrome.storage.local.get(STORAGE_KEY, (data) => {
      const log = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
      log.push(entry);
      // Trim oldest entries so the log never exceeds MAX_ENTRIES.
      if (log.length > MAX_ENTRIES) {
        log.splice(0, log.length - MAX_ENTRIES);
      }
      chrome.storage.local.set({ [STORAGE_KEY]: log });
    });
  }

  window.promptMaskerAudit = { append };
})();
