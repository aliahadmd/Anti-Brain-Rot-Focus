// Loads extension scripts into an isolated VM context with a controllable
// clock and an in-memory fake of the chrome.* APIs the extension uses.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function createClock(startIso) {
  const clock = { nowMs: new Date(startIso).getTime() };

  class FakeDate extends Date {
    constructor(...args) {
      if (args.length === 0) {
        super(clock.nowMs);
      } else {
        super(...args);
      }
    }

    static now() {
      return clock.nowMs;
    }
  }

  clock.Date = FakeDate;
  clock.set = (iso) => {
    clock.nowMs = new Date(iso).getTime();
  };
  clock.advanceMinutes = (minutes) => {
    clock.nowMs += minutes * 60000;
  };
  return clock;
}

function createEvent() {
  const listeners = [];
  return {
    listeners,
    addListener: (listener) => listeners.push(listener),
    fire: (...args) => listeners.map((listener) => listener(...args))
  };
}

function pick(store, keys) {
  if (keys === null || keys === undefined) return { ...store };
  if (typeof keys === 'string') keys = [keys];
  if (Array.isArray(keys)) {
    return Object.fromEntries(keys.filter((key) => key in store).map((key) => [key, structuredClone(store[key])]));
  }
  return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [key, key in store ? structuredClone(store[key]) : fallback]));
}

function createStorageArea(areaName, onChanged) {
  const store = {};
  const delay = () => new Promise((resolve) => setImmediate(resolve));

  const withCallback = (promise, callback) => {
    if (typeof callback === 'function') {
      promise.then(callback);
      return undefined;
    }
    return promise;
  };

  return {
    store,
    get(keys, callback) {
      return withCallback(delay().then(() => pick(store, keys)), callback);
    },
    set(items, callback) {
      return withCallback(delay().then(() => {
        const changes = {};
        Object.entries(items).forEach(([key, value]) => {
          changes[key] = { oldValue: store[key], newValue: value };
          store[key] = structuredClone(value);
        });
        onChanged.fire(changes, areaName);
      }), callback);
    },
    remove(keys, callback) {
      return withCallback(delay().then(() => {
        [].concat(keys).forEach((key) => delete store[key]);
      }), callback);
    }
  };
}

function createChrome({ tabs = [] } = {}) {
  const onChanged = createEvent();
  const alarms = new Map();
  const state = {
    dynamicRules: [],
    tabs: tabs.map((tab) => ({ ...tab })),
    tabUpdates: []
  };

  const chrome = {
    state,
    runtime: {
      onInstalled: createEvent(),
      onStartup: createEvent(),
      onMessage: createEvent(),
      lastError: undefined,
      getURL: (file) => `chrome-extension://test-id/${file}`
    },
    storage: {
      onChanged,
      local: createStorageArea('local', onChanged),
      session: createStorageArea('session', onChanged)
    },
    alarms: {
      onAlarm: createEvent(),
      alarms,
      create: async (name, info) => {
        alarms.set(name, info);
      },
      clear: async (name) => alarms.delete(name),
      get: async (name) => alarms.get(name)
    },
    declarativeNetRequest: {
      updateDynamicRules: async ({ removeRuleIds = [], addRules = [] }) => {
        state.dynamicRules = state.dynamicRules.filter((rule) => !removeRuleIds.includes(rule.id)).concat(addRules);
      }
    },
    tabs: {
      onRemoved: createEvent(),
      query: async () => state.tabs.map(({ id }) => ({ id })),
      update: async (tabId, { url }) => {
        state.tabUpdates.push({ tabId, url });
        const tab = state.tabs.find((item) => item.id === tabId);
        if (tab) tab.url = url;
      }
    },
    webNavigation: {
      onBeforeNavigate: createEvent(),
      onErrorOccurred: createEvent(),
      getFrame: async ({ tabId }) => {
        const tab = state.tabs.find((item) => item.id === tabId);
        return tab ? { url: tab.url } : null;
      }
    }
  };

  return chrome;
}

function loadScripts(files, { clock, chrome } = {}) {
  const context = vm.createContext({
    console,
    setTimeout,
    setImmediate,
    structuredClone,
    URL,
    Date: clock ? clock.Date : Date,
    chrome
  });
  const run = (file) => vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });

  context.importScripts = (...scripts) => scripts.forEach(run);
  files.forEach(run);
  return context;
}

// Evaluates an expression inside the context (top-level consts are not
// properties of the context object).
function evaluate(context, expression) {
  return vm.runInContext(expression, context);
}

async function settle(ticks = 20) {
  for (let i = 0; i < ticks; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function loadBackground({ start = '2026-10-01T10:00:00', tabs = [], seed = {} } = {}) {
  const clock = createClock(start);
  const chrome = createChrome({ tabs });
  Object.assign(chrome.storage.local.store, structuredClone(seed));
  const context = loadScripts(['background.js'], { clock, chrome });

  chrome.runtime.onInstalled.fire({ reason: 'install' });
  await settle();

  const send = (message) => new Promise((resolve) => {
    const keepOpen = chrome.runtime.onMessage.listeners[0](message, {}, resolve);
    if (!keepOpen) resolve(undefined);
  });

  const fireAlarm = async (name) => {
    chrome.alarms.onAlarm.fire({ name });
    await settle();
  };

  const navigate = async (tabId, url, frameId = 0) => {
    chrome.webNavigation.onBeforeNavigate.fire({ tabId, url, frameId });
    await settle();
  };

  return { clock, chrome, context, store: chrome.storage.local.store, send, fireAlarm, navigate, settle };
}

module.exports = { createClock, loadScripts, evaluate, loadBackground, settle };
