// Popup script — runs only while the popup is open.

const statusEl = document.getElementById('status');
const shadowBlockToggle = document.getElementById('shadow-block-toggle');

// Load persisted settings.
chrome.storage.local.get(['initialized', 'shadowBlockEnabled'], ({ initialized, shadowBlockEnabled }) => {
  if (initialized) {
    statusEl.textContent = 'Extension active — monitoring this page.';
  } else {
    statusEl.textContent = 'Extension starting up…';
  }

  shadowBlockToggle.checked = !!shadowBlockEnabled;
});

// Persist Shadow Block setting whenever the toggle changes.
shadowBlockToggle.addEventListener('change', () => {
  chrome.storage.local.set({ shadowBlockEnabled: shadowBlockToggle.checked });
});
