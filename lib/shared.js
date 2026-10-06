// Shared constants and helpers. Loaded by the service worker (importScripts)
// and by every extension page (<script src>), so keep it free of DOM access
// and of chrome.* calls at load time.

const DEFAULT_BLOCKED_SITES = [
  'youtube.com',
  'x.com',
  'twitter.com',
  'facebook.com',
  'instagram.com',
  'tiktok.com',
  'reddit.com'
];

const PRESET_BLOCKLISTS = {
  social: DEFAULT_BLOCKED_SITES,
  streaming: ['netflix.com', 'hulu.com', 'disneyplus.com', 'twitch.tv'],
  shopping: ['amazon.com', 'ebay.com', 'etsy.com']
};

const DEFAULT_MOTIVATION = 'You came here to focus. Take a breath, choose the next useful action, and keep going.';

const STORAGE = {
  blockedSites: 'blockedSites',
  siteAddedOn: 'siteAddedOn',
  motivationalText: 'motivationalText',
  redirectEnabled: 'redirectEnabled',
  redirectUrl: 'redirectUrl',
  isEnabled: 'isEnabled',
  pausedUntil: 'pausedUntil',
  stats: 'stats',
  dailyStats: 'dailyStats',
  analyticsMeta: 'analyticsMeta',
  rewardState: 'rewardState'
};

const MESSAGE = {
  setFocusEnabled: 'SET_FOCUS_ENABLED',
  pauseFocus: 'PAUSE_FOCUS',
  resumeFocus: 'RESUME_FOCUS',
  addSites: 'ADD_SITES',
  removeSite: 'REMOVE_SITE',
  resetStats: 'RESET_STATS',
  reconcileRewards: 'RECONCILE_REWARDS'
};

const ALARM = {
  rewardReconcile: 'reward-reconcile',
  pauseEnd: 'pause-end'
};

const REWARD_PENALTY_DAYS = 3;
const FOCUS_MEDAL_INTERVAL = 10;
const PRESTIGE_MEDAL_INTERVAL = 30;
const REWARD_RETENTION_DAYS = 370;
const DAILY_STATS_RETENTION_DAYS = 370;
const REWARD_RECONCILE_PERIOD_MINUTES = 60;
const BLOCK_PAGE_PAUSE_MINUTES = 5;
const DEFAULT_PAUSE_MINUTES = 5;
const MAX_PAUSE_MINUTES = 24 * 60;
const MAX_BLOCKED_SITES = 2000;
const MAX_IMPORT_FILE_BYTES = 512 * 1024;
const UI_REFRESH_INTERVAL_MS = 30000;
const FEEDBACK_CLEAR_MS = 3600;

const MEDAL_NAMES_10 = [
  'Neon Spark',
  'Prism Momentum',
  'Comet Cadence',
  'Aurora Focus',
  'Thunder Crown',
  'Quantum Streak'
];
const MEDAL_NAMES_30 = [
  'Chrono Phoenix',
  'Solar Titan',
  'Galaxy Guardian',
  'Diamond Mind'
];
const MEDAL_GLYPHS_10 = ['✦', '◆', '☄', '✺', '♛', '✧'];
const MEDAL_GLYPHS_30 = ['🔥', '☀', '✹', '♦'];

const PAUSE_WARNING = `Pausing costs ${REWARD_PENALTY_DAYS} reward days and makes today ineligible. Pause anyway?`;
const DISABLE_WARNING = `Disabling Focus costs ${REWARD_PENALTY_DAYS} reward days and makes today ineligible. Disable Focus anyway?`;

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function getDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function parseDateKeyLocal(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date, days) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function getLocalIsoString(date = new Date()) {
  const offsetMinutes = -date.getTimezoneOffset();
  const offsetSign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absoluteOffset / 60)).padStart(2, '0');
  const offsetRemainingMinutes = String(absoluteOffset % 60).padStart(2, '0');
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offsetSign}${offsetHours}:${offsetRemainingMinutes}`;
}

function getLocalTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time';
  } catch (error) {
    return 'Local time';
  }
}

function normalizeHost(hostname) {
  return String(hostname || '').toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
}

// Parses user input (a domain or a URL) into a blockable domain.
// Returns { site, hasPath } on success or { error } on failure.
function normalizeSiteInput(value) {
  let input = String(value || '').trim().toLowerCase();

  if (!input) {
    return { error: 'Enter a domain to block.' };
  }

  input = input.replace(/^\*\./, '');

  try {
    if (!/^[a-z][a-z0-9+.-]*:\/\//.test(input)) {
      input = `https://${input}`;
    }

    const url = new URL(input);
    const site = normalizeHost(url.hostname);

    if (!site || site.includes('..') || !/^[a-z0-9.-]+$/.test(site)) {
      return { error: 'Use a valid domain, like example.com.' };
    }

    if (!site.includes('.') && site !== 'localhost') {
      return { error: 'Use a full domain, like example.com.' };
    }

    const hasPath = (url.pathname && url.pathname !== '/') || Boolean(url.search) || Boolean(url.hash);
    return { site, hasPath };
  } catch (error) {
    return { error: 'Use a valid domain, like example.com.' };
  }
}

// Parses a website address for the redirect setting.
// Returns { url, host } on success or { error } on failure.
function normalizeRedirectUrl(value) {
  let input = String(value || '').trim();

  if (!input) {
    return { error: 'Enter a website to redirect to.' };
  }

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    input = `https://${input}`;
  }

  try {
    const url = new URL(input);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { error: 'Use an http or https address.' };
    }

    if (!url.hostname.includes('.') && url.hostname !== 'localhost') {
      return { error: 'Use a full address, like https://example.com.' };
    }

    return { url: url.href, host: url.hostname };
  } catch (error) {
    return { error: 'Use a valid web address, like https://example.com.' };
  }
}

// Returns the website blocked visits should go to, or null to use the block
// page. A target that is itself blocked would loop, so it falls back too.
function getRedirectTarget(data) {
  if (!data || data.redirectEnabled !== true) return null;

  const { url, host, error } = normalizeRedirectUrl(data.redirectUrl);
  if (error) return null;

  const blockedSites = Array.isArray(data.blockedSites) ? data.blockedSites : [];
  return findMatchingBlockedSite(host, blockedSites) ? null : url;
}

// Returns the blocked site that covers hostname (most specific match), or null.
// Walks the host's parent domains, so it stays fast for long blocklists.
function findMatchingBlockedSite(hostname, blockedSites = []) {
  const sites = blockedSites instanceof Set ? blockedSites : new Set(blockedSites.map(normalizeHost));
  let candidate = normalizeHost(hostname);

  while (candidate) {
    if (sites.has(candidate)) return candidate;

    const dotIndex = candidate.indexOf('.');
    if (dotIndex === -1) return null;
    candidate = candidate.slice(dotIndex + 1);
  }

  return null;
}

// Promise wrapper for messages from extension pages to the service worker.
// Always resolves; failures come back as { ok: false, error }.
function sendExtensionMessage(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        const lastError = chrome.runtime.lastError;

        if (lastError || !response || !response.ok) {
          resolve({
            ok: false,
            error: (response && response.error) || (lastError && lastError.message) || 'The background service did not respond.'
          });
          return;
        }

        resolve(response);
      });
    } catch (error) {
      resolve({ ok: false, error: error.message });
    }
  });
}

function getMedalName(type, threshold) {
  if (type === 'prestige') {
    const index = Math.floor(threshold / PRESTIGE_MEDAL_INTERVAL) - 1;
    return MEDAL_NAMES_30[index % MEDAL_NAMES_30.length];
  }

  const index = Math.floor(threshold / FOCUS_MEDAL_INTERVAL) - 1;
  return MEDAL_NAMES_10[index % MEDAL_NAMES_10.length];
}

function getMedalGlyph(type, threshold) {
  if (type === 'prestige') {
    const index = Math.floor(threshold / PRESTIGE_MEDAL_INTERVAL) - 1;
    return MEDAL_GLYPHS_30[index % MEDAL_GLYPHS_30.length];
  }

  const index = Math.floor(threshold / FOCUS_MEDAL_INTERVAL) - 1;
  return MEDAL_GLYPHS_10[index % MEDAL_GLYPHS_10.length];
}

function createDefaultRewardState(date = new Date()) {
  const today = getDateKey(date);

  return {
    progressDays: 0,
    lastEvaluatedDate: today,
    dayLog: {
      [today]: createDayEntry()
    },
    pauseEvents: [],
    earnedMedals: [],
    createdAt: getLocalIsoString(date),
    timeZone: getLocalTimeZone()
  };
}

function createDayEntry(entry = {}) {
  return {
    disabled: false,
    paused: false,
    siteRemoved: false,
    unprotected: false,
    credited: false,
    ...entry
  };
}

function normalizeRewardState(state, date = new Date()) {
  const fallback = createDefaultRewardState(date);

  if (!state || typeof state !== 'object') {
    return fallback;
  }

  // disabledSinceDate was used by v2.0 and could go stale; the enabled state is
  // now applied at reconcile time instead.
  const { disabledSinceDate, ...rest } = state;

  return {
    ...fallback,
    ...rest,
    progressDays: Math.max(0, Number.isFinite(state.progressDays) ? state.progressDays : 0),
    lastEvaluatedDate: /^\d{4}-\d{2}-\d{2}$/.test(state.lastEvaluatedDate || '') ? state.lastEvaluatedDate : fallback.lastEvaluatedDate,
    dayLog: state.dayLog && typeof state.dayLog === 'object' ? { ...state.dayLog } : fallback.dayLog,
    pauseEvents: Array.isArray(state.pauseEvents) ? state.pauseEvents : [],
    earnedMedals: Array.isArray(state.earnedMedals) ? state.earnedMedals.filter((medal) => medal && typeof medal === 'object') : [],
    timeZone: getLocalTimeZone()
  };
}
