const STORAGE_KEYS = [
  'stats',
  'dailyStats',
  'analyticsMeta',
  'rewardState',
  'motivationalText',
  'blockedSites',
  'isEnabled',
  'pausedUntil'
];
const DEFAULT_MOTIVATION = 'You came here to focus. Take a breath, choose the next useful action, and keep going.';
const PAUSE_WARNING = 'Pausing costs 3 reward days. Keep protecting your streak?';
const DISABLE_WARNING = 'Disabling Focus makes today ineligible for rewards. Disable Focus anyway?';
const DELETE_QUOTES = [
  'The easiest click is not always the kindest one to your future self.',
  'You blocked this for a reason. Is that reason still true?',
  'Last check: protect your attention like it matters, because it does.'
];
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

function getDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function getLocalDayStart(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseDateKeyLocal(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
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

function formatLocalDateTime(date = new Date()) {
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

function getRecentDateKeys(days, now = new Date()) {
  const today = getLocalDayStart(now);

  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setDate(date.getDate() - (days - index - 1));
    return getDateKey(date);
  });
}

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

function getSiteCount(stats = {}, site) {
  return Number.isFinite(stats[site]) ? stats[site] : 0;
}

function getSortedSites(sites = [], stats = {}, searchTerm = '', sortMode = 'nameAsc') {
  const query = searchTerm.trim().toLowerCase();
  const filtered = sites.filter((site) => site.toLowerCase().includes(query));

  return filtered.sort((a, b) => {
    if (sortMode === 'nameDesc') return b.localeCompare(a);
    if (sortMode === 'mostBlocked') return getSiteCount(stats, b) - getSiteCount(stats, a) || a.localeCompare(b);
    if (sortMode === 'leastBlocked') return getSiteCount(stats, a) - getSiteCount(stats, b) || a.localeCompare(b);
    return a.localeCompare(b);
  });
}

function getTopSites(stats = {}, limit = 5) {
  return Object.entries(stats)
    .filter(([key, value]) => key !== 'total' && Number.isFinite(value))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function getDailyTotal(dailyStats = {}, dateKey = getDateKey()) {
  const dayStats = dailyStats[dateKey];
  return dayStats && Number.isFinite(dayStats.total) ? dayStats.total : 0;
}

function getDailySiteSum(dayStats = {}) {
  return Object.values(dayStats.sites || {}).reduce((sum, value) => {
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
}

function normalizeDailyStats(dailyStats = {}) {
  return Object.entries(dailyStats).reduce((normalized, [dateKey, dayStats]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !dayStats || typeof dayStats !== 'object') {
      return normalized;
    }

    const siteSum = getDailySiteSum(dayStats);
    const total = Number.isFinite(dayStats.total) ? Math.max(dayStats.total, siteSum) : siteSum;

    normalized[dateKey] = {
      ...dayStats,
      total,
      sites: dayStats.sites || {}
    };
    return normalized;
  }, {});
}

function sumRecentDays(dailyStats = {}, days = 7, now = new Date()) {
  return getRecentDateKeys(days, now).reduce((sum, dateKey) => sum + getDailyTotal(dailyStats, dateKey), 0);
}

function sumDailyStats(dailyStats = {}) {
  return Object.values(dailyStats).reduce((sum, dayStats) => {
    return sum + (Number.isFinite(dayStats.total) ? dayStats.total : 0);
  }, 0);
}

function getLegacyUntrackedTotal(stats = {}, dailyStats = {}) {
  return Math.max(0, (stats.total || 0) - sumDailyStats(dailyStats));
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

  if (!state || typeof state !== 'object') {
    return fallback;
  }

  return {
    ...fallback,
    ...state,
    progressDays: Math.max(0, Number.isFinite(state.progressDays) ? state.progressDays : 0),
    lastEvaluatedDate: state.lastEvaluatedDate || fallback.lastEvaluatedDate,
    disabledSinceDate: state.disabledSinceDate || null,
    dayLog: state.dayLog && typeof state.dayLog === 'object' ? state.dayLog : fallback.dayLog,
    pauseEvents: Array.isArray(state.pauseEvents) ? state.pauseEvents : [],
    earnedMedals: Array.isArray(state.earnedMedals) ? state.earnedMedals : [],
    timeZone: getLocalTimeZone()
  };
}

function getMedalName(type, threshold) {
  if (type === 'prestige') {
    const index = Math.floor(threshold / 30) - 1;
    return MEDAL_NAMES_30[index % MEDAL_NAMES_30.length];
  }

  const index = Math.floor(threshold / 10) - 1;
  return MEDAL_NAMES_10[index % MEDAL_NAMES_10.length];
}

function getMedalGlyph(type, threshold) {
  if (type === 'prestige') {
    const index = Math.floor(threshold / 30) - 1;
    return MEDAL_GLYPHS_30[index % MEDAL_GLYPHS_30.length];
  }

  const index = Math.floor(threshold / 10) - 1;
  return MEDAL_GLYPHS_10[index % MEDAL_GLYPHS_10.length];
}

function getNextReward(progressDays, interval) {
  const threshold = Math.floor(progressDays / interval) * interval + interval;
  const current = progressDays % interval;

  return {
    threshold,
    current,
    remaining: threshold - progressDays
  };
}

function mergeImportedBlocklist(existingSites = [], importedPayload) {
  const importedSites = importedPayload && Array.isArray(importedPayload.blockedSites)
    ? importedPayload.blockedSites
    : [];
  const existingSet = new Set(existingSites);
  const mergedSet = new Set(existingSites);
  const invalid = [];
  const duplicates = [];
  const added = [];

  importedSites.forEach((rawSite) => {
    const result = normalizeSiteInput(rawSite);

    if (result.error) {
      invalid.push(String(rawSite));
      return;
    }

    if (existingSet.has(result.site) || added.includes(result.site)) {
      duplicates.push(result.site);
      return;
    }

    added.push(result.site);
    mergedSet.add(result.site);
  });

  return {
    sites: [...mergedSet].sort(),
    added,
    duplicates,
    invalid
  };
}

function getNextDeleteStep(currentStep, totalSteps = DELETE_QUOTES.length) {
  if (currentStep >= totalSteps - 1) {
    return { nextStep: currentStep, shouldDelete: true };
  }

  return { nextStep: currentStep + 1, shouldDelete: false };
}

document.addEventListener('DOMContentLoaded', () => {
  const pageTitle = document.getElementById('pageTitle');
  const navButtons = [...document.querySelectorAll('.nav-btn')];
  const panels = [...document.querySelectorAll('.dashboard-panel')];
  const totalCountEl = document.getElementById('totalCount');
  const todayCountEl = document.getElementById('todayCount');
  const analyticsTodayCountEl = document.getElementById('analyticsTodayCount');
  const analyticsAllTimeCountEl = document.getElementById('analyticsAllTimeCount');
  const weekCountEl = document.getElementById('weekCount');
  const analyticsTimeStatus = document.getElementById('analyticsTimeStatus');
  const overviewRewardDays = document.getElementById('overviewRewardDays');
  const overviewRewardNext = document.getElementById('overviewRewardNext');
  const rewardProgressDays = document.getElementById('rewardProgressDays');
  const earnedMedalCount = document.getElementById('earnedMedalCount');
  const nextPrestigeDays = document.getElementById('nextPrestigeDays');
  const nextPrestigeName = document.getElementById('nextPrestigeName');
  const nextMedalTitle = document.getElementById('nextMedalTitle');
  const nextMedalCopy = document.getElementById('nextMedalCopy');
  const nextMedalIcon = document.getElementById('nextMedalIcon');
  const nextMedalType = document.getElementById('nextMedalType');
  const tenDayTrackName = document.getElementById('tenDayTrackName');
  const tenDayTrackLabel = document.getElementById('tenDayTrackLabel');
  const tenDayTrackFill = document.getElementById('tenDayTrackFill');
  const thirtyDayTrackName = document.getElementById('thirtyDayTrackName');
  const thirtyDayTrackLabel = document.getElementById('thirtyDayTrackLabel');
  const thirtyDayTrackFill = document.getElementById('thirtyDayTrackFill');
  const pausePenaltyList = document.getElementById('pausePenaltyList');
  const earnedMedalsGrid = document.getElementById('earnedMedalsGrid');
  const blockedCountEl = document.getElementById('blockedCount');
  const topDistractionsEl = document.getElementById('topDistractions');
  const dailyChartEl = document.getElementById('dailyChart');
  const topSiteBarsEl = document.getElementById('topSiteBars');
  const motivationTextEl = document.getElementById('motivationText');
  const saveTextBtn = document.getElementById('saveTextBtn');
  const saveStatus = document.getElementById('saveStatus');
  const newSiteInput = document.getElementById('newSite');
  const addSiteBtn = document.getElementById('addSiteBtn');
  const siteFeedback = document.getElementById('siteFeedback');
  const siteListEl = document.getElementById('siteList');
  const siteSearchEl = document.getElementById('siteSearch');
  const siteSortEl = document.getElementById('siteSort');
  const enabledToggle = document.getElementById('enabledToggle');
  const focusState = document.getElementById('focusState');
  const pauseStatus = document.getElementById('pauseStatus');
  const resumeFocusBtn = document.getElementById('resumeFocusBtn');
  const resetStatsBtn = document.getElementById('resetStatsBtn');
  const settingsResetStatsBtn = document.getElementById('settingsResetStatsBtn');
  const exportBtn = document.getElementById('exportBtn');
  const settingsExportBtn = document.getElementById('settingsExportBtn');
  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile');
  const presetButtons = [...document.querySelectorAll('.preset-btn')];
  const deleteDialog = document.getElementById('deleteDialog');
  const deleteTitle = document.getElementById('deleteTitle');
  const deleteQuote = document.getElementById('deleteQuote');
  const deleteQuestion = document.getElementById('deleteQuestion');
  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
  const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
  const sectionTitles = {
    overview: 'Overview',
    analytics: 'Analytics',
    rewards: 'Rewards',
    sites: 'Blocked Sites',
    settings: 'Settings'
  };

  let currentData = {
    stats: { total: 0 },
    dailyStats: {},
    analyticsMeta: {},
    rewardState: createDefaultRewardState(),
    blockedSites: [],
    isEnabled: true,
    pausedUntil: null
  };
  let pendingDeleteSite = null;
  let deleteStep = 0;

  function showMessage(element, message, isError = false) {
    element.textContent = message;
    element.classList.toggle('error', isError);

    if (message) {
      setTimeout(() => {
        if (element.textContent === message) {
          element.textContent = '';
          element.classList.remove('error');
        }
      }, 3600);
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

  function showSection(sectionName) {
    navButtons.forEach((button) => {
      button.classList.toggle('active', button.dataset.section === sectionName);
    });
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.panel !== sectionName;
    });
    pageTitle.textContent = sectionTitles[sectionName] || 'Dashboard';
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

    const sorted = getTopSites(stats, 5);

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

  function renderDailyChart(dailyStats = {}, now = new Date()) {
    dailyChartEl.textContent = '';

    const days = getRecentDateKeys(14, now).map((dateKey) => ({
      dateKey,
      total: getDailyTotal(dailyStats, dateKey)
    }));
    const maxTotal = Math.max(1, ...days.map((day) => day.total));

    days.forEach((day) => {
      const wrapper = document.createElement('div');
      const value = document.createElement('span');
      const track = document.createElement('div');
      const fill = document.createElement('div');
      const label = document.createElement('span');
      const date = parseDateKeyLocal(day.dateKey);

      wrapper.className = 'day-bar';
      value.className = 'bar-value';
      value.textContent = day.total;
      track.className = 'bar-track';
      fill.className = 'bar-fill';
      fill.style.height = day.total ? `${Math.max(8, (day.total / maxTotal) * 100)}%` : '0';
      label.className = 'bar-label';
      label.textContent = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

      track.title = `${day.dateKey}: ${day.total} redirects`;
      track.appendChild(fill);
      wrapper.append(value, track, label);
      dailyChartEl.appendChild(wrapper);
    });
  }

  function renderTopSiteBars(stats = {}) {
    topSiteBarsEl.textContent = '';

    const topSites = getTopSites(stats, 8);
    const maxCount = Math.max(1, ...topSites.map(([, count]) => count));

    if (topSites.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No site data yet.';
      topSiteBarsEl.appendChild(empty);
      return;
    }

    topSites.forEach(([site, count]) => {
      const row = document.createElement('div');
      const name = document.createElement('span');
      const track = document.createElement('div');
      const fill = document.createElement('div');
      const countEl = document.createElement('span');

      row.className = 'site-bar-row';
      name.className = 'site-bar-name';
      name.textContent = site;
      track.className = 'site-bar-track';
      fill.className = 'site-bar-fill';
      fill.style.width = `${Math.max(6, (count / maxCount) * 100)}%`;
      countEl.className = 'site-count';
      countEl.textContent = count;

      track.appendChild(fill);
      row.append(name, track, countEl);
      topSiteBarsEl.appendChild(row);
    });
  }

  function renderSiteList(sites = [], stats = {}) {
    siteListEl.textContent = '';
    blockedCountEl.textContent = sites.length;

    const visibleSites = getSortedSites(sites, stats, siteSearchEl.value, siteSortEl.value);

    if (sites.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No blocked sites yet.';
      siteListEl.appendChild(li);
      return;
    }

    if (visibleSites.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No sites match your search.';
      siteListEl.appendChild(li);
      return;
    }

    visibleSites.forEach((site) => {
      const li = document.createElement('li');
      const meta = document.createElement('span');
      const siteName = document.createElement('span');
      const count = document.createElement('span');
      const btn = document.createElement('button');

      meta.className = 'site-meta';
      siteName.className = 'site-name';
      siteName.textContent = site;
      count.className = 'site-count';
      count.textContent = `${getSiteCount(stats, site)} saves`;

      btn.textContent = 'Remove';
      btn.type = 'button';
      btn.className = 'remove-btn';
      btn.addEventListener('click', () => openDeleteDialog(site));

      meta.append(siteName, count);
      li.append(meta, btn);
      siteListEl.appendChild(li);
    });
  }

  function createMedalCard(medal, locked = false) {
    const card = document.createElement('article');
    const icon = document.createElement('div');
    const title = document.createElement('strong');
    const meta = document.createElement('span');

    card.className = `medal-card ${medal.type === 'prestige' ? 'prestige' : 'focus'} ${locked ? 'locked' : ''}`.trim();
    icon.className = 'medal-icon';
    icon.textContent = locked ? '🔒' : getMedalGlyph(medal.type, medal.threshold);
    title.textContent = medal.name;
    meta.textContent = locked
      ? `${medal.threshold}-day ${medal.type === 'prestige' ? 'prestige' : 'medal'}`
      : `${medal.threshold} days • ${medal.earnedDate || 'earned'}`;

    card.append(icon, title, meta);
    return card;
  }

  function renderPenaltyList(pauseEvents = []) {
    pausePenaltyList.textContent = '';

    if (pauseEvents.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No pause penalties yet.';
      pausePenaltyList.appendChild(li);
      return;
    }

    [...pauseEvents].slice(-5).reverse().forEach((event) => {
      const li = document.createElement('li');
      const date = document.createElement('strong');
      const detail = document.createElement('span');

      date.textContent = event.date || 'Local day';
      detail.textContent = `-${event.penaltyDays || 3} days after ${event.minutes || 0}m pause`;
      li.append(date, detail);
      pausePenaltyList.appendChild(li);
    });
  }

  function renderEarnedMedals(medals = [], progressDays = 0) {
    earnedMedalsGrid.textContent = '';

    if (medals.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No medals yet. Your first glow-up is waiting at 10 focus days.';
      earnedMedalsGrid.appendChild(empty);
    } else {
      [...medals]
        .sort((a, b) => a.threshold - b.threshold || a.type.localeCompare(b.type))
        .forEach((medal) => earnedMedalsGrid.appendChild(createMedalCard(medal)));
    }

    const nextTen = getNextReward(progressDays, 10);
    earnedMedalsGrid.appendChild(createMedalCard({
      type: 'focus',
      threshold: nextTen.threshold,
      name: getMedalName('focus', nextTen.threshold)
    }, true));
  }

  function renderRewards(rawRewardState) {
    const rewardState = normalizeRewardState(rawRewardState);
    const progressDays = rewardState.progressDays;
    const nextTen = getNextReward(progressDays, 10);
    const nextThirty = getNextReward(progressDays, 30);
    const nextTenName = getMedalName('focus', nextTen.threshold);
    const nextThirtyName = getMedalName('prestige', nextThirty.threshold);
    const tenPercent = Math.max(0, Math.min(100, (nextTen.current / 10) * 100));
    const thirtyPercent = Math.max(0, Math.min(100, (nextThirty.current / 30) * 100));

    overviewRewardDays.textContent = progressDays;
    overviewRewardNext.textContent = `${nextTen.remaining} days to ${nextTenName}`;
    rewardProgressDays.textContent = progressDays;
    earnedMedalCount.textContent = rewardState.earnedMedals.length;
    nextPrestigeDays.textContent = nextThirty.remaining;
    nextPrestigeName.textContent = `days to ${nextThirtyName}`;
    nextMedalTitle.textContent = `${nextTenName} awaits`;
    nextMedalCopy.textContent = `${nextTen.remaining} more focus days unlocks your next 10-day medal. ${nextThirty.remaining} days to the next prestige award.`;
    nextMedalIcon.textContent = getMedalGlyph('focus', nextTen.threshold);
    nextMedalType.textContent = `${nextTen.threshold}-day medal`;
    tenDayTrackName.textContent = nextTenName;
    tenDayTrackLabel.textContent = `${nextTen.current} / 10`;
    tenDayTrackFill.style.width = `${tenPercent}%`;
    thirtyDayTrackName.textContent = nextThirtyName;
    thirtyDayTrackLabel.textContent = `${nextThirty.current} / 30`;
    thirtyDayTrackFill.style.width = `${thirtyPercent}%`;

    renderPenaltyList(rewardState.pauseEvents);
    renderEarnedMedals(rewardState.earnedMedals, progressDays);
  }

  function renderDashboard(data) {
    const now = new Date();
    const stats = data.stats || { total: 0 };
    const dailyStats = normalizeDailyStats(data.dailyStats || {});
    const blockedSites = Array.isArray(data.blockedSites) ? data.blockedSites : [];
    const todayTotal = getDailyTotal(dailyStats, getDateKey(now));
    const weekTotal = sumRecentDays(dailyStats, 7, now);
    const legacyUntrackedTotal = getLegacyUntrackedTotal(stats, dailyStats);
    const timeZone = (data.analyticsMeta && data.analyticsMeta.timeZone) || getLocalTimeZone();
    const lastUpdated = data.analyticsMeta && data.analyticsMeta.lastUpdatedAt
      ? data.analyticsMeta.lastUpdatedAt
      : getLocalIsoString(now);

    totalCountEl.textContent = stats.total || 0;
    todayCountEl.textContent = todayTotal;
    analyticsTodayCountEl.textContent = todayTotal;
    analyticsAllTimeCountEl.textContent = stats.total || 0;
    weekCountEl.textContent = weekTotal;
    analyticsTimeStatus.textContent = `Using local computer time (${timeZone}). Last refreshed ${formatLocalDateTime(now)}. ${legacyUntrackedTotal ? `${legacyUntrackedTotal} older saves predate daily analytics and are included only in all-time totals.` : `Last saved redirect ${lastUpdated}.`}`;
    motivationTextEl.value = data.motivationalText || DEFAULT_MOTIVATION;

    renderFocusState(data);
    renderTopDistractions(stats);
    renderDailyChart(dailyStats, now);
    renderTopSiteBars(stats);
    renderSiteList(blockedSites, stats);
    renderRewards(data.rewardState);
  }

  function loadData() {
    chrome.storage.local.get(STORAGE_KEYS, (data) => {
      currentData = {
        ...currentData,
        ...data,
        stats: data.stats || { total: 0 },
        dailyStats: normalizeDailyStats(data.dailyStats || {}),
        analyticsMeta: data.analyticsMeta || {},
        rewardState: normalizeRewardState(data.rewardState),
        blockedSites: Array.isArray(data.blockedSites) ? data.blockedSites : []
      };

      if (currentData.pausedUntil && currentData.pausedUntil <= Date.now()) {
        chrome.storage.local.set({ pausedUntil: null });
        currentData.pausedUntil = null;
      }

      renderDashboard(currentData);
    });
  }

  function saveBlockedSites(sites, callback = loadData) {
    const uniqueSites = [...new Set(sites)].sort();
    chrome.storage.local.set({ blockedSites: uniqueSites }, callback);
  }

  function requestRewardReconcile(callback = loadData) {
    if (!chrome.runtime.sendMessage) {
      callback();
      return;
    }

    chrome.runtime.sendMessage({ type: 'RECONCILE_REWARDS' }, () => {
      callback();
    });
  }

  function markFocusDisabled(callback) {
    if (!chrome.runtime.sendMessage) {
      callback();
      return;
    }

    chrome.runtime.sendMessage({ type: 'MARK_FOCUS_DISABLED' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.ok) {
        window.alert('Focus was not disabled because the reward state could not be updated.');
        loadData();
        return;
      }

      callback();
    });
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

  function removeSiteConfirmed(siteToRemove) {
    chrome.storage.local.get(['blockedSites'], (data) => {
      const sites = Array.isArray(data.blockedSites) ? data.blockedSites : [];
      saveBlockedSites(sites.filter((site) => site !== siteToRemove), () => {
        showMessage(siteFeedback, `${siteToRemove} removed.`);
        loadData();
      });
    });
  }

  function openDeleteDialog(site) {
    pendingDeleteSite = site;
    deleteStep = 0;
    renderDeleteDialog();
    deleteDialog.hidden = false;
    cancelDeleteBtn.focus();
  }

  function closeDeleteDialog() {
    deleteDialog.hidden = true;
    pendingDeleteSite = null;
    deleteStep = 0;
  }

  function renderDeleteDialog() {
    const stepLabel = `${deleteStep + 1}/3`;

    deleteTitle.textContent = `Remove ${pendingDeleteSite}?`;
    deleteQuote.textContent = DELETE_QUOTES[deleteStep];
    deleteQuestion.textContent = `Confirmation ${stepLabel}: do you still want this site removed from your blocklist?`;
    confirmDeleteBtn.textContent = deleteStep === DELETE_QUOTES.length - 1 ? 'Yes, remove it' : 'Yes, ask again';
  }

  function confirmDeleteStep() {
    if (!pendingDeleteSite) return;

    const nextState = getNextDeleteStep(deleteStep);

    if (!nextState.shouldDelete) {
      deleteStep = nextState.nextStep;
      renderDeleteDialog();
      return;
    }

    const siteToRemove = pendingDeleteSite;
    closeDeleteDialog();
    removeSiteConfirmed(siteToRemove);
  }

  function resetStats() {
    if (!window.confirm('Reset all focus statistics, including analytics history?')) return;
    chrome.storage.local.set({ stats: { total: 0 }, dailyStats: {}, analyticsMeta: {} }, loadData);
  }

  function exportBlocklist() {
    const payload = {
      version: 1,
      exportedAt: getLocalIsoString(),
      timeZone: getLocalTimeZone(),
      blockedSites: currentData.blockedSites || []
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = `focus-blocklist-${getDateKey()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function importBlocklist(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.addEventListener('load', () => {
      try {
        const payload = JSON.parse(reader.result);
        const result = mergeImportedBlocklist(currentData.blockedSites, payload);

        if (!Array.isArray(payload.blockedSites)) {
          showMessage(siteFeedback, 'Import file must include a blockedSites array.', true);
          return;
        }

        saveBlockedSites(result.sites, () => {
          showMessage(
            siteFeedback,
            `Imported ${result.added.length}; skipped ${result.duplicates.length} duplicate and ${result.invalid.length} invalid.`
          );
          loadData();
        });
      } catch (error) {
        showMessage(siteFeedback, 'Could not read that JSON blocklist.', true);
      } finally {
        importFile.value = '';
      }
    });
    reader.readAsText(file);
  }

  navButtons.forEach((button) => {
    button.addEventListener('click', () => showSection(button.dataset.section));
  });

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

  siteSearchEl.addEventListener('input', () => renderSiteList(currentData.blockedSites, currentData.stats));
  siteSortEl.addEventListener('change', () => renderSiteList(currentData.blockedSites, currentData.stats));

  enabledToggle.addEventListener('change', () => {
    const nextEnabledState = enabledToggle.checked;

    if (!nextEnabledState && !window.confirm(DISABLE_WARNING)) {
      enabledToggle.checked = true;
      return;
    }

    const saveEnabledState = () => chrome.storage.local.set({
      isEnabled: nextEnabledState,
      pausedUntil: null
    }, loadData);

    if (nextEnabledState) {
      saveEnabledState();
    } else {
      markFocusDisabled(saveEnabledState);
    }
  });

  resumeFocusBtn.addEventListener('click', () => {
    chrome.storage.local.set({ isEnabled: true, pausedUntil: null }, loadData);
  });

  resetStatsBtn.addEventListener('click', resetStats);
  settingsResetStatsBtn.addEventListener('click', resetStats);
  exportBtn.addEventListener('click', exportBlocklist);
  settingsExportBtn.addEventListener('click', exportBlocklist);
  importBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', () => importBlocklist(importFile.files[0]));
  cancelDeleteBtn.addEventListener('click', closeDeleteDialog);
  confirmDeleteBtn.addEventListener('click', confirmDeleteStep);
  deleteDialog.addEventListener('click', (event) => {
    if (event.target === deleteDialog) {
      closeDeleteDialog();
    }
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

  showSection('overview');
  requestRewardReconcile(loadData);
  setInterval(loadData, 30000);
});
