// Popup script — runs only while the popup is open.

const AUDIT_KEY = 'aa-audit-log';
const statusEl = document.getElementById('status');

// Load persisted settings.
chrome.storage.local.get(['initialized'], ({ initialized }) => {
  statusEl.textContent = initialized
    ? 'Extension active — monitoring this page.'
    : 'Extension starting up…';
});

// ---------------------------------------------------------------------------
// Recent Activity — render up to 10 most-recent audit log entries.
// ---------------------------------------------------------------------------

/**
 * Format a single audit log entry for display.
 * Output: "Today HH:MM — {Severity}: {label} on {host}"
 *
 * @param {{ ts: number, severity: string, labels: string[], host: string }} entry
 * @returns {string}
 */
function formatEntry(entry) {
  const date = new Date(entry.ts);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const label = (Array.isArray(entry.labels) && entry.labels.length > 0)
    ? entry.labels[0]
    : 'unknown';
  const sev = entry.severity ?? 'low';
  const sevDisplay = sev.charAt(0).toUpperCase() + sev.slice(1);
  return `Today ${hh}:${mm} — ${sevDisplay}: ${label} on ${entry.host}`;
}

/**
 * Render the activity list from the stored log array.
 * Shows up to 10 entries, most recent first.
 *
 * @param {Array|undefined} log
 */
function renderActivity(log) {
  const list = document.getElementById('pm-activity-list');
  const empty = document.getElementById('pm-activity-empty');
  // Take the last 10 entries and reverse so newest is at the top.
  const entries = Array.isArray(log) ? log.slice(-10).reverse() : [];

  list.innerHTML = '';

  if (entries.length === 0) {
    list.style.display = 'none';
    empty.style.display = '';
  } else {
    list.style.display = '';
    empty.style.display = 'none';
    for (const entry of entries) {
      const li = document.createElement('li');
      li.className = 'pm-activity-item';
      li.textContent = formatEntry(entry);
      list.appendChild(li);
    }
  }
}

// Initial render.
chrome.storage.local.get([AUDIT_KEY], (data) => {
  renderActivity(data[AUDIT_KEY]);
});

// Clear history button — removes the log key and re-renders immediately.
document.getElementById('pm-clear-history').addEventListener('click', () => {
  chrome.storage.local.remove(AUDIT_KEY, () => {
    renderActivity([]);
  });
});
