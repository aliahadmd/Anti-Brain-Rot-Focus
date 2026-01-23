document.addEventListener('DOMContentLoaded', () => {
  const totalCountEl = document.getElementById('totalCount');
  const topDistractionsEl = document.getElementById('topDistractions');
  const motivationTextEl = document.getElementById('motivationText');
  const saveTextBtn = document.getElementById('saveTextBtn');
  const saveStatus = document.getElementById('saveStatus');
  const newSiteInput = document.getElementById('newSite');
  const addSiteBtn = document.getElementById('addSiteBtn');
  const siteListEl = document.getElementById('siteList');

  function loadData() {
    chrome.storage.local.get(['stats', 'motivationalText', 'blockedSites'], (data) => {
      // Stats
      if (data.stats) {
        totalCountEl.textContent = data.stats.total || 0;
        renderTopDistractions(data.stats);
      }
      
      // Motivation
      if (data.motivationalText) {
        motivationTextEl.value = data.motivationalText;
      }

      // Blocked Sites
      if (data.blockedSites) {
        renderSiteList(data.blockedSites);
      }
    });
  }

  function renderTopDistractions(stats) {
    topDistractionsEl.innerHTML = '';
    const sorted = Object.entries(stats)
      .filter(([key]) => key !== 'total')
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    if (sorted.length === 0) {
      topDistractionsEl.innerHTML = '<li>No data yet.</li>';
      return;
    }

    sorted.forEach(([site, count]) => {
      const li = document.createElement('li');
      li.textContent = `${site}: ${count}`;
      topDistractionsEl.appendChild(li);
    });
  }

  function renderSiteList(sites) {
    siteListEl.innerHTML = '';
    sites.forEach(site => {
      const li = document.createElement('li');
      li.textContent = site;
      
      const btn = document.createElement('button');
      btn.textContent = 'Remove';
      btn.className = 'remove-btn';
      btn.onclick = () => removeSite(site);
      
      li.appendChild(btn);
      siteListEl.appendChild(li);
    });
  }

  function removeSite(siteToRemove) {
    chrome.storage.local.get(['blockedSites'], (data) => {
      const newSites = data.blockedSites.filter(site => site !== siteToRemove);
      chrome.storage.local.set({ blockedSites: newSites }, loadData);
    });
  }

  saveTextBtn.addEventListener('click', () => {
    const text = motivationTextEl.value;
    chrome.storage.local.set({ motivationalText: text }, () => {
      saveStatus.style.display = 'inline';
      setTimeout(() => { saveStatus.style.display = 'none'; }, 2000);
    });
  });

  addSiteBtn.addEventListener('click', () => {
    const site = newSiteInput.value.trim().toLowerCase();
    if (site) {
      chrome.storage.local.get(['blockedSites'], (data) => {
        const sites = data.blockedSites || [];
        if (!sites.includes(site)) {
          sites.push(site);
          chrome.storage.local.set({ blockedSites: sites }, () => {
            newSiteInput.value = '';
            loadData();
          });
        }
      });
    }
  });

  loadData();
});