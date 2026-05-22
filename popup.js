document.addEventListener('DOMContentLoaded', () => {
  const PAUSE_WARNING = 'Pausing costs 3 reward days. Keep protecting your streak?';
  const DISABLE_WARNING = 'Disabling Focus makes today ineligible for rewards. Disable Focus anyway?';
  const statusDiv = document.getElementById('status');
  const toggleBtn = document.getElementById('toggleBtn');
  const optionsLink = document.getElementById('optionsLink');
  const totalCountEl = document.getElementById('totalCount');
  const siteCountEl = document.getElementById('siteCount');
  const resumeBtn = document.getElementById('resumeBtn');
  const pauseButtons = [...document.querySelectorAll('.pause-btn')];

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

    toggleBtn.classList.toggle('off', isEnabled);
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
    chrome.storage.local.get(['isEnabled', 'pausedUntil', 'stats', 'blockedSites'], (data) => {
      if (data.pausedUntil && data.pausedUntil <= Date.now()) {
        chrome.storage.local.set({ pausedUntil: null }, () => {
          updateUI({ ...data, pausedUntil: null });
        });
        return;
      }

      updateUI(data);
    });
  }

  function applyPausePenalty(minutes, callback) {
    chrome.runtime.sendMessage({
      type: 'APPLY_PAUSE_REWARD_PENALTY',
      minutes
    }, (response) => {
      if (chrome.runtime.lastError || !response || !response.ok) {
        window.alert('Pause was not applied because the reward penalty could not be recorded.');
        return;
      }

      callback();
    });
  }

  function markFocusDisabled(callback) {
    chrome.runtime.sendMessage({ type: 'MARK_FOCUS_DISABLED' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.ok) {
        window.alert('Focus was not disabled because the reward state could not be updated.');
        return;
      }

      callback();
    });
  }

  toggleBtn.addEventListener('click', () => {
    chrome.storage.local.get('isEnabled', (data) => {
      const newState = data.isEnabled === false;

      if (!newState && !window.confirm(DISABLE_WARNING)) {
        refresh();
        return;
      }

      const saveState = () => chrome.storage.local.set({ isEnabled: newState, pausedUntil: null }, () => {
        refresh();
      });

      if (newState) {
        saveState();
      } else {
        markFocusDisabled(saveState);
      }
    });
  });

  pauseButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const minutes = Number(button.dataset.minutes);
      if (!Number.isFinite(minutes)) return;
      if (!window.confirm(PAUSE_WARNING)) return;

      applyPausePenalty(minutes, () => {
        chrome.storage.local.set({
          isEnabled: true,
          pausedUntil: Date.now() + minutes * 60000
        }, refresh);
      });
    });
  });

  resumeBtn.addEventListener('click', () => {
    chrome.storage.local.set({ isEnabled: true, pausedUntil: null }, refresh);
  });

  optionsLink.addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options.html'));
    }
  });

  refresh();
  setInterval(refresh, 30000);
});
