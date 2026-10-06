const DASHBOARD_KEYS = [
  STORAGE.stats,
  STORAGE.dailyStats,
  STORAGE.analyticsMeta,
  STORAGE.rewardState,
  STORAGE.motivationalText,
  STORAGE.blockedSites,
  STORAGE.siteAddedOn,
  STORAGE.isEnabled,
  STORAGE.pausedUntil,
  STORAGE.redirectEnabled,
  STORAGE.redirectUrl
];
const DELETE_QUOTES = [
  'The easiest click is not always the kindest one to your future self.',
  'You blocked this for a reason. Is that reason still true?',
  'Last check: protect your attention like it matters, because it does.'
];
const PENALTY_REASON_TEXT = {
  pause: (event) => `after ${event.minutes || 0}m pause`,
  disable: () => 'for disabling Focus',
  'remove-site': (event) => `for removing ${event.site || 'a site'}`
};

function getLocalDayStart(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
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

// Groups per-host counts under the blocked site that covers them. Older
// versions stored counts by visited subdomain (m.youtube.com); newer ones
// store them by blocked site, so both end up in the same bucket.
function aggregateSiteStats(stats = {}, blockedSites = []) {
  const siteSet = new Set(blockedSites.map(normalizeHost));

  return Object.entries(stats).reduce((totals, [host, count]) => {
    if (host === 'total' || !Number.isFinite(count)) return totals;

    const key = findMatchingBlockedSite(host, siteSet) || host;
    totals[key] = (totals[key] || 0) + count;
    return totals;
  }, {});
}

function getSortedSites(sites = [], siteCounts = {}, searchTerm = '', sortMode = 'nameAsc') {
  const query = searchTerm.trim().toLowerCase();
  const filtered = sites.filter((site) => site.toLowerCase().includes(query));
  const countOf = (site) => siteCounts[site] || 0;

  return filtered.sort((a, b) => {
    if (sortMode === 'nameDesc') return b.localeCompare(a);
    if (sortMode === 'mostBlocked') return countOf(b) - countOf(a) || a.localeCompare(b);
    if (sortMode === 'leastBlocked') return countOf(a) - countOf(b) || a.localeCompare(b);
    return a.localeCompare(b);
  });
}

function getTopSites(siteCounts = {}, limit = 5) {
  return Object.entries(siteCounts)
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

function getNextReward(progressDays, interval) {
  const threshold = Math.floor(progressDays / interval) * interval + interval;
  const current = progressDays % interval;

  return {
    threshold,
    current,
    remaining: threshold - progressDays
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
  const medalCatalogCopy = document.getElementById('medalCatalogCopy');
  const medalCatalogCount = document.getElementById('medalCatalogCount');
  const medalCatalogList = document.getElementById('medalCatalogList');
  const blockedCountEl = document.getElementById('blockedCount');
  const topDistractionsEl = document.getElementById('topDistractions');
  const dailyChartEl = document.getElementById('dailyChart');
  const topSiteBarsEl = document.getElementById('topSiteBars');
  const motivationTextEl = document.getElementById('motivationText');
  const saveTextBtn = document.getElementById('saveTextBtn');
  const saveStatus = document.getElementById('saveStatus');
  const redirectToggle = document.getElementById('redirectToggle');
  const redirectUrlEl = document.getElementById('redirectUrl');
  const saveRedirectBtn = document.getElementById('saveRedirectBtn');
  const redirectWarning = document.getElementById('redirectWarning');
  const redirectStatus = document.getElementById('redirectStatus');
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
    guide: 'Guide',
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
    siteAddedOn: {},
    isEnabled: true,
    pausedUntil: null,
    redirectEnabled: false,
    redirectUrl: ''
  };
  let siteCounts = {};
  let pendingDeleteSite = null;
  let deleteStep = 0;
  let focusBeforeDialog = null;
  let motivationDirty = false;
  let redirectUrlDirty = false;
  let loadScheduled = false;

  function showMessage(element, message, isError = false) {
    element.textContent = message;
    element.classList.toggle('error', isError);

    if (message) {
      setTimeout(() => {
        if (element.textContent === message) {
          element.textContent = '';
          element.classList.remove('error');
        }
      }, FEEDBACK_CLEAR_MS);
    }
  }

  function getRemainingPause(pausedUntil) {
    if (!Number.isFinite(pausedUntil)) return 0;
    return Math.max(0, pausedUntil - Date.now());
  }

  function formatRemaining(ms) {
    const minutes = Math.ceil(ms / 60000);
    if (minutes < 60) return `${pluralize(minutes, 'minute')} left`;

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
    resumeFocusBtn.disabled = true;
  }

  function renderTopDistractions() {
    topDistractionsEl.textContent = '';

    const sorted = getTopSites(siteCounts, 5);

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

      track.title = `${day.dateKey}: ${pluralize(day.total, 'redirect')}`;
      track.appendChild(fill);
      wrapper.append(value, track, label);
      dailyChartEl.appendChild(wrapper);
    });
  }

  function renderTopSiteBars() {
    topSiteBarsEl.textContent = '';

    const topSites = getTopSites(siteCounts, 8);
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

  function renderSiteList(sites = []) {
    siteListEl.textContent = '';
    blockedCountEl.textContent = sites.length;

    const visibleSites = getSortedSites(sites, siteCounts, siteSearchEl.value, siteSortEl.value);

    if (sites.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No blocked sites yet. Days without a blocked site do not count toward rewards.';
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
      count.textContent = pluralize(siteCounts[site] || 0, 'save');

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
      li.textContent = 'No penalties yet.';
      pausePenaltyList.appendChild(li);
      return;
    }

    [...pauseEvents].slice(-5).reverse().forEach((event) => {
      const li = document.createElement('li');
      const date = document.createElement('strong');
      const detail = document.createElement('span');
      const describe = PENALTY_REASON_TEXT[event.reason] || PENALTY_REASON_TEXT.pause;

      date.textContent = event.date || 'Local day';
      detail.textContent = `-${event.penaltyDays || REWARD_PENALTY_DAYS} days ${describe(event)}`;
      li.append(date, detail);
      pausePenaltyList.appendChild(li);
    });
  }

  function renderEarnedMedals(medals = [], progressDays = 0) {
    earnedMedalsGrid.textContent = '';

    if (medals.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = `No medals yet. Your first glow-up is waiting at ${FOCUS_MEDAL_INTERVAL} focus days.`;
      earnedMedalsGrid.appendChild(empty);
    } else {
      [...medals]
        .sort((a, b) => (a.threshold || 0) - (b.threshold || 0) || String(a.type).localeCompare(String(b.type)))
        .forEach((medal) => earnedMedalsGrid.appendChild(createMedalCard(medal)));
    }

    const nextTen = getNextReward(progressDays, FOCUS_MEDAL_INTERVAL);
    earnedMedalsGrid.appendChild(createMedalCard({
      type: 'focus',
      threshold: nextTen.threshold,
      name: getMedalName('focus', nextTen.threshold)
    }, true));
  }

  // Static content: rendered once.
  function renderMedalCatalog() {
    const catalogGroups = [
      {
        title: `Every ${FOCUS_MEDAL_INTERVAL} Focus Days`,
        summary: `${MEDAL_NAMES_10.length} regular medal styles`,
        type: 'focus',
        interval: FOCUS_MEDAL_INTERVAL,
        names: MEDAL_NAMES_10
      },
      {
        title: `Every ${PRESTIGE_MEDAL_INTERVAL} Focus Days`,
        summary: `${MEDAL_NAMES_30.length} prestige medal styles`,
        type: 'prestige',
        interval: PRESTIGE_MEDAL_INTERVAL,
        names: MEDAL_NAMES_30
      }
    ];

    medalCatalogCopy.textContent = `There are ${MEDAL_NAMES_10.length} regular medal styles and ${MEDAL_NAMES_30.length} prestige medal styles. You can earn unlimited medals because the names repeat by cycle.`;
    medalCatalogCount.textContent = `${MEDAL_NAMES_10.length + MEDAL_NAMES_30.length} medal styles`;
    medalCatalogList.textContent = '';

    catalogGroups.forEach((group) => {
      const article = document.createElement('article');
      const header = document.createElement('div');
      const title = document.createElement('h3');
      const summary = document.createElement('span');
      const list = document.createElement('ol');

      article.className = `medal-catalog-group ${group.type === 'prestige' ? 'prestige' : 'focus'}`;
      header.className = 'medal-catalog-head';
      title.textContent = group.title;
      summary.textContent = group.summary;
      list.className = 'medal-name-list';

      group.names.forEach((name, index) => {
        const item = document.createElement('li');
        const icon = document.createElement('span');
        const detail = document.createElement('span');
        const medalName = document.createElement('strong');
        const threshold = document.createElement('small');
        const firstThreshold = group.interval * (index + 1);

        icon.className = 'catalog-medal-icon';
        icon.textContent = getMedalGlyph(group.type, firstThreshold);
        medalName.textContent = name;
        threshold.textContent = `First appears at ${firstThreshold} focus days`;

        detail.append(medalName, threshold);
        item.append(icon, detail);
        list.appendChild(item);
      });

      header.append(title, summary);
      article.append(header, list);
      medalCatalogList.appendChild(article);
    });
  }

  function renderRewards(rawRewardState) {
    const rewardState = normalizeRewardState(rawRewardState);
    const progressDays = rewardState.progressDays;
    const nextTen = getNextReward(progressDays, FOCUS_MEDAL_INTERVAL);
    const nextThirty = getNextReward(progressDays, PRESTIGE_MEDAL_INTERVAL);
    const nextTenName = getMedalName('focus', nextTen.threshold);
    const nextThirtyName = getMedalName('prestige', nextThirty.threshold);
    const tenPercent = Math.max(0, Math.min(100, (nextTen.current / FOCUS_MEDAL_INTERVAL) * 100));
    const thirtyPercent = Math.max(0, Math.min(100, (nextThirty.current / PRESTIGE_MEDAL_INTERVAL) * 100));

    overviewRewardDays.textContent = progressDays;
    overviewRewardNext.textContent = `${pluralize(nextTen.remaining, 'day')} to ${nextTenName}`;
    rewardProgressDays.textContent = progressDays;
    earnedMedalCount.textContent = rewardState.earnedMedals.length;
    nextPrestigeDays.textContent = nextThirty.remaining;
    nextPrestigeName.textContent = `days to ${nextThirtyName}`;
    nextMedalTitle.textContent = `${nextTenName} awaits`;
    nextMedalCopy.textContent = `${pluralize(nextTen.remaining, 'more focus day')} unlocks your next ${FOCUS_MEDAL_INTERVAL}-day medal. ${pluralize(nextThirty.remaining, 'day')} to the next prestige award.`;
    nextMedalIcon.textContent = getMedalGlyph('focus', nextTen.threshold);
    nextMedalType.textContent = `${nextTen.threshold}-day medal`;
    tenDayTrackName.textContent = nextTenName;
    tenDayTrackLabel.textContent = `${nextTen.current} / ${FOCUS_MEDAL_INTERVAL}`;
    tenDayTrackFill.style.width = `${tenPercent}%`;
    thirtyDayTrackName.textContent = nextThirtyName;
    thirtyDayTrackLabel.textContent = `${nextThirty.current} / ${PRESTIGE_MEDAL_INTERVAL}`;
    thirtyDayTrackFill.style.width = `${thirtyPercent}%`;

    renderPenaltyList(rewardState.pauseEvents);
    renderEarnedMedals(rewardState.earnedMedals, progressDays);
  }

  function renderAnalyticsStatus(data, dailyStats, now) {
    const stats = data.stats || { total: 0 };
    const legacyUntrackedTotal = getLegacyUntrackedTotal(stats, dailyStats);
    const timeZone = (data.analyticsMeta && data.analyticsMeta.timeZone) || getLocalTimeZone();
    const lastUpdated = data.analyticsMeta && data.analyticsMeta.lastUpdatedAt
      ? new Date(data.analyticsMeta.lastUpdatedAt)
      : null;
    const parts = [`Using local computer time (${timeZone}). Last refreshed ${formatLocalDateTime(now)}.`];

    if (legacyUntrackedTotal) {
      parts.push(`${pluralize(legacyUntrackedTotal, 'older save')} predate daily analytics and are included only in all-time totals.`);
    } else if (lastUpdated && !Number.isNaN(lastUpdated.getTime())) {
      parts.push(`Last redirect ${formatLocalDateTime(lastUpdated)}.`);
    } else {
      parts.push('No redirects recorded yet.');
    }

    analyticsTimeStatus.textContent = parts.join(' ');
  }

  function renderMotivation(text) {
    // Never overwrite what the user is typing.
    if (motivationDirty || document.activeElement === motivationTextEl) return;
    motivationTextEl.value = text || DEFAULT_MOTIVATION;
  }

  function renderRedirect(data) {
    redirectToggle.checked = data.redirectEnabled === true;

    if (!redirectUrlDirty && document.activeElement !== redirectUrlEl) {
      redirectUrlEl.value = data.redirectUrl || '';
    }

    const blockedTarget = data.redirectEnabled === true && !getRedirectTarget(data);
    const { host } = normalizeRedirectUrl(data.redirectUrl);

    redirectWarning.hidden = !blockedTarget;
    redirectWarning.textContent = blockedTarget
      ? `${host || 'That website'} is on your blocklist, so blocked visits show the block page instead.`
      : '';
  }

  function saveRedirectSettings() {
    const enabled = redirectToggle.checked;
    const raw = redirectUrlEl.value.trim();

    if (!enabled && !raw) {
      chrome.storage.local.set({ [STORAGE.redirectEnabled]: false, [STORAGE.redirectUrl]: '' }, () => {
        redirectUrlDirty = false;
        showMessage(redirectStatus, 'Saved. Blocked sites show the block page.');
      });
      return;
    }

    const result = normalizeRedirectUrl(raw);
    const blockedSite = result.host ? findMatchingBlockedSite(result.host, currentData.blockedSites) : null;
    const error = result.error || (blockedSite
      ? `${result.host} is on your blocklist. Choose a website that isn't blocked.`
      : null);

    if (error) {
      redirectToggle.checked = currentData.redirectEnabled === true;
      showMessage(redirectStatus, error, true);
      return;
    }

    chrome.storage.local.set({ [STORAGE.redirectEnabled]: enabled, [STORAGE.redirectUrl]: result.url }, () => {
      redirectUrlDirty = false;
      redirectUrlEl.value = result.url;
      showMessage(redirectStatus, enabled
        ? `Blocked sites now redirect to ${result.url}`
        : 'Saved. Blocked sites show the block page.');
    });
  }

  function renderDashboard(data) {
    const now = new Date();
    const stats = data.stats || { total: 0 };
    const dailyStats = data.dailyStats;
    const todayTotal = getDailyTotal(dailyStats, getDateKey(now));

    siteCounts = aggregateSiteStats(stats, data.blockedSites);

    totalCountEl.textContent = stats.total || 0;
    todayCountEl.textContent = todayTotal;
    analyticsTodayCountEl.textContent = todayTotal;
    analyticsAllTimeCountEl.textContent = stats.total || 0;
    weekCountEl.textContent = sumRecentDays(dailyStats, 7, now);

    renderAnalyticsStatus(data, dailyStats, now);
    renderMotivation(data.motivationalText);
    renderRedirect(data);
    renderFocusState(data);
    renderTopDistractions();
    renderDailyChart(dailyStats, now);
    renderTopSiteBars();
    renderSiteList(data.blockedSites);
    renderRewards(data.rewardState);
  }

  function loadData() {
    chrome.storage.local.get(DASHBOARD_KEYS, (data) => {
      currentData = {
        ...currentData,
        ...data,
        stats: data.stats || { total: 0 },
        dailyStats: normalizeDailyStats(data.dailyStats || {}),
        analyticsMeta: data.analyticsMeta || {},
        rewardState: normalizeRewardState(data.rewardState),
        blockedSites: Array.isArray(data.blockedSites) ? data.blockedSites : [],
        siteAddedOn: data.siteAddedOn && typeof data.siteAddedOn === 'object' ? data.siteAddedOn : {}
      };

      renderDashboard(currentData);
    });
  }

  // Coalesces bursts of storage changes into one render.
  function scheduleLoad() {
    if (loadScheduled) return;
    loadScheduled = true;
    setTimeout(() => {
      loadScheduled = false;
      loadData();
    }, 50);
  }

  function reportAddResult(result, verb = 'Added') {
    const parts = [`${verb} ${pluralize(result.added.length, 'site')}`];

    if (result.duplicates.length) parts.push(`${result.duplicates.length} already blocked`);
    if (result.invalid.length) parts.push(`${result.invalid.length} invalid`);
    if (result.overLimit.length) parts.push(`${result.overLimit.length} over the ${MAX_BLOCKED_SITES}-site limit`);

    showMessage(siteFeedback, `${parts.join('; ')}.`, result.added.length === 0 && (result.invalid.length > 0 || result.overLimit.length > 0));
  }

  async function addSiteFromInput() {
    const result = normalizeSiteInput(newSiteInput.value);

    if (result.error) {
      showMessage(siteFeedback, result.error, true);
      return;
    }

    if (result.hasPath) {
      showMessage(siteFeedback, `Only whole domains can be blocked. Enter "${result.site}" to block all of ${result.site}.`, true);
      return;
    }

    const response = await sendExtensionMessage({ type: MESSAGE.addSites, sites: [result.site] });

    if (!response.ok) {
      showMessage(siteFeedback, `Could not add ${result.site}. ${response.error}`, true);
    } else if (response.added.length) {
      newSiteInput.value = '';
      showMessage(siteFeedback, `${result.site} added.`);
    } else if (response.overLimit.length) {
      showMessage(siteFeedback, `You can block up to ${MAX_BLOCKED_SITES} sites.`, true);
    } else {
      showMessage(siteFeedback, `${result.site} is already blocked.`, true);
    }
  }

  async function removeSiteConfirmed(siteToRemove) {
    const response = await sendExtensionMessage({ type: MESSAGE.removeSite, site: siteToRemove });

    if (!response.ok) {
      showMessage(siteFeedback, `Could not remove ${siteToRemove}. ${response.error}`, true);
      return;
    }

    showMessage(siteFeedback, response.penaltyApplied
      ? `${siteToRemove} removed. Reward progress lost ${REWARD_PENALTY_DAYS} days.`
      : `${siteToRemove} removed.`);
  }

  function isSiteRemovalFree(site) {
    return currentData.siteAddedOn[site] === getDateKey();
  }

  function openDeleteDialog(site) {
    focusBeforeDialog = document.activeElement;
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

    if (focusBeforeDialog && document.contains(focusBeforeDialog)) {
      focusBeforeDialog.focus();
    }
    focusBeforeDialog = null;
  }

  function renderDeleteDialog() {
    const isLastStep = deleteStep === DELETE_QUOTES.length - 1;
    const cost = isSiteRemovalFree(pendingDeleteSite)
      ? 'You added it today, so removing it is free.'
      : `Removing it costs ${REWARD_PENALTY_DAYS} reward days and makes today ineligible.`;

    deleteTitle.textContent = `Remove ${pendingDeleteSite}?`;
    deleteQuote.textContent = DELETE_QUOTES[deleteStep];
    deleteQuestion.textContent = `Confirmation ${deleteStep + 1}/${DELETE_QUOTES.length}: do you still want this site removed from your blocklist? ${cost}`;
    confirmDeleteBtn.textContent = isLastStep ? 'Yes, remove it' : 'Yes, ask again';
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

  async function resetStats() {
    if (!window.confirm('Reset all focus statistics, including analytics history?')) return;

    const response = await sendExtensionMessage({ type: MESSAGE.resetStats });
    if (!response.ok) {
      window.alert(`Statistics were not reset. ${response.error}`);
    }
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
    // Revoking synchronously can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importBlocklist(file) {
    if (!file) return;

    if (file.size > MAX_IMPORT_FILE_BYTES) {
      showMessage(siteFeedback, `That file is too large. Blocklists must be under ${Math.round(MAX_IMPORT_FILE_BYTES / 1024)} KB.`, true);
      importFile.value = '';
      return;
    }

    const reader = new FileReader();
    reader.addEventListener('load', async () => {
      importFile.value = '';

      let payload;
      try {
        payload = JSON.parse(reader.result);
      } catch (error) {
        showMessage(siteFeedback, 'Could not read that JSON blocklist.', true);
        return;
      }

      if (!payload || !Array.isArray(payload.blockedSites)) {
        showMessage(siteFeedback, 'Import file must include a blockedSites array.', true);
        return;
      }

      const response = await sendExtensionMessage({ type: MESSAGE.addSites, sites: payload.blockedSites });

      if (!response.ok) {
        showMessage(siteFeedback, `Import failed. ${response.error}`, true);
        return;
      }

      reportAddResult(response, 'Imported');
    });
    reader.addEventListener('error', () => {
      importFile.value = '';
      showMessage(siteFeedback, 'Could not read that file.', true);
    });
    reader.readAsText(file);
  }

  navButtons.forEach((button) => {
    button.addEventListener('click', () => showSection(button.dataset.section));
  });

  motivationTextEl.addEventListener('input', () => {
    motivationDirty = true;
  });

  saveTextBtn.addEventListener('click', () => {
    const text = motivationTextEl.value.trim();

    if (!text) {
      showMessage(saveStatus, 'Add a message before saving.', true);
      return;
    }

    chrome.storage.local.set({ [STORAGE.motivationalText]: text }, () => {
      motivationDirty = false;
      showMessage(saveStatus, 'Saved.');
    });
  });

  redirectUrlEl.addEventListener('input', () => {
    redirectUrlDirty = true;
  });

  redirectUrlEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveRedirectSettings();
    }
  });

  redirectToggle.addEventListener('change', () => {
    // Turning redirect off never needs a valid address.
    if (!redirectToggle.checked) {
      chrome.storage.local.set({ [STORAGE.redirectEnabled]: false }, () => {
        showMessage(redirectStatus, 'Blocked sites show the block page.');
      });
      return;
    }

    saveRedirectSettings();
  });

  saveRedirectBtn.addEventListener('click', saveRedirectSettings);

  addSiteBtn.addEventListener('click', addSiteFromInput);

  newSiteInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addSiteFromInput();
    }
  });

  siteSearchEl.addEventListener('input', () => renderSiteList(currentData.blockedSites));
  siteSortEl.addEventListener('change', () => renderSiteList(currentData.blockedSites));

  enabledToggle.addEventListener('change', async () => {
    const enable = enabledToggle.checked;

    if (!enable && !window.confirm(DISABLE_WARNING)) {
      enabledToggle.checked = true;
      return;
    }

    enabledToggle.disabled = true;
    const response = await sendExtensionMessage({ type: MESSAGE.setFocusEnabled, enabled: enable });
    enabledToggle.disabled = false;

    if (!response.ok) {
      window.alert(`Focus was not changed. ${response.error}`);
    }
    loadData();
  });

  resumeFocusBtn.addEventListener('click', async () => {
    const response = await sendExtensionMessage({ type: MESSAGE.resumeFocus });
    if (!response.ok) {
      window.alert(`Focus was not resumed. ${response.error}`);
    }
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
  deleteDialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDeleteDialog();
      return;
    }

    // Keep keyboard focus inside the dialog.
    if (event.key === 'Tab') {
      const focusable = [cancelDeleteBtn, confirmDeleteBtn];
      const index = focusable.indexOf(document.activeElement);
      const nextIndex = event.shiftKey
        ? (index <= 0 ? focusable.length - 1 : index - 1)
        : (index === focusable.length - 1 ? 0 : index + 1);

      event.preventDefault();
      focusable[nextIndex].focus();
    }
  });

  presetButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      const presetSites = PRESET_BLOCKLISTS[button.dataset.preset] || [];
      const response = await sendExtensionMessage({ type: MESSAGE.addSites, sites: presetSites });

      if (!response.ok) {
        showMessage(siteFeedback, `Could not add preset. ${response.error}`, true);
      } else if (response.added.length === 0 && response.overLimit.length === 0) {
        showMessage(siteFeedback, 'Those sites are already blocked.');
      } else {
        reportAddResult(response);
      }
    });
  });

  document.querySelectorAll('.js-penalty-days').forEach((element) => {
    element.textContent = REWARD_PENALTY_DAYS;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && Object.keys(changes).some((key) => DASHBOARD_KEYS.includes(key))) {
      scheduleLoad();
    }
  });

  showSection('overview');
  renderMedalCatalog();
  loadData();
  sendExtensionMessage({ type: MESSAGE.reconcileRewards }).then((response) => {
    if (!response.ok) console.warn('Reward reconcile failed:', response.error);
  });
  setInterval(scheduleLoad, UI_REFRESH_INTERVAL_MS);
});
