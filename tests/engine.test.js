const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts, evaluate } = require('./harness');

const ctx = loadScripts(['lib/shared.js', 'lib/engine.js']);
const api = evaluate(ctx, `({
  reconcileRewardState, applyRewardPenalty, createDefaultRewardState, recordBlockedVisit,
  pruneDailyStats, findMatchingBlockedSite, normalizeSiteInput, REWARD_PENALTY_DAYS
})`);

const at = (dateKey, time = '12:00:00') => new Date(`${dateKey}T${time}`);
const ON = { isEnabled: true, hasBlockedSites: true };
const OFF = { isEnabled: false, hasBlockedSites: true };
const EMPTY = { isEnabled: true, hasBlockedSites: false };

// Simulates the extension running once on each listed day.
function runDays(state, dateKeys, context = ON) {
  return dateKeys.reduce((current, dateKey) => api.reconcileRewardState(current, context, at(dateKey)), state);
}

test('credits each day the extension ran with Focus on', () => {
  let state = api.createDefaultRewardState(at('2026-10-01'));
  state = runDays(state, ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  assert.equal(state.progressDays, 3);
});

test('does not credit days the browser never ran', () => {
  let state = api.createDefaultRewardState(at('2026-01-01'));
  state = api.reconcileRewardState(state, ON, at('2026-03-02'));
  assert.equal(state.progressDays, 1, 'only Jan 1, the day it actually ran');
  assert.equal(state.earnedMedals.length, 0);
});

test('moving the clock forward does not mint days or medals', () => {
  let state = api.createDefaultRewardState(at('2026-10-01'));
  state = api.reconcileRewardState(state, ON, at('2027-10-01'));
  assert.equal(state.progressDays, 1);
  assert.equal(state.earnedMedals.length, 0);
});

test('moving the clock backward never re-credits', () => {
  let state = runDays(api.createDefaultRewardState(at('2026-10-01')), ['2026-10-01', '2026-10-05']);
  const before = state.progressDays;
  state = api.reconcileRewardState(state, ON, at('2026-09-20'));
  assert.equal(state.progressDays, before);
  assert.equal(state.lastEvaluatedDate, '2026-10-05');
});

test('a stale disabledSinceDate from v2.0 no longer wipes enabled days', () => {
  const legacy = {
    ...api.createDefaultRewardState(at('2026-10-01')),
    disabledSinceDate: '2026-10-01'
  };
  legacy.dayLog['2026-10-01'].disabled = true;
  const state = runDays(legacy, ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']);
  assert.equal(state.progressDays, 3, 'Oct 2-4 credited, Oct 1 was disabled');
  assert.equal('disabledSinceDate' in state, false);
});

test('days while disabled are not credited', () => {
  let state = api.createDefaultRewardState(at('2026-10-01'));
  state = runDays(state, ['2026-10-01', '2026-10-02', '2026-10-03'], OFF);
  state = runDays(state, ['2026-10-04'], ON);
  assert.equal(state.progressDays, 0);
});

test('days with an empty blocklist are not credited', () => {
  let state = api.createDefaultRewardState(at('2026-10-01'));
  state = runDays(state, ['2026-10-01', '2026-10-02'], EMPTY);
  state = runDays(state, ['2026-10-03'], ON);
  assert.equal(state.progressDays, 0);
});

test('pause, disable, and site removal all cost the same and block today', () => {
  for (const reason of ['pause', 'disable', 'remove-site']) {
    let state = api.createDefaultRewardState(at('2026-10-01'));
    state.progressDays = 20;
    state = api.reconcileRewardState(state, ON, at('2026-10-01'));
    state = api.applyRewardPenalty(state, { reason, minutes: 15, site: 'youtube.com' }, at('2026-10-01'));
    assert.equal(state.progressDays, 20 - api.REWARD_PENALTY_DAYS, reason);

    state = api.reconcileRewardState(state, ON, at('2026-10-02'));
    assert.equal(state.progressDays, 20 - api.REWARD_PENALTY_DAYS, `${reason}: penalized day is not credited`);
    assert.equal(state.pauseEvents.at(-1).reason, reason);
  }
});

test('medals are awarded once and survive penalties', () => {
  let state = api.createDefaultRewardState(at('2026-10-01'));
  state.progressDays = 9;
  state = runDays(state, ['2026-10-01', '2026-10-02']);
  assert.deepEqual([...state.earnedMedals.map((medal) => medal.id)], ['focus-10']);

  state = api.applyRewardPenalty(state, { reason: 'pause', minutes: 5 }, at('2026-10-02'));
  state = runDays(state, ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06']);
  assert.equal(state.progressDays, 10);
  assert.deepEqual([...state.earnedMedals.map((medal) => medal.id)], ['focus-10']);
});

test('recordBlockedVisit counts by blocked site and prunes old days', () => {
  const old = { '2020-01-01': { total: 4, sites: { 'youtube.com': 4 } } };
  const next = api.recordBlockedVisit({ total: 4 }, old, 'youtube.com', at('2026-10-01'));
  assert.equal(next.stats.total, 5);
  assert.equal(next.stats['youtube.com'], 1);
  assert.deepEqual(Object.keys(next.dailyStats), ['2026-10-01']);
  assert.equal(next.dailyStats['2026-10-01'].sites['youtube.com'], 1);
});

test('findMatchingBlockedSite matches domains and subdomains only', () => {
  const sites = ['youtube.com', 'music.youtube.com', 'x.com'];
  assert.equal(api.findMatchingBlockedSite('www.youtube.com', sites), 'youtube.com');
  assert.equal(api.findMatchingBlockedSite('m.youtube.com', sites), 'youtube.com');
  assert.equal(api.findMatchingBlockedSite('music.youtube.com', sites), 'music.youtube.com');
  assert.equal(api.findMatchingBlockedSite('notyoutube.com', sites), null);
  assert.equal(api.findMatchingBlockedSite('youtube.com.evil.io', sites), null);
  assert.equal(api.findMatchingBlockedSite('netflix.com', sites), null);
});

test('normalizeSiteInput reports paths instead of silently dropping them', () => {
  assert.deepEqual({ ...api.normalizeSiteInput('youtube.com/shorts') }, { site: 'youtube.com', hasPath: true });
  assert.deepEqual({ ...api.normalizeSiteInput('https://www.YouTube.com/') }, { site: 'youtube.com', hasPath: false });
  assert.ok(api.normalizeSiteInput('not a domain').error);
  assert.ok(api.normalizeSiteInput('localhostx').error);
});
