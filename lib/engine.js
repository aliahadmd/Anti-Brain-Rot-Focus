// Pure state transitions for rewards and analytics. Depends on lib/shared.js.
//
// Reward rules:
// - A day is credited once it has passed, if the extension ran that day (it has
//   a dayLog entry), Focus stayed enabled, at least one site was blocked, and
//   nothing loosened protection (pause, disable, removing a site).
// - Pausing, disabling, or removing a site costs REWARD_PENALTY_DAYS each.
// - Earned medals are never taken away.
//
// Every state change goes through the background service worker, which
// reconciles before applying it, so the context passed to reconcile has held
// since lastEvaluatedDate.

const PENALTY_FLAGS = {
  pause: 'paused',
  disable: 'disabled',
  'remove-site': 'siteRemoved'
};
const MAX_PENALTY_EVENTS = 500;

function getDaysBetween(startDateKey, endDateKey) {
  const start = parseDateKeyLocal(startDateKey);
  const end = parseDateKeyLocal(endDateKey);
  const days = [];

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return days;
  }

  for (let date = start; date < end; date = addDays(date, 1)) {
    days.push(getDateKey(date));
  }

  return days;
}

function isDayEligible(entry) {
  return !entry.disabled && !entry.paused && !entry.siteRemoved && !entry.unprotected;
}

function applyContextFlags(entry, context) {
  const nextEntry = createDayEntry(entry);

  if (context.isEnabled === false) nextEntry.disabled = true;
  if (context.hasBlockedSites === false) nextEntry.unprotected = true;
  return nextEntry;
}

function awardEligibleMedals(state, previousProgress, date = new Date()) {
  const earnedIds = new Set(state.earnedMedals.map((medal) => medal.id));
  const newMedals = [];
  const createMedal = (type, threshold) => ({
    id: `${type}-${threshold}`,
    type,
    threshold,
    name: getMedalName(type, threshold),
    earnedAt: getLocalIsoString(date),
    earnedDate: getDateKey(date),
    timeZone: getLocalTimeZone()
  });

  for (let threshold = FOCUS_MEDAL_INTERVAL; threshold <= state.progressDays; threshold += FOCUS_MEDAL_INTERVAL) {
    if (threshold > previousProgress && !earnedIds.has(`focus-${threshold}`)) {
      newMedals.push(createMedal('focus', threshold));
    }
  }

  for (let threshold = PRESTIGE_MEDAL_INTERVAL; threshold <= state.progressDays; threshold += PRESTIGE_MEDAL_INTERVAL) {
    if (threshold > previousProgress && !earnedIds.has(`prestige-${threshold}`)) {
      newMedals.push(createMedal('prestige', threshold));
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
    pauseEvents: (state.pauseEvents || [])
      .filter((event) => !event.date || event.date >= cutoffDateKey)
      .slice(-MAX_PENALTY_EVENTS)
  };
}

// context: { isEnabled: boolean, hasBlockedSites: boolean }
function reconcileRewardState(rawState, context, date = new Date()) {
  const state = normalizeRewardState(rawState, date);
  const today = getDateKey(date);
  const previousProgress = state.progressDays;

  // System clock moved backwards: record today's flags but never re-credit.
  if (today < state.lastEvaluatedDate) {
    state.dayLog[today] = applyContextFlags(state.dayLog[today], context);
    return pruneRewardState(state, date);
  }

  // The current context has held since the last reconcile, including the rest
  // of that day.
  if (state.dayLog[state.lastEvaluatedDate]) {
    state.dayLog[state.lastEvaluatedDate] = applyContextFlags(state.dayLog[state.lastEvaluatedDate], context);
  }

  getDaysBetween(state.lastEvaluatedDate, today).forEach((dateKey) => {
    const entry = state.dayLog[dateKey];

    // No entry means the extension never ran that day (browser closed, or
    // the clock was moved forward), so there is nothing to credit.
    if (!entry) return;

    const nextEntry = createDayEntry(entry);
    if (isDayEligible(nextEntry) && !nextEntry.credited) {
      state.progressDays += 1;
      nextEntry.credited = true;
    }
    state.dayLog[dateKey] = nextEntry;
  });

  state.dayLog[today] = applyContextFlags(state.dayLog[today], context);
  state.lastEvaluatedDate = today;

  return pruneRewardState(awardEligibleMedals(state, previousProgress, date), date);
}

// Applies a penalty to an already reconciled state.
// penalty: { reason: 'pause' | 'disable' | 'remove-site', minutes?, site? }
function applyRewardPenalty(state, penalty, date = new Date()) {
  const today = getDateKey(date);
  const flag = PENALTY_FLAGS[penalty.reason];
  const progressBefore = state.progressDays;
  const todayEntry = createDayEntry(state.dayLog[today]);
  const event = {
    at: getLocalIsoString(date),
    date: today,
    reason: penalty.reason,
    penaltyDays: REWARD_PENALTY_DAYS,
    progressBefore,
    progressAfter: Math.max(0, progressBefore - REWARD_PENALTY_DAYS),
    timeZone: getLocalTimeZone()
  };

  if (flag) todayEntry[flag] = true;
  if (Number.isFinite(penalty.minutes)) event.minutes = penalty.minutes;
  if (penalty.site) event.site = penalty.site;

  return pruneRewardState({
    ...state,
    progressDays: event.progressAfter,
    dayLog: { ...state.dayLog, [today]: todayEntry },
    pauseEvents: [...(state.pauseEvents || []), event]
  }, date);
}

function pruneDailyStats(dailyStats = {}, date = new Date()) {
  const cutoffDateKey = getDateKey(addDays(date, -DAILY_STATS_RETENTION_DAYS));

  return Object.fromEntries(
    Object.entries(dailyStats).filter(([dateKey]) => dateKey >= cutoffDateKey)
  );
}

// Records one redirected visit against the blocked site that matched.
function recordBlockedVisit(stats, dailyStats, site, date = new Date()) {
  const dateKey = getDateKey(date);
  const nextStats = { total: 0, ...(stats || {}) };
  const days = dailyStats && typeof dailyStats === 'object' ? dailyStats : {};
  const dayStats = days[dateKey] || { total: 0, sites: {} };
  const sites = dayStats.sites || {};

  nextStats.total = (nextStats.total || 0) + 1;
  nextStats[site] = (nextStats[site] || 0) + 1;

  return {
    stats: nextStats,
    dailyStats: pruneDailyStats({
      ...days,
      [dateKey]: {
        total: (dayStats.total || 0) + 1,
        sites: {
          ...sites,
          [site]: (sites[site] || 0) + 1
        },
        updatedAt: getLocalIsoString(date),
        timeZone: getLocalTimeZone()
      }
    }, date),
    analyticsMeta: {
      lastUpdatedAt: getLocalIsoString(date),
      lastUpdatedDate: dateKey,
      timeZone: getLocalTimeZone()
    }
  };
}
