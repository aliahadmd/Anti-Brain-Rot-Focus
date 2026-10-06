importScripts('lib/shared.js', 'lib/engine.js');

// The service worker is the only writer of focus, reward, blocklist, and stats
// state. Extension pages read storage directly but change it through messages,
// so every change is one serialized read-modify-write.

const BLOCK_RULE_ID = 1;
const RETURN_URL_PREFIX = 'returnUrl:';
const BLOCKING_KEYS = [
  STORAGE.blockedSites,
  STORAGE.isEnabled,
  STORAGE.pausedUntil,
  STORAGE.redirectEnabled,
  STORAGE.redirectUrl
];
// A tab sent to the redirect website this many times within the window keeps
// landing on blocked sites, so it gets the block page instead of looping.
const REDIRECT_LOOP_LIMIT = 3;
const REDIRECT_LOOP_WINDOW_MS = 10000;
// How long a blocked-load error for a URL we already redirected away from is
// treated as the tail of that same navigation.
const STALE_ERROR_WINDOW_MS = 5000;

let storageQueue = Promise.resolve();
let lastReconciledDateKey = null;

function withStorageLock(task) {
  const run = storageQueue.then(task);
  storageQueue = run.catch(() => {});
  return run;
}

function isFocusPaused(pausedUntil, now = Date.now()) {
  return Number.isFinite(pausedUntil) && pausedUntil > now;
}

function isFocusActive(data, now = Date.now()) {
  return data.isEnabled !== false && !isFocusPaused(data.pausedUntil, now);
}

function getBlockedSites(data) {
  return Array.isArray(data.blockedSites) ? data.blockedSites : [];
}

function getFocusContext(data) {
  return {
    isEnabled: data.isEnabled !== false,
    hasBlockedSites: getBlockedSites(data).length > 0
  };
}

function isWebUrl(url) {
  return url && (url.protocol === 'http:' || url.protocol === 'https:');
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch (error) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Rewards

async function loadReconciledRewards(date = new Date()) {
  const data = await chrome.storage.local.get([
    STORAGE.rewardState,
    STORAGE.isEnabled,
    STORAGE.blockedSites,
    STORAGE.pausedUntil
  ]);

  lastReconciledDateKey = getDateKey(date);
  return {
    data,
    rewardState: reconcileRewardState(data[STORAGE.rewardState], getFocusContext(data), date)
  };
}

function reconcileRewards() {
  return withStorageLock(async () => {
    const { rewardState } = await loadReconciledRewards();
    await chrome.storage.local.set({ [STORAGE.rewardState]: rewardState });
    return rewardState;
  });
}

// Makes sure today has a dayLog entry so it can be credited later.
function touchToday() {
  if (lastReconciledDateKey !== getDateKey()) {
    reconcileRewards().catch((error) => console.error('Reward reconcile failed:', error));
  }
}

// ---------------------------------------------------------------------------
// State changes requested by extension pages

function setFocusEnabled(enabled) {
  return withStorageLock(async () => {
    const { data, rewardState } = await loadReconciledRewards();
    const wasEnabled = data.isEnabled !== false;
    const nextRewardState = wasEnabled && !enabled
      ? applyRewardPenalty(rewardState, { reason: 'disable' })
      : rewardState;

    await chrome.storage.local.set({
      [STORAGE.isEnabled]: enabled,
      [STORAGE.pausedUntil]: null,
      [STORAGE.rewardState]: nextRewardState
    });
    await chrome.alarms.clear(ALARM.pauseEnd);

    return { penaltyApplied: nextRewardState !== rewardState };
  });
}

function pauseFocus(requestedMinutes) {
  const minutes = Number.isFinite(requestedMinutes) && requestedMinutes > 0
    ? Math.min(requestedMinutes, MAX_PAUSE_MINUTES)
    : DEFAULT_PAUSE_MINUTES;

  return withStorageLock(async () => {
    const { data, rewardState } = await loadReconciledRewards();

    // Nothing to pause: a stale block page asked while Focus was already
    // off or paused. Never charge twice.
    if (!isFocusActive(data)) {
      await chrome.storage.local.set({ [STORAGE.rewardState]: rewardState });
      return { penaltyApplied: false, focusActive: false, pausedUntil: data.pausedUntil || null };
    }

    const pausedUntil = Date.now() + minutes * 60000;
    await chrome.storage.local.set({
      [STORAGE.pausedUntil]: pausedUntil,
      [STORAGE.rewardState]: applyRewardPenalty(rewardState, { reason: 'pause', minutes })
    });
    await chrome.alarms.create(ALARM.pauseEnd, { when: pausedUntil });

    return { penaltyApplied: true, focusActive: false, pausedUntil };
  });
}

function resumeFocus() {
  return withStorageLock(async () => {
    const { rewardState } = await loadReconciledRewards();

    await chrome.storage.local.set({
      [STORAGE.pausedUntil]: null,
      [STORAGE.rewardState]: rewardState
    });
    await chrome.alarms.clear(ALARM.pauseEnd);
    return {};
  });
}

function clearExpiredPause() {
  return withStorageLock(async () => {
    const { pausedUntil } = await chrome.storage.local.get(STORAGE.pausedUntil);

    if (!pausedUntil) return;

    if (isFocusPaused(pausedUntil)) {
      await chrome.alarms.create(ALARM.pauseEnd, { when: pausedUntil });
      return;
    }

    await chrome.storage.local.set({ [STORAGE.pausedUntil]: null });
  });
}

function addSites(rawSites) {
  return withStorageLock(async () => {
    const { data, rewardState } = await loadReconciledRewards();
    const extra = await chrome.storage.local.get(STORAGE.siteAddedOn);
    const sites = getBlockedSites(data);
    const siteSet = new Set(sites);
    const siteAddedOn = { ...(extra[STORAGE.siteAddedOn] || {}) };
    const today = getDateKey();
    const result = { added: [], duplicates: [], invalid: [], overLimit: [] };

    (Array.isArray(rawSites) ? rawSites : []).forEach((rawSite) => {
      const { site, error } = normalizeSiteInput(rawSite);

      if (error) {
        result.invalid.push(String(rawSite));
      } else if (siteSet.has(site)) {
        result.duplicates.push(site);
      } else if (siteSet.size >= MAX_BLOCKED_SITES) {
        result.overLimit.push(site);
      } else {
        siteSet.add(site);
        siteAddedOn[site] = today;
        result.added.push(site);
      }
    });

    if (result.added.length > 0) {
      await chrome.storage.local.set({
        [STORAGE.blockedSites]: [...siteSet].sort(),
        [STORAGE.siteAddedOn]: siteAddedOn,
        [STORAGE.rewardState]: rewardState
      });
    }

    return result;
  });
}

function removeSite(siteToRemove) {
  return withStorageLock(async () => {
    const { data, rewardState } = await loadReconciledRewards();
    const extra = await chrome.storage.local.get(STORAGE.siteAddedOn);
    const sites = getBlockedSites(data);
    const site = normalizeHost(siteToRemove);

    if (!sites.includes(site)) {
      return { removed: false, penaltyApplied: false };
    }

    const siteAddedOn = { ...(extra[STORAGE.siteAddedOn] || {}) };
    const today = getDateKey();
    const isFree = siteAddedOn[site] === today;
    const remainingSites = sites.filter((item) => item !== site);
    let nextRewardState = isFree
      ? rewardState
      : applyRewardPenalty(rewardState, { reason: 'remove-site', site });

    if (remainingSites.length === 0) {
      nextRewardState = {
        ...nextRewardState,
        dayLog: { ...nextRewardState.dayLog, [today]: createDayEntry({ ...nextRewardState.dayLog[today], unprotected: true }) }
      };
    }

    delete siteAddedOn[site];
    await chrome.storage.local.set({
      [STORAGE.blockedSites]: remainingSites,
      [STORAGE.siteAddedOn]: siteAddedOn,
      [STORAGE.rewardState]: nextRewardState
    });

    return { removed: true, penaltyApplied: !isFree };
  });
}

function resetStats() {
  return withStorageLock(() => chrome.storage.local.set({
    [STORAGE.stats]: { total: 0 },
    [STORAGE.dailyStats]: {},
    [STORAGE.analyticsMeta]: {}
  }));
}

function recordVisit(site) {
  return withStorageLock(async () => {
    const data = await chrome.storage.local.get([STORAGE.stats, STORAGE.dailyStats]);
    const next = recordBlockedVisit(data[STORAGE.stats], data[STORAGE.dailyStats], site);

    await chrome.storage.local.set({
      [STORAGE.stats]: next.stats,
      [STORAGE.dailyStats]: next.dailyStats,
      [STORAGE.analyticsMeta]: next.analyticsMeta
    });
  });
}

const MESSAGE_HANDLERS = {
  [MESSAGE.setFocusEnabled]: (message) => setFocusEnabled(message.enabled === true),
  [MESSAGE.pauseFocus]: (message) => pauseFocus(Number(message.minutes)),
  [MESSAGE.resumeFocus]: () => resumeFocus(),
  [MESSAGE.addSites]: (message) => addSites(message.sites),
  [MESSAGE.removeSite]: (message) => removeSite(message.site),
  [MESSAGE.resetStats]: () => resetStats().then(() => ({})),
  [MESSAGE.reconcileRewards]: () => reconcileRewards().then((rewardState) => ({ rewardState }))
};

// Messages that change what is blocked. Their reply waits for the block rule
// to update, so a page that navigates right after a pause is not stopped by a
// stale rule.
const BLOCKING_MESSAGES = new Set([
  MESSAGE.setFocusEnabled,
  MESSAGE.pauseFocus,
  MESSAGE.resumeFocus,
  MESSAGE.addSites,
  MESSAGE.removeSite
]);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = message && typeof message === 'object' ? MESSAGE_HANDLERS[message.type] : null;
  if (!handler) return false;

  handler(message)
    .then(async (result) => {
      if (BLOCKING_MESSAGES.has(message.type)) {
        await scheduleBlockingSync();
      }
      sendResponse({ ok: true, ...result });
    })
    .catch((error) => {
      console.error(`${message.type} failed:`, error);
      sendResponse({ ok: false, error: error.message || String(error) });
    });
  return true;
});

// ---------------------------------------------------------------------------
// Blocking
//
// A declarativeNetRequest block rule stops blocked hosts from loading at all,
// including prerendered pages. webNavigation then swaps the tab to the block
// page (or the user's redirect website), and a sweep catches tabs that were
// already open when protection was switched on, a pause ended, or a site was
// added.

// tabId -> { fromUrl, at, customTimes }
const tabRedirects = new Map();

async function redirectBlockedTab(tabId, url, hostname, data, { allowCustom = true } = {}) {
  const now = Date.now();
  const memory = tabRedirects.get(tabId) || { customTimes: [] };
  const customTimes = memory.customTimes.filter((time) => now - time < REDIRECT_LOOP_WINDOW_MS);
  const target = allowCustom ? getRedirectTarget(data) : null;
  const useCustom = Boolean(target) && customTimes.length < REDIRECT_LOOP_LIMIT;
  const destination = useCustom
    ? target
    : `${chrome.runtime.getURL('blocked.html')}?target=${encodeURIComponent(normalizeHost(hostname))}`;

  tabRedirects.set(tabId, { fromUrl: url, at: now, customTimes: useCustom ? [...customTimes, now] : customTimes });

  if (!useCustom) {
    try {
      // Kept in memory-only session storage so the block page can offer a way
      // back after a pause without the full URL touching disk or history.
      await chrome.storage.session.set({ [`${RETURN_URL_PREFIX}${tabId}`]: url });
    } catch (error) {
      console.warn('Could not remember the blocked URL:', error);
    }
  }

  try {
    await chrome.tabs.update(tabId, { url: destination });
  } catch (error) {
    // The tab may have closed in the meantime.
    console.warn(`Could not redirect tab ${tabId}:`, error.message || error);
  }
}

async function handleNavigation(tabId, rawUrl, { countVisit, isBackstop = false }) {
  if (tabId < 0) return;

  const url = parseUrl(rawUrl);
  if (!isWebUrl(url)) return;

  if (isBackstop) {
    // The rule stopped a navigation we are already redirecting away from;
    // redirecting again would override where the first redirect is going.
    const memory = tabRedirects.get(tabId);
    if (memory && memory.fromUrl === rawUrl && Date.now() - memory.at < STALE_ERROR_WINDOW_MS) return;
  }

  touchToday();

  const data = await chrome.storage.local.get(BLOCKING_KEYS);

  if (data.pausedUntil && !isFocusPaused(data.pausedUntil)) {
    clearExpiredPause().catch((error) => console.error('Clearing pause failed:', error));
  }

  if (!isFocusActive(data)) return;

  const site = findMatchingBlockedSite(url.hostname, getBlockedSites(data));
  if (!site) return;

  // A blocked load reaching the backstop may have bounced off the redirect
  // website itself, so it always gets the block page.
  await redirectBlockedTab(tabId, rawUrl, url.hostname, data, { allowCustom: !isBackstop });

  if (countVisit) {
    await recordVisit(site);
  }
}

async function sweepOpenTabs(blockedSites, data) {
  const siteSet = new Set(blockedSites.map(normalizeHost));
  const tabs = await chrome.tabs.query({});

  await Promise.all(tabs.map(async (tab) => {
    if (!Number.isInteger(tab.id) || tab.id < 0) return;

    // Tab URLs need the "tabs" permission; reading the top frame through
    // webNavigation does not.
    const frame = await chrome.webNavigation.getFrame({ tabId: tab.id, frameId: 0 }).catch(() => null);
    const url = frame && parseUrl(frame.url);

    if (isWebUrl(url) && findMatchingBlockedSite(url.hostname, siteSet)) {
      await redirectBlockedTab(tab.id, frame.url, url.hostname, data);
    }
  }));
}

async function syncBlocking() {
  const data = await chrome.storage.local.get(BLOCKING_KEYS);
  const active = isFocusActive(data);
  const domains = active
    ? [...new Set(getBlockedSites(data).map(normalizeHost))].filter((site) => /^[a-z0-9.-]+$/.test(site))
    : [];
  const addRules = domains.length > 0
    ? [{
        id: BLOCK_RULE_ID,
        priority: 1,
        action: { type: 'block' },
        condition: { requestDomains: domains, resourceTypes: ['main_frame'] }
      }]
    : [];

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [BLOCK_RULE_ID], addRules });
  } catch (error) {
    // webNavigation redirects still work without the rule.
    console.error('Updating block rules failed:', error);
  }

  if (domains.length > 0) {
    await sweepOpenTabs(domains, data);
  }
}

let blockingSync = Promise.resolve();
let blockingSyncPending = false;

function scheduleBlockingSync() {
  if (blockingSyncPending) return blockingSync;

  blockingSyncPending = true;
  blockingSync = blockingSync
    .then(() => {
      blockingSyncPending = false;
      return syncBlocking();
    })
    .catch((error) => console.error('Blocking sync failed:', error));
  return blockingSync;
}

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  // Prerendered pages have a non-zero frameId; the block rule stops those.
  if (details.frameId !== 0) return;

  handleNavigation(details.tabId, details.url, { countVisit: true })
    .catch((error) => console.error('Navigation check failed:', error));
});

chrome.webNavigation.onErrorOccurred.addListener((details) => {
  // Backstop for loads stopped by the block rule before the redirect landed.
  if (details.frameId !== 0 || details.error !== 'net::ERR_BLOCKED_BY_CLIENT') return;

  handleNavigation(details.tabId, details.url, { countVisit: false, isBackstop: true })
    .catch((error) => console.error('Blocked-load check failed:', error));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabRedirects.delete(tabId);
  chrome.storage.session.remove(`${RETURN_URL_PREFIX}${tabId}`).catch(() => {});
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  if (changes[STORAGE.blockedSites] || changes[STORAGE.isEnabled] || changes[STORAGE.pausedUntil]) {
    scheduleBlockingSync();
  }
});

// ---------------------------------------------------------------------------
// Lifecycle

async function ensureAlarms() {
  const existing = await chrome.alarms.get(ALARM.rewardReconcile);

  if (!existing) {
    await chrome.alarms.create(ALARM.rewardReconcile, { periodInMinutes: REWARD_RECONCILE_PERIOD_MINUTES });
  }
}

function initializeStorage() {
  return withStorageLock(async () => {
    const data = await chrome.storage.local.get(Object.values(STORAGE));
    const today = getDateKey();
    const updates = {};

    if (!Array.isArray(data.blockedSites)) {
      updates.blockedSites = [...DEFAULT_BLOCKED_SITES].sort();
      updates.siteAddedOn = Object.fromEntries(DEFAULT_BLOCKED_SITES.map((site) => [site, today]));
    } else if (!data.siteAddedOn || typeof data.siteAddedOn !== 'object') {
      // Sites from older versions have no date, so removing them is never free.
      updates.siteAddedOn = {};
    }
    if (!data.motivationalText) updates.motivationalText = DEFAULT_MOTIVATION;
    if (data.isEnabled === undefined) updates.isEnabled = true;
    if (!data.stats) updates.stats = { total: 0 };
    if (!data.dailyStats) updates.dailyStats = {};
    if (!data.analyticsMeta) updates.analyticsMeta = {};
    if (data.pausedUntil === undefined) updates.pausedUntil = null;

    const merged = { ...data, ...updates };
    updates.rewardState = reconcileRewardState(data.rewardState, getFocusContext(merged));
    lastReconciledDateKey = today;

    await chrome.storage.local.set(updates);
  });
}

chrome.runtime.onInstalled.addListener(() => {
  initializeStorage()
    .then(ensureAlarms)
    .then(clearExpiredPause)
    .then(scheduleBlockingSync)
    .catch((error) => console.error('Install setup failed:', error));
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarms()
    .then(clearExpiredPause)
    .then(reconcileRewards)
    .then(scheduleBlockingSync)
    .catch((error) => console.error('Startup setup failed:', error));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM.rewardReconcile) {
    reconcileRewards().catch((error) => console.error('Reward reconcile failed:', error));
  } else if (alarm.name === ALARM.pauseEnd) {
    clearExpiredPause().catch((error) => console.error('Clearing pause failed:', error));
  }
});
