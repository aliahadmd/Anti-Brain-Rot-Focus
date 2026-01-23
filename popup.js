document.addEventListener('DOMContentLoaded', () => {
  const statusDiv = document.getElementById('status');
  const toggleBtn = document.getElementById('toggleBtn');
  const optionsLink = document.getElementById('optionsLink');

  function updateUI(isEnabled) {
    if (isEnabled) {
      statusDiv.innerHTML = "Focus Mode: <span class='on'>ACTIVE</span>";
      toggleBtn.textContent = "Disable Focus Mode";
      toggleBtn.style.background = "#d9534f"; // Red to stop
      toggleBtn.style.color = "white";
    } else {
      statusDiv.innerHTML = "Focus Mode: <span class='off'>INACTIVE</span>";
      toggleBtn.textContent = "Enable Focus Mode";
      toggleBtn.style.background = "#5cb85c"; // Green to start
      toggleBtn.style.color = "white";
    }
  }

  chrome.storage.local.get("isEnabled", (data) => {
    // Default to true if undefined, but background sets it. 
    // If background hasn't run yet, assume true.
    const isEnabled = data.isEnabled !== false; 
    updateUI(isEnabled);
  });

  toggleBtn.addEventListener('click', () => {
    chrome.storage.local.get("isEnabled", (data) => {
      const newState = !data.isEnabled;
      chrome.storage.local.set({ isEnabled: newState }, () => {
        updateUI(newState);
        // Reload current tab if it's open? No, that's too aggressive.
      });
    });
  });

  optionsLink.addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options.html'));
    }
  });
});