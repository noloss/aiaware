// Popup script — runs only while the popup is open.

const statusEl = document.getElementById('status');

// Load persisted settings.
chrome.storage.local.get(['initialized'], ({ initialized }) => {
  statusEl.textContent = initialized
    ? 'Extension active — monitoring this page.'
    : 'Extension starting up…';
});
