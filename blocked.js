document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const target = normalizeSiteInput(params.get('target')).site || null;
  const targetEl = document.getElementById('target');
  const motivationEl = document.getElementById('motivation');
  const totalCountEl = document.getElementById('totalCount');
  const closeTabBtn = document.getElementById('closeTabBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const optionsLink = document.getElementById('optionsLink');
  const actionStatus = document.getElementById('actionStatus');
  const pauseLabel = `Pause ${BLOCK_PAGE_PAUSE_MINUTES}m`;
  let stillBlocked = true;

  targetEl.textContent = target ? `${target} is on your blocked list.` : 'This site is on your blocked list.';

  function getCurrentTabId() {
    return new Promise((resolve) => {
      chrome.tabs.getCurrent((tab) => resolve(tab && Number.isInteger(tab.id) ? tab.id : null));
    });
  }

  async function getReturnUrl() {
    const tabId = await getCurrentTabId();

    if (tabId !== null) {
      const key = `returnUrl:${tabId}`;
      const stored = await chrome.storage.session.get(key).catch(() => ({}));

      try {
        const url = new URL(stored[key]);
        if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
      } catch (error) {
        // Fall back to the site root below.
      }
    }

    return target ? `https://${target}/` : null;
  }

  async function continueToSite(message) {
    const url = await getReturnUrl();

    actionStatus.textContent = message;
    if (url) window.location.replace(url);
  }

  function render(data) {
    const focusActive = data.isEnabled !== false && !(Number.isFinite(data.pausedUntil) && data.pausedUntil > Date.now());

    stillBlocked = focusActive && Boolean(target && findMatchingBlockedSite(target, data.blockedSites || []));
    motivationEl.textContent = data.motivationalText || DEFAULT_MOTIVATION;
    totalCountEl.textContent = (data.stats && data.stats.total) || 0;
    pauseBtn.textContent = stillBlocked ? pauseLabel : 'Continue to site';
  }

  function refresh() {
    chrome.storage.local.get([
      STORAGE.motivationalText,
      STORAGE.stats,
      STORAGE.isEnabled,
      STORAGE.pausedUntil,
      STORAGE.blockedSites
    ], render);
  }

  closeTabBtn.addEventListener('click', async () => {
    const tabId = await getCurrentTabId();

    if (tabId !== null) {
      chrome.tabs.remove(tabId);
      return;
    }

    window.close();
  });

  pauseBtn.addEventListener('click', async () => {
    if (!stillBlocked) {
      continueToSite('This site is not blocked right now.');
      return;
    }

    if (!window.confirm(PAUSE_WARNING)) return;

    pauseBtn.disabled = true;
    const response = await sendExtensionMessage({ type: MESSAGE.pauseFocus, minutes: BLOCK_PAGE_PAUSE_MINUTES });

    if (!response.ok) {
      pauseBtn.disabled = false;
      actionStatus.textContent = `Pause was not applied. ${response.error}`;
      return;
    }

    continueToSite(response.penaltyApplied
      ? `Focus is paused for ${BLOCK_PAGE_PAUSE_MINUTES} minutes. Reward progress lost ${REWARD_PENALTY_DAYS} days.`
      : 'Focus was already paused or off.');
  });

  optionsLink.addEventListener('click', () => chrome.runtime.openOptionsPage());

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') refresh();
  });

  pauseBtn.textContent = pauseLabel;
  refresh();
});
