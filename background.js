const DEFAULT_BLOCKED_SITES = [
  "youtube.com",
  "x.com",
  "twitter.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "reddit.com"
];

const DEFAULT_MOTIVATION = "You came here to focus. Take a breath, choose the next useful action, and keep going.";
const REWARD_STORAGE_KEY = "rewardState";
const REWARD_PENALTY_DAYS = 3;
const REWARD_RETENTION_DAYS = 370;
const MEDAL_NAMES_10 = [
  "Neon Spark",
  "Prism Momentum",
  "Comet Cadence",
  "Aurora Focus",
  "Thunder Crown",
  "Quantum Streak"
];
const MEDAL_NAMES_30 = [
  "Chrono Phoenix",
  "Solar Titan",
  "Galaxy Guardian",
  "Diamond Mind"
];
const STORAGE_KEYS = [
  "blockedSites",
  "motivationalText",
  "isEnabled",
  "stats",
  "dailyStats",
  "analyticsMeta",
  REWARD_STORAGE_KEY,
  "pausedUntil"
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(STORAGE_KEYS, (result) => {
    const updates = {};

    if (!Array.isArray(result.blockedSites)) {
      updates.blockedSites = DEFAULT_BLOCKED_SITES;
    }
    if (!result.motivationalText) {
      updates.motivationalText = DEFAULT_MOTIVATION;
    }
    if (result.isEnabled === undefined) {
      updates.isEnabled = true;
    }
    if (!result.stats) {
      updates.stats = { total: 0 };
    }
    if (!result.dailyStats) {
      updates.dailyStats = {};
    }
    if (!result.analyticsMeta) {
      updates.analyticsMeta = {};
    }
    if (!result[REWARD_STORAGE_KEY]) {
      updates[REWARD_STORAGE_KEY] = createDefaultRewardState();
    }
    if (result.pausedUntil === undefined) {
      updates.pausedUntil = null;
    }

    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates);
    }

    chrome.alarms.create("reward-reconcile", { periodInMinutes: 60 });
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("reward-reconcile", { periodInMinutes: 60 });
  reconcileRewards();
});

function normalizeHost(hostname) {
  return hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

function normalizeBlockedSite(site) {
  const value = String(site || "")
    .trim()
    .toLowerCase()
    .replace(/^\*\./, "")
    .replace(/\.$/, "");

  try {
    const urlValue = /^[a-z][a-z0-9+.-]*:\/\//.test(value) ? value : `https://${value}`;
    return normalizeHost(new URL(urlValue).hostname);
  } catch (error) {
    return normalizeHost(value.split("/")[0].split(":")[0]);
  }
}

function isBlockedHost(hostname, blockedSites = []) {
  const host = normalizeHost(hostname);

  return blockedSites.some((site) => {
    const blockedSite = normalizeBlockedSite(site);
    return blockedSite && (host === blockedSite || host.endsWith(`.${blockedSite}`));
  });
}

function isFocusPaused(pausedUntil) {
  return Number.isFinite(pausedUntil) && pausedUntil > Date.now();
}

function getDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getLocalIsoString(date = new Date()) {
  const offsetMinutes = -date.getTimezoneOffset();
  const offsetSign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absoluteOffset / 60)).padStart(2, "0");
  const offsetRemainingMinutes = String(absoluteOffset % 60).padStart(2, "0");
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offsetSign}${offsetHours}:${offsetRemainingMinutes}`;
}

function getLocalTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time";
  } catch (error) {
    return "Local time";
  }
}

function addDays(date, days) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function getDaysBetween(startDateKey, endDateKey) {
  const start = new Date(`${startDateKey}T00:00:00`);
  const end = new Date(`${endDateKey}T00:00:00`);
  const days = [];

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return days;
  }

  for (let date = start; date < end; date = addDays(date, 1)) {
    days.push(getDateKey(date));
  }

  return days;
}

function createDefaultRewardState(date = new Date()) {
  const today = getDateKey(date);

  return {
    progressDays: 0,
    lastEvaluatedDate: today,
    disabledSinceDate: null,
    dayLog: {
      [today]: {
        disabled: false,
        paused: false,
        credited: false
      }
    },
    pauseEvents: [],
    earnedMedals: [],
    createdAt: getLocalIsoString(date),
    timeZone: getLocalTimeZone()
  };
}

function normalizeRewardState(state, date = new Date()) {
  const fallback = createDefaultRewardState(date);

  if (!state || typeof state !== "object") {
    return fallback;
  }

  return {
    ...fallback,
    ...state,
    progressDays: Math.max(0, Number.isFinite(state.progressDays) ? state.progressDays : 0),
    lastEvaluatedDate: state.lastEvaluatedDate || fallback.lastEvaluatedDate,
    disabledSinceDate: state.disabledSinceDate || null,
    dayLog: state.dayLog && typeof state.dayLog === "object" ? state.dayLog : fallback.dayLog,
    pauseEvents: Array.isArray(state.pauseEvents) ? state.pauseEvents : [],
    earnedMedals: Array.isArray(state.earnedMedals) ? state.earnedMedals : [],
    timeZone: getLocalTimeZone()
  };
}

function getMedalName(type, threshold) {
  if (type === "prestige") {
    const index = Math.floor(threshold / 30) - 1;
    return MEDAL_NAMES_30[index % MEDAL_NAMES_30.length];
  }

  const index = Math.floor(threshold / 10) - 1;
  return MEDAL_NAMES_10[index % MEDAL_NAMES_10.length];
}

function createMedal(type, threshold, date = new Date()) {
  return {
    id: `${type}-${threshold}`,
    type,
    threshold,
    name: getMedalName(type, threshold),
    earnedAt: getLocalIsoString(date),
    earnedDate: getDateKey(date),
    timeZone: getLocalTimeZone()
  };
}

function awardEligibleMedals(state, previousProgress, date = new Date()) {
  const earnedIds = new Set(state.earnedMedals.map((medal) => medal.id));
  const newMedals = [];

  for (let threshold = 10; threshold <= state.progressDays; threshold += 10) {
    if (threshold > previousProgress && !earnedIds.has(`focus-${threshold}`)) {
      newMedals.push(createMedal("focus", threshold, date));
    }
  }

  for (let threshold = 30; threshold <= state.progressDays; threshold += 30) {
    if (threshold > previousProgress && !earnedIds.has(`prestige-${threshold}`)) {
      newMedals.push(createMedal("prestige", threshold, date));
    }
  }

  if (newMedals.length === 0) {
    return state;
  }

  return {
    ...state,
    earnedMedals: [...state.earnedMedals, ...newMedals]
  };
}

function pruneRewardState(state, date = new Date()) {
  const cutoffDateKey = getDateKey(addDays(date, -REWARD_RETENTION_DAYS));
  const dayLog = {};

  Object.entries(state.dayLog || {}).forEach(([dateKey, entry]) => {
    if (dateKey >= cutoffDateKey) {
      dayLog[dateKey] = entry;
    }
  });

  return {
    ...state,
    dayLog,
    pauseEvents: (state.pauseEvents || []).slice(-REWARD_RETENTION_DAYS)
  };
}

function reconcileRewardState(rawState, isEnabled, date = new Date()) {
  let state = normalizeRewardState(rawState, date);
  const today = getDateKey(date);
  const datesToEvaluate = getDaysBetween(state.lastEvaluatedDate, today);
  let progressDays = state.progressDays;

  datesToEvaluate.forEach((dateKey) => {
    const dayEntry = {
      disabled: false,
      paused: false,
      credited: false,
      ...(state.dayLog[dateKey] || {})
    };

    if (state.disabledSinceDate && dateKey >= state.disabledSinceDate) {
      dayEntry.disabled = true;
    }

    if (!dayEntry.disabled && !dayEntry.paused && !dayEntry.credited) {
      progressDays += 1;
      dayEntry.credited = true;
    }

    state.dayLog[dateKey] = dayEntry;
  });

  const todayEntry = {
    disabled: false,
    paused: false,
    credited: false,
    ...(state.dayLog[today] || {})
  };

  if (isEnabled === false) {
    todayEntry.disabled = true;
    state.disabledSinceDate = state.disabledSinceDate || today;
  } else {
    state.disabledSinceDate = null;
  }

  state.dayLog[today] = todayEntry;
  state.progressDays = progressDays;
  state.lastEvaluatedDate = today;
  state.timeZone = getLocalTimeZone();
  state = awardEligibleMedals(state, rawState && Number.isFinite(rawState.progressDays) ? rawState.progressDays : 0, date);
  return pruneRewardState(state, date);
}

function applyPausePenalty(rawState, minutes, date = new Date()) {
  let state = reconcileRewardState(rawState, true, date);
  const today = getDateKey(date);
  const previousProgress = state.progressDays;
  const todayEntry = {
    disabled: false,
    paused: false,
    credited: false,
    ...(state.dayLog[today] || {})
  };

  todayEntry.paused = true;
  state.dayLog[today] = todayEntry;
  state.progressDays = Math.max(0, state.progressDays - REWARD_PENALTY_DAYS);
  state.pauseEvents = [
    ...(state.pauseEvents || []),
    {
      at: getLocalIsoString(date),
      date: today,
      minutes,
      penaltyDays: REWARD_PENALTY_DAYS,
      progressBefore: previousProgress,
      progressAfter: state.progressDays,
      timeZone: getLocalTimeZone()
    }
  ];

  return pruneRewardState(state, date);
}

function markTodayDisabled(rawState, date = new Date()) {
  let state = reconcileRewardState(rawState, false, date);
  const today = getDateKey(date);

  state.dayLog[today] = {
    paused: false,
    credited: false,
    ...(state.dayLog[today] || {}),
    disabled: true
  };
  state.disabledSinceDate = state.disabledSinceDate || today;
  return pruneRewardState(state, date);
}

function updateDailyStats(dailyStats = {}, hostname, date = new Date()) {
  const dateKey = getDateKey(date);
  const dayStats = dailyStats[dateKey] || { total: 0, sites: {} };
  const sites = dayStats.sites || {};

  return {
    ...dailyStats,
    [dateKey]: {
      total: (dayStats.total || 0) + 1,
      sites: {
        ...sites,
        [hostname]: (sites[hostname] || 0) + 1
      },
      updatedAt: getLocalIsoString(date),
      timeZone: getLocalTimeZone()
    }
  };
}

function reconcileRewards() {
  chrome.storage.local.get([REWARD_STORAGE_KEY, "isEnabled"], (data) => {
    const rewardState = reconcileRewardState(data[REWARD_STORAGE_KEY], data.isEnabled !== false);
    chrome.storage.local.set({ [REWARD_STORAGE_KEY]: rewardState });
  });
}

function applyRewardPause(minutes, callback) {
  const pauseMinutes = Number.isFinite(minutes) ? minutes : 5;

  chrome.storage.local.get([REWARD_STORAGE_KEY], (data) => {
    const rewardState = applyPausePenalty(data[REWARD_STORAGE_KEY], pauseMinutes);
    chrome.storage.local.set({ [REWARD_STORAGE_KEY]: rewardState }, () => callback(rewardState));
  });
}

function markFocusDisabled(callback) {
  chrome.storage.local.get([REWARD_STORAGE_KEY], (data) => {
    const rewardState = markTodayDisabled(data[REWARD_STORAGE_KEY]);
    chrome.storage.local.set({ [REWARD_STORAGE_KEY]: rewardState }, () => callback(rewardState));
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "reward-reconcile") {
    reconcileRewards();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === "APPLY_PAUSE_REWARD_PENALTY") {
    applyRewardPause(Number(message.minutes), (rewardState) => {
      sendResponse({ ok: true, rewardState });
    });
    return true;
  }

  if (message.type === "MARK_FOCUS_DISABLED") {
    markFocusDisabled((rewardState) => {
      sendResponse({ ok: true, rewardState });
    });
    return true;
  }

  if (message.type === "RECONCILE_REWARDS") {
    chrome.storage.local.get([REWARD_STORAGE_KEY, "isEnabled"], (data) => {
      const rewardState = reconcileRewardState(data[REWARD_STORAGE_KEY], data.isEnabled !== false);
      chrome.storage.local.set({ [REWARD_STORAGE_KEY]: rewardState }, () => {
        sendResponse({ ok: true, rewardState });
      });
    });
    return true;
  }

  return false;
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;

  if (details.url.startsWith(chrome.runtime.getURL(""))) return;

  try {
    const url = new URL(details.url);
    if (!["http:", "https:"].includes(url.protocol)) return;

    const hostname = url.hostname;

    chrome.storage.local.get(["blockedSites", "isEnabled", "stats", "dailyStats", "pausedUntil"], (data) => {
      if (data.isEnabled === false || !Array.isArray(data.blockedSites)) return;

      if (isFocusPaused(data.pausedUntil)) return;

      if (data.pausedUntil && data.pausedUntil <= Date.now()) {
        chrome.storage.local.set({ pausedUntil: null });
      }

      if (isBlockedHost(hostname, data.blockedSites)) {
        const newStats = data.stats || { total: 0 };
        newStats.total = (newStats.total || 0) + 1;

        const normalizedHost = normalizeHost(hostname);
        newStats[normalizedHost] = (newStats[normalizedHost] || 0) + 1;

        const now = new Date();
        const newDailyStats = updateDailyStats(data.dailyStats || {}, normalizedHost, now);
        const analyticsMeta = {
          lastUpdatedAt: getLocalIsoString(now),
          lastUpdatedDate: getDateKey(now),
          timeZone: getLocalTimeZone()
        };

        chrome.storage.local.set({ stats: newStats, dailyStats: newDailyStats, analyticsMeta });

        const blockedUrl = chrome.runtime.getURL("blocked.html");
        chrome.tabs.update(details.tabId, {
          url: `${blockedUrl}?target=${encodeURIComponent(normalizedHost)}`
        });
      }
    });
  } catch (e) {
    console.error("Invalid URL:", details.url);
  }
});
