const DEFAULT_MOTIVATION = 'You came here to focus. Take a breath, choose the next useful action, and keep going.';

document.addEventListener('DOMContentLoaded', () => {
  const PAUSE_WARNING = 'Pausing costs 3 reward days. Keep protecting your streak?';
  const params = new URLSearchParams(window.location.search);
  const target = params.get('target');
  const targetEl = document.getElementById('target');
  const motivationEl = document.getElementById('motivation');
  const totalCountEl = document.getElementById('totalCount');
  const closeTabBtn = document.getElementById('closeTabBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const optionsLink = document.getElementById('optionsLink');
  const actionStatus = document.getElementById('actionStatus');

  if (target) {
    targetEl.textContent = `${target} is on your blocked list.`;
  } else {
    targetEl.textContent = 'This site is on your blocked list.';
  }

  chrome.storage.local.get(['motivationalText', 'stats'], (data) => {
    motivationEl.textContent = data.motivationalText || DEFAULT_MOTIVATION;
    totalCountEl.textContent = (data.stats && data.stats.total) || 0;
  });

  closeTabBtn.addEventListener('click', () => {
    chrome.tabs.getCurrent((tab) => {
      if (tab && Number.isInteger(tab.id)) {
        chrome.tabs.remove(tab.id);
        return;
      }

      window.close();
    });
  });

  pauseBtn.addEventListener('click', () => {
    if (!window.confirm(PAUSE_WARNING)) return;

    chrome.runtime.sendMessage({
      type: 'APPLY_PAUSE_REWARD_PENALTY',
      minutes: 5
    }, (response) => {
      if (chrome.runtime.lastError || !response || !response.ok) {
        actionStatus.textContent = 'Pause was not applied because the reward penalty could not be recorded.';
        return;
      }

      chrome.storage.local.set({
        isEnabled: true,
        pausedUntil: Date.now() + 5 * 60000
      }, () => {
        actionStatus.textContent = 'Focus is paused for 5 minutes. Reward progress lost 3 days.';
        pauseBtn.disabled = true;
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
