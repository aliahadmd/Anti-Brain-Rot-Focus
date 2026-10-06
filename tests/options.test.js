const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadScripts, evaluate } = require('./harness');

// options.js only registers a DOMContentLoaded listener at load time.
const ctx = loadScripts(['lib/shared.js']);
ctx.document = { addEventListener: () => {} };
vm.runInContext(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'options.js'), 'utf8'), ctx);
const api = evaluate(ctx, '({ aggregateSiteStats, getSortedSites, getNextReward, getNextDeleteStep })');

test('legacy subdomain counts roll up into their blocked site', () => {
  const stats = { total: 9, 'youtube.com': 2, 'm.youtube.com': 3, 'music.youtube.com': 1, 'gone.com': 3 };
  const counts = { ...api.aggregateSiteStats(stats, ['youtube.com', 'music.youtube.com']) };

  assert.deepEqual(counts, { 'youtube.com': 5, 'music.youtube.com': 1, 'gone.com': 3 });
});

test('site list sorts by aggregated counts', () => {
  const counts = { 'a.com': 1, 'b.com': 5 };
  assert.deepEqual([...api.getSortedSites(['a.com', 'b.com', 'c.com'], counts, '', 'mostBlocked')], ['b.com', 'a.com', 'c.com']);
  assert.deepEqual([...api.getSortedSites(['a.com', 'b.com'], counts, 'b', 'nameAsc')], ['b.com']);
});

test('next reward math', () => {
  assert.deepEqual({ ...api.getNextReward(0, 10) }, { threshold: 10, current: 0, remaining: 10 });
  assert.deepEqual({ ...api.getNextReward(30, 30) }, { threshold: 60, current: 0, remaining: 30 });
  assert.equal(api.getNextDeleteStep(2).shouldDelete, true);
  assert.equal(api.getNextDeleteStep(0).shouldDelete, false);
});
