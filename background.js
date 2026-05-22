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
const STORAGE_KEYS = ["blockedSites", "motivationalText", "isEnabled", "stats", "pausedUntil"];

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
    if (result.pausedUntil === undefined) {
      updates.pausedUntil = null;
    }

    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates);
    }
  });
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

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;

  if (details.url.startsWith(chrome.runtime.getURL(""))) return;

  try {
    const url = new URL(details.url);
    if (!["http:", "https:"].includes(url.protocol)) return;

    const hostname = url.hostname;

    chrome.storage.local.get(["blockedSites", "isEnabled", "stats", "pausedUntil"], (data) => {
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

        chrome.storage.local.set({ stats: newStats });

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
