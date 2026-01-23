document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const target = params.get('target');
  
  if (target) {
    document.getElementById('target').textContent = `You tried to visit ${target}`;
  } else {
    document.getElementById('target').style.display = 'none';
  }

  chrome.storage.local.get("motivationalText", (data) => {
    const text = data.motivationalText || "Don't let the brain rot consume you! Stay focused and build your future.";
    document.getElementById('motivation').textContent = text;
  });

  document.getElementById('optionsLink').addEventListener('click', (e) => {
    e.preventDefault();
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    }
  });
});