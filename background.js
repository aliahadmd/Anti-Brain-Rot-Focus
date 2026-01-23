const DEFAULT_BLOCKED_SITES = ["youtube.com", "x.com", "facebook.com", "instagram.com", "tiktok.com", "reddit.com"];
const DEFAULT_MOTIVATION = "Don't let the brain rot consume you! Stay focused and build your future.";

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["blockedSites", "motivationalText", "isEnabled", "stats"], (result) => {
    if (!result.blockedSites) {
      chrome.storage.local.set({ blockedSites: DEFAULT_BLOCKED_SITES });
    }
    if (!result.motivationalText) {
      chrome.storage.local.set({ motivationalText: DEFAULT_MOTIVATION });
    }
    if (result.isEnabled === undefined) {
      chrome.storage.local.set({ isEnabled: true });
    }
    if (!result.stats) {
      chrome.storage.local.set({ stats: { total: 0 } });
    }
  });
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return; // Only block main frame

  // Skip if it's already the blocked page or internal pages
  if (details.url.startsWith(chrome.runtime.getURL(""))) return;

  try {
    const url = new URL(details.url);
    const hostname = url.hostname;

    chrome.storage.local.get(["blockedSites", "isEnabled", "stats"], (data) => {
      if (!data.isEnabled || !data.blockedSites) return;

      const isBlocked = data.blockedSites.some(site => hostname.includes(site));

      if (isBlocked) {
        // Update stats
        const newStats = data.stats || { total: 0 };
        newStats.total = (newStats.total || 0) + 1;
        
        // Sanitize hostname for key storage
        newStats[hostname] = (newStats[hostname] || 0) + 1;
        
        chrome.storage.local.set({ stats: newStats });

        // Redirect
        const blockedUrl = chrome.runtime.getURL("blocked.html");
        chrome.tabs.update(details.tabId, { url: blockedUrl + "?target=" + encodeURIComponent(hostname) });
      }
    });
  } catch (e) {
    // Ignore invalid URLs
    console.error("Invalid URL:", details.url);
  }
});