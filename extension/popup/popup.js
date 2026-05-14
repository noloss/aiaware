// Popup script — runs only while the popup is open.

const AUDIT_KEY = 'aa-audit-log';

// ---------------------------------------------------------------------------
// Recent Activity — render up to 10 most-recent audit log entries.
// ---------------------------------------------------------------------------

function formatEntry(entry) {
  const date = new Date(entry.ts);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const label = (Array.isArray(entry.labels) && entry.labels.length > 0)
    ? entry.labels[0]
    : 'unknown';
  const sev = entry.severity ?? 'low';
  const sevDisplay = sev.charAt(0).toUpperCase() + sev.slice(1);
  return `${hh}:${mm} · ${sevDisplay} · ${label} on ${entry.host}`;
}

function renderActivity(log) {
  const list = document.getElementById('pm-activity-list');
  const empty = document.getElementById('pm-activity-empty');
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
      li.dataset.severity = entry.severity ?? 'low';
      li.textContent = formatEntry(entry);
      list.appendChild(li);
    }
  }
}

chrome.storage.local.get([AUDIT_KEY], (data) => {
  renderActivity(data[AUDIT_KEY]);
});

document.getElementById('pm-clear-history').addEventListener('click', () => {
  chrome.storage.local.remove(AUDIT_KEY, () => {
    renderActivity([]);
  });
});
