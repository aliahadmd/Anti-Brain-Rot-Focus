const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackground } = require('./harness');

const BLOCK_PAGE = 'chrome-extension://test-id/blocked.html';
const blockRule = (chrome) => chrome.state.dynamicRules.find((rule) => rule.id === 1);

test('install seeds defaults, a block rule, and the reconcile alarm', async () => {
  const bg = await loadBackground();

  assert.ok(bg.store.blockedSites.includes('youtube.com'));
  assert.equal(bg.store.isEnabled, true);
  assert.equal(bg.store.siteAddedOn['youtube.com'], '2026-10-01');
  assert.ok(blockRule(bg.chrome).condition.requestDomains.includes('youtube.com'));
  assert.ok(bg.chrome.alarms.alarms.has('reward-reconcile'));
});

test('blocked navigation redirects, counts by blocked site, and remembers the URL', async () => {
  const bg = await loadBackground({ tabs: [{ id: 7, url: 'https://example.org/' }] });

  await bg.navigate(7, 'https://m.youtube.com/watch?v=abc');

  assert.equal(bg.chrome.state.tabUpdates.at(-1).url, `${BLOCK_PAGE}?target=m.youtube.com`);
  assert.equal(bg.store.stats.total, 1);
  assert.equal(bg.store.stats['youtube.com'], 1);
  assert.equal(bg.store.dailyStats['2026-10-01'].sites['youtube.com'], 1);
  assert.equal(bg.chrome.storage.session.store['returnUrl:7'], 'https://m.youtube.com/watch?v=abc');
});

test('non-blocked and subframe navigations are ignored', async () => {
  const bg = await loadBackground();

  await bg.navigate(1, 'https://example.org/');
  await bg.navigate(1, 'https://youtube.com/', 3);

  assert.equal(bg.chrome.state.tabUpdates.length, 0);
  assert.equal(bg.store.stats.total, 0);
});

test('concurrent blocked navigations never lose counts', async () => {
  const bg = await loadBackground();

  for (let tabId = 1; tabId <= 25; tabId += 1) {
    bg.chrome.webNavigation.onBeforeNavigate.fire({ tabId, url: 'https://youtube.com/', frameId: 0 });
  }
  await bg.settle(500);

  assert.equal(bg.store.stats.total, 25);
  assert.equal(bg.store.stats['youtube.com'], 25);
});

test('pause applies the penalty and the pause together, and lifts the block rule before replying', async () => {
  const bg = await loadBackground({ seed: { rewardState: undefined } });
  bg.store.rewardState.progressDays = 20;

  const response = await bg.send({ type: 'PAUSE_FOCUS', minutes: 15 });

  assert.equal(response.ok, true);
  assert.equal(response.penaltyApplied, true);
  assert.equal(bg.store.rewardState.progressDays, 17);
  assert.equal(bg.store.pausedUntil, bg.clock.nowMs + 15 * 60000);
  assert.equal(blockRule(bg.chrome), undefined, 'rule removed before the reply');
  assert.ok(bg.chrome.alarms.alarms.has('pause-end'));

  await bg.navigate(2, 'https://youtube.com/');
  assert.equal(bg.chrome.state.tabUpdates.length, 0, 'not blocked while paused');
});

test('pausing again while paused, or while off, is free', async () => {
  const bg = await loadBackground();
  bg.store.rewardState.progressDays = 20;

  await bg.send({ type: 'PAUSE_FOCUS', minutes: 5 });
  const second = await bg.send({ type: 'PAUSE_FOCUS', minutes: 5 });
  assert.equal(second.penaltyApplied, false);
  assert.equal(bg.store.rewardState.progressDays, 17);

  await bg.send({ type: 'RESUME_FOCUS' });
  await bg.send({ type: 'SET_FOCUS_ENABLED', enabled: false });
  const whileOff = await bg.send({ type: 'PAUSE_FOCUS', minutes: 5 });
  assert.equal(whileOff.penaltyApplied, false);
  assert.equal(bg.store.rewardState.progressDays, 14, 'pause -3, disable -3, pause while off 0');
});

test('when a pause ends, the rule returns and open blocked tabs are swept', async () => {
  const bg = await loadBackground({ tabs: [{ id: 4, url: 'https://example.org/' }] });

  await bg.send({ type: 'PAUSE_FOCUS', minutes: 5 });
  bg.chrome.state.tabs[0].url = 'https://www.youtube.com/feed';
  bg.clock.advanceMinutes(6);
  await bg.fireAlarm('pause-end');
  await bg.settle();

  assert.equal(bg.store.pausedUntil, null);
  assert.ok(blockRule(bg.chrome));
  assert.equal(bg.chrome.state.tabs[0].url, `${BLOCK_PAGE}?target=youtube.com`);
  assert.equal(bg.store.stats.total, 0, 'sweeps are not counted as attempts');
});

test('adding a site sweeps tabs already open on it', async () => {
  const bg = await loadBackground({ tabs: [{ id: 9, url: 'https://news.ycombinator.com/' }] });

  const response = await bg.send({ type: 'ADD_SITES', sites: ['ycombinator.com', 'youtube.com', 'bad domain'] });

  assert.deepEqual([...response.added], ['ycombinator.com']);
  assert.deepEqual([...response.duplicates], ['youtube.com']);
  assert.deepEqual([...response.invalid], ['bad domain']);
  assert.equal(bg.chrome.state.tabs[0].url, `${BLOCK_PAGE}?target=news.ycombinator.com`);
});

test('re-enabling notifies the background, so enabled days are credited (H1)', async () => {
  const bg = await loadBackground();

  await bg.send({ type: 'SET_FOCUS_ENABLED', enabled: false });
  await bg.send({ type: 'SET_FOCUS_ENABLED', enabled: true });

  for (const day of ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']) {
    bg.clock.set(`${day}T09:00:00`);
    await bg.fireAlarm('reward-reconcile');
  }

  assert.equal(bg.store.rewardState.progressDays, 3, 'Oct 2-4 credited; Oct 1 disabled');
  assert.equal(bg.store.isEnabled, true);
});

test('removing a site costs days unless it was added today', async () => {
  const bg = await loadBackground({ seed: { blockedSites: ['old.com', 'youtube.com'], siteAddedOn: {} } });
  bg.store.rewardState.progressDays = 10;

  await bg.send({ type: 'ADD_SITES', sites: ['new.com'] });
  const free = await bg.send({ type: 'REMOVE_SITE', site: 'new.com' });
  const costly = await bg.send({ type: 'REMOVE_SITE', site: 'old.com' });

  assert.equal(free.penaltyApplied, false);
  assert.equal(costly.penaltyApplied, true);
  assert.equal(bg.store.rewardState.progressDays, 7);
  assert.deepEqual([...bg.store.blockedSites], ['youtube.com']);
  assert.equal(bg.store.rewardState.pauseEvents.at(-1).site, 'old.com');
});

test('emptying the blocklist removes the rule and marks today unprotected', async () => {
  const bg = await loadBackground({ seed: { blockedSites: ['youtube.com'], siteAddedOn: { 'youtube.com': '2026-10-01' } } });

  await bg.send({ type: 'REMOVE_SITE', site: 'youtube.com' });

  assert.equal(blockRule(bg.chrome), undefined);
  assert.equal(bg.store.rewardState.dayLog['2026-10-01'].unprotected, true);
});

test('unknown messages are not answered', async () => {
  const bg = await loadBackground();
  assert.equal(await bg.send({ type: 'NOPE' }), undefined);
});

const REDIRECT_SEED = { redirectEnabled: true, redirectUrl: 'https://khanacademy.org/' };

test('redirect mode sends blocked visits to the chosen website and still counts them', async () => {
  const bg = await loadBackground({ seed: REDIRECT_SEED });

  await bg.navigate(3, 'https://www.youtube.com/watch?v=1');

  assert.equal(bg.chrome.state.tabUpdates.at(-1).url, 'https://khanacademy.org/');
  assert.equal(bg.store.stats['youtube.com'], 1);
  assert.equal(bg.chrome.storage.session.store['returnUrl:3'], undefined, 'no return URL without a block page');
});

test('a redirect website that is itself blocked falls back to the block page', async () => {
  const bg = await loadBackground({ seed: { redirectEnabled: true, redirectUrl: 'https://m.youtube.com/' } });

  await bg.navigate(3, 'https://reddit.com/');

  assert.equal(bg.chrome.state.tabUpdates.at(-1).url, `${BLOCK_PAGE}?target=reddit.com`);
});

test('the blocked-load backstop does not override an in-flight redirect', async () => {
  const bg = await loadBackground({ seed: REDIRECT_SEED });

  await bg.navigate(3, 'https://youtube.com/');
  bg.chrome.webNavigation.onErrorOccurred.fire({ tabId: 3, url: 'https://youtube.com/', frameId: 0, error: 'net::ERR_BLOCKED_BY_CLIENT' });
  await bg.settle();

  assert.equal(bg.chrome.state.tabUpdates.length, 1);
  assert.equal(bg.chrome.state.tabUpdates[0].url, 'https://khanacademy.org/');
});

test('a blocked load that bounced off the redirect website gets the block page', async () => {
  const bg = await loadBackground({ seed: REDIRECT_SEED });

  await bg.navigate(3, 'https://youtube.com/');
  // The redirect website itself server-redirects to a blocked site.
  bg.chrome.webNavigation.onErrorOccurred.fire({ tabId: 3, url: 'https://reddit.com/', frameId: 0, error: 'net::ERR_BLOCKED_BY_CLIENT' });
  await bg.settle();

  assert.equal(bg.chrome.state.tabUpdates.at(-1).url, `${BLOCK_PAGE}?target=reddit.com`);
});

test('a tab that keeps landing on blocked sites stops being redirected to the website', async () => {
  const bg = await loadBackground({ seed: REDIRECT_SEED });

  for (let i = 0; i < 4; i += 1) {
    await bg.navigate(3, 'https://youtube.com/');
  }

  const destinations = bg.chrome.state.tabUpdates.map((update) => update.url);
  assert.deepEqual(destinations.slice(0, 3), Array(3).fill('https://khanacademy.org/'));
  assert.equal(destinations[3], `${BLOCK_PAGE}?target=youtube.com`);

  bg.clock.advanceMinutes(1);
  await bg.navigate(3, 'https://youtube.com/');
  assert.equal(bg.chrome.state.tabUpdates.at(-1).url, 'https://khanacademy.org/', 'guard resets after the window');
});

test('sweeps use the redirect website too', async () => {
  const bg = await loadBackground({ seed: REDIRECT_SEED, tabs: [{ id: 5, url: 'https://example.org/' }] });

  await bg.send({ type: 'PAUSE_FOCUS', minutes: 5 });
  bg.chrome.state.tabs[0].url = 'https://reddit.com/r/all';
  await bg.send({ type: 'RESUME_FOCUS' });

  assert.equal(bg.chrome.state.tabs[0].url, 'https://khanacademy.org/');
});
