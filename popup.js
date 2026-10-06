document.addEventListener('DOMContentLoaded', () => {
  const statusDiv = document.getElementById('status');
  const toggleBtn = document.getElementById('toggleBtn');
  const optionsLink = document.getElementById('optionsLink');
  const totalCountEl = document.getElementById('totalCount');
  const siteCountEl = document.getElementById('siteCount');
  const resumeBtn = document.getElementById('resumeBtn');
  const pauseButtons = [...document.querySelectorAll('.pause-btn')];
  let busy = false;

  function getRemainingPause(pausedUntil) {
    if (!Number.isFinite(pausedUntil)) return 0;
    return Math.max(0, pausedUntil - Date.now());
  }

  function formatRemaining(ms) {
    const minutes = Math.ceil(ms / 60000);
    if (minutes < 60) return `${minutes}m left`;

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes ? `${hours}h ${remainingMinutes}m left` : `${hours}h left`;
  }

  function setStatus(label, stateClass = '') {
    statusDiv.className = `status ${stateClass}`.trim();
    statusDiv.textContent = '';

    const strong = document.createElement('strong');
    strong.textContent = label;
    statusDiv.append('Focus is ', strong);
  }

  function updateUI(data) {
    const isEnabled = data.isEnabled !== false;
    const remainingPause = getRemainingPause(data.pausedUntil);
    const isPaused = isEnabled && remainingPause > 0;

    totalCountEl.textContent = (data.stats && data.stats.total) || 0;
    siteCountEl.textContent = Array.isArray(data.blockedSites) ? data.blockedSites.length : 0;

    toggleBtn.classList.toggle('danger', isEnabled);
    toggleBtn.textContent = isEnabled ? 'Disable Focus' : 'Enable Focus';

    pauseButtons.forEach((button) => {
      button.hidden = !isEnabled || isPaused;
    });
    resumeBtn.hidden = !isPaused;

    if (!isEnabled) {
      setStatus('off', 'off');
    } else if (isPaused) {
      setStatus(`paused, ${formatRemaining(remainingPause)}`, 'paused');
    } else {
      setStatus('active');
    }
  }

  function refresh() {
    chrome.storage.local.get([STORAGE.isEnabled, STORAGE.pausedUntil, STORAGE.stats, STORAGE.blockedSites], updateUI);
  }

  async function runAction(message, failureText) {
    if (busy) return;
    busy = true;

    const response = await sendExtensionMessage(message);
    busy = false;

    if (!response.ok) {
      window.alert(`${failureText} ${response.error}`);
    }
    refresh();
  }

  toggleBtn.addEventListener('click', () => {
    chrome.storage.local.get(STORAGE.isEnabled, (data) => {
      const enable = data.isEnabled === false;

      if (!enable && !window.confirm(DISABLE_WARNING)) return;

      runAction({ type: MESSAGE.setFocusEnabled, enabled: enable }, 'Focus was not changed.');
    });
  });

  pauseButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const minutes = Number(button.dataset.minutes);
      if (!Number.isFinite(minutes)) return;
      if (!window.confirm(PAUSE_WARNING)) return;

      runAction({ type: MESSAGE.pauseFocus, minutes }, 'Pause was not applied.');
    });
  });

  resumeBtn.addEventListener('click', () => {
    runAction({ type: MESSAGE.resumeFocus }, 'Focus was not resumed.');
  });

  optionsLink.addEventListener('click', () => chrome.runtime.openOptionsPage());

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') refresh();
  });

  refresh();
  setInterval(refresh, UI_REFRESH_INTERVAL_MS);
});
