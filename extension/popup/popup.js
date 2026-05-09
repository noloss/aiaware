// Popup script — runs only while the popup is open.

const statusEl = document.getElementById('status');

chrome.storage.local.get(['initialized'], ({ initialized }) => {
  if (initialized) {
    statusEl.textContent = 'Extension active — monitoring this page.';
  } else {
    statusEl.textContent = 'Extension starting up…';
  }
});
