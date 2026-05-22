const STORAGE_KEYS = ['stats', 'motivationalText', 'blockedSites', 'isEnabled', 'pausedUntil'];
const DEFAULT_MOTIVATION = 'You came here to focus. Take a breath, choose the next useful action, and keep going.';

document.addEventListener('DOMContentLoaded', () => {
  const totalCountEl = document.getElementById('totalCount');
  const blockedCountEl = document.getElementById('blockedCount');
  const topDistractionsEl = document.getElementById('topDistractions');
  const motivationTextEl = document.getElementById('motivationText');
  const saveTextBtn = document.getElementById('saveTextBtn');
  const saveStatus = document.getElementById('saveStatus');
  const newSiteInput = document.getElementById('newSite');
  const addSiteBtn = document.getElementById('addSiteBtn');
  const siteFeedback = document.getElementById('siteFeedback');
  const siteListEl = document.getElementById('siteList');
  const enabledToggle = document.getElementById('enabledToggle');
  const focusState = document.getElementById('focusState');
  const pauseStatus = document.getElementById('pauseStatus');
  const resumeFocusBtn = document.getElementById('resumeFocusBtn');
  const resetStatsBtn = document.getElementById('resetStatsBtn');
  const presetButtons = [...document.querySelectorAll('.preset-btn')];

  function showMessage(element, message, isError = false) {
    element.textContent = message;
    element.classList.toggle('error', isError);

    if (message) {
      setTimeout(() => {
        if (element.textContent === message) {
          element.textContent = '';
          element.classList.remove('error');
        }
      }, 2600);
    }
  }

  function getRemainingPause(pausedUntil) {
    if (!Number.isFinite(pausedUntil)) return 0;
    return Math.max(0, pausedUntil - Date.now());
  }

  function formatRemaining(ms) {
    const minutes = Math.ceil(ms / 60000);
    if (minutes < 60) return `${minutes} minutes left`;

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes ? `${hours}h ${remainingMinutes}m left` : `${hours}h left`;
  }

  function normalizeSiteInput(value) {
    let input = value.trim().toLowerCase();

    if (!input) {
      return { error: 'Enter a domain to block.' };
    }

    input = input.replace(/^\*\./, '');

    try {
      if (!/^[a-z][a-z0-9+.-]*:\/\//.test(input)) {
        input = `https://${input}`;
      }

      const { hostname } = new URL(input);
      const site = hostname.replace(/^www\./, '').replace(/\.$/, '');

      if (!site || site.includes('..') || !/^[a-z0-9.-]+$/.test(site)) {
        return { error: 'Use a valid domain, like example.com.' };
      }

      if (!site.includes('.') && site !== 'localhost') {
        return { error: 'Use a full domain, like example.com.' };
      }

      return { site };
    } catch (error) {
      return { error: 'Use a valid domain, like example.com.' };
    }
  }

  function renderFocusState(data) {
    const isEnabled = data.isEnabled !== false;
    const remainingPause = getRemainingPause(data.pausedUntil);
    const stateContainer = focusState.parentElement;

    enabledToggle.checked = isEnabled;
    stateContainer.classList.remove('off', 'paused');

    if (!isEnabled) {
      focusState.textContent = 'Off';
      pauseStatus.textContent = 'Blocking is disabled';
      stateContainer.classList.add('off');
      resumeFocusBtn.disabled = true;
      return;
    }

    if (remainingPause > 0) {
      focusState.textContent = 'Paused';
      pauseStatus.textContent = formatRemaining(remainingPause);
      stateContainer.classList.add('paused');
      resumeFocusBtn.disabled = false;
      return;
    }

    focusState.textContent = 'Active';
    pauseStatus.textContent = 'Blocking distractions';
    resumeFocusBtn.disabled = !data.pausedUntil;
  }

  function renderTopDistractions(stats = {}) {
    topDistractionsEl.textContent = '';

    const sorted = Object.entries(stats)
      .filter(([key, value]) => key !== 'total' && Number.isFinite(value))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    if (sorted.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No redirects yet.';
      topDistractionsEl.appendChild(li);
      return;
    }

    sorted.forEach(([site, count]) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      const countEl = document.createElement('span');

      name.textContent = site;
      countEl.className = 'count';
      countEl.textContent = ` ${count}`;

      li.append(name, countEl);
      topDistractionsEl.appendChild(li);
    });
  }

  function renderSiteList(sites = []) {
    siteListEl.textContent = '';
    blockedCountEl.textContent = sites.length;

    if (sites.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No blocked sites yet.';
      siteListEl.appendChild(li);
      return;
    }

    [...sites].sort().forEach((site) => {
      const li = document.createElement('li');
      const siteName = document.createElement('span');
      const btn = document.createElement('button');

      siteName.className = 'site-name';
      siteName.textContent = site;

      btn.textContent = 'Remove';
      btn.type = 'button';
      btn.className = 'remove-btn';
      btn.addEventListener('click', () => removeSite(site));

      li.append(siteName, btn);
      siteListEl.appendChild(li);
    });
  }

  function loadData() {
    chrome.storage.local.get(STORAGE_KEYS, (data) => {
      const stats = data.stats || { total: 0 };
      const blockedSites = Array.isArray(data.blockedSites) ? data.blockedSites : [];

      if (data.pausedUntil && data.pausedUntil <= Date.now()) {
        chrome.storage.local.set({ pausedUntil: null });
        data.pausedUntil = null;
      }

      totalCountEl.textContent = stats.total || 0;
      motivationTextEl.value = data.motivationalText || DEFAULT_MOTIVATION;

      renderFocusState(data);
      renderTopDistractions(stats);
      renderSiteList(blockedSites);
    });
  }

  function saveBlockedSites(sites, callback = loadData) {
    const uniqueSites = [...new Set(sites)].sort();
    chrome.storage.local.set({ blockedSites: uniqueSites }, callback);
  }

  function addSiteFromInput() {
    const result = normalizeSiteInput(newSiteInput.value);

    if (result.error) {
      showMessage(siteFeedback, result.error, true);
      return;
    }

    chrome.storage.local.get(['blockedSites'], (data) => {
      const sites = Array.isArray(data.blockedSites) ? data.blockedSites : [];

      if (sites.includes(result.site)) {
        showMessage(siteFeedback, `${result.site} is already blocked.`, true);
        return;
      }

      saveBlockedSites([...sites, result.site], () => {
        newSiteInput.value = '';
        showMessage(siteFeedback, `${result.site} added.`);
        loadData();
      });
    });
  }

  function removeSite(siteToRemove) {
    chrome.storage.local.get(['blockedSites'], (data) => {
      const sites = Array.isArray(data.blockedSites) ? data.blockedSites : [];
      saveBlockedSites(sites.filter((site) => site !== siteToRemove));
    });
  }

  saveTextBtn.addEventListener('click', () => {
    const text = motivationTextEl.value.trim();

    if (!text) {
      showMessage(saveStatus, 'Add a message before saving.', true);
      return;
    }

    chrome.storage.local.set({ motivationalText: text }, () => {
      showMessage(saveStatus, 'Saved.');
    });
  });

  addSiteBtn.addEventListener('click', addSiteFromInput);

  newSiteInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addSiteFromInput();
    }
  });

  enabledToggle.addEventListener('change', () => {
    chrome.storage.local.set({
      isEnabled: enabledToggle.checked,
      pausedUntil: null
    }, loadData);
  });

  resumeFocusBtn.addEventListener('click', () => {
    chrome.storage.local.set({ isEnabled: true, pausedUntil: null }, loadData);
  });

  resetStatsBtn.addEventListener('click', () => {
    if (!window.confirm('Reset focus statistics?')) return;
    chrome.storage.local.set({ stats: { total: 0 } }, loadData);
  });

  presetButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const presetSites = button.dataset.sites
        .split(',')
        .map((site) => normalizeSiteInput(site).site)
        .filter(Boolean);

      chrome.storage.local.get(['blockedSites'], (data) => {
        const sites = Array.isArray(data.blockedSites) ? data.blockedSites : [];
        const additions = presetSites.filter((site) => !sites.includes(site));

        if (additions.length === 0) {
          showMessage(siteFeedback, 'Those sites are already blocked.');
          return;
        }

        saveBlockedSites([...sites, ...additions], () => {
          showMessage(siteFeedback, `${additions.length} sites added.`);
          loadData();
        });
      });
    });
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && Object.keys(changes).some((key) => STORAGE_KEYS.includes(key))) {
      loadData();
    }
  });

  loadData();
  setInterval(loadData, 30000);
});
