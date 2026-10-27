const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const filename = path.resolve(
  __dirname,
  '../src/vendor/electron-chrome-extensions/browser/api/tabs.ts',
);
const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2019,
  },
  fileName: filename,
}).outputText;

const requireMock = (request) => {
  if (request === 'electron') return { webContents: { fromId: () => undefined } };
  if (request === 'debug') return { __esModule: true, default: () => () => {} };
  if (request === './common') {
    return {
      getAllWindows: () => [],
      matchesPattern: () => true,
      matchesTitlePattern: () => true,
      resolveExtensionPath: () => undefined,
    };
  }
  if (request === './windows') {
    return { WindowsAPI: { WINDOW_ID_NONE: -1, WINDOW_ID_CURRENT: -2 } };
  }
  if (request === '../context' || request === '../router') return {};
  return require(request);
};

const loaded = { exports: {} };
new Function('require', 'module', 'exports', '__filename', '__dirname', output)(
  requireMock,
  loaded,
  loaded.exports,
  filename,
  path.dirname(filename),
);

const { TabsAPI } = loaded.exports;
const handlers = new Map();
const broadcasts = [];
const tabs = [11, 12, 13].map((id) => ({
  id,
  audioMuted: false,
  favicon: '',
  getTitle: () => `Tab ${id}`,
  getURL: () => `https://example.test/${id}`,
  isCurrentlyAudible: () => false,
  isDestroyed: () => false,
  isLoading: () => false,
}));
const indices = new Map([[11, 0], [12, 1], [13, 2]]);
const details = new Map(
  tabs.map((tab) => [
    tab.id,
    {
      id: tab.id,
      active: tab.id === 11,
      selected: tab.id === 11,
      highlighted: tab.id === 11,
      index: indices.get(tab.id),
      windowId: 41,
    },
  ]),
);
const window = {
  id: 41,
  getPosition: () => [100, 200],
  getSize: () => [1200, 800],
  isAlwaysOnTop: () => true,
  isDestroyed: () => false,
  isFocused: () => false,
  isFullScreen: () => false,
  isMaximized: () => true,
  isMinimized: () => false,
};
let activeTab;
const tabToWindow = new WeakMap(tabs.map((tab) => [tab, window]));
const ctx = {
  session: { isPersistent: () => true },
  router: {
    apiHandler: () => (name, handler) => handlers.set(name, handler),
    broadcastEvent: (name, ...args) => broadcasts.push([name, ...args]),
  },
  store: {
    impl: { isIncognitoWindow: () => false },
    tabs: new Set(tabs),
    tabToWindow,
    tabDetailsCache: details,
    getActiveTabFromWebContents: () => activeTab,
    getCurrentWindow: () => window,
    getTabById: (id) => tabs.find((tab) => tab.id === id),
    getWindowById: (id) => (id === window.id ? window : undefined),
    getTabsInWindow: () => tabs,
    getTabIndex: (tab) => indices.get(tab.id),
    setActiveTab: (tab) => { activeTab = tab; },
    on() {},
  },
};

new TabsAPI(ctx);
assert.strictEqual(handlers.has('tabs.highlight'), true);

const result = handlers.get('tabs.highlight')({}, { tabs: [2, 0], windowId: -2 });
assert.strictEqual(activeTab.id, 13, 'the first requested index must become active');
assert.deepStrictEqual(broadcasts.pop(), [
  'tabs.onHighlighted',
  { tabIds: [13, 11], windowId: 41 },
]);
assert.deepStrictEqual(
  tabs.map((tab) => ({
    active: details.get(tab.id).active,
    selected: details.get(tab.id).selected,
    highlighted: details.get(tab.id).highlighted,
  })),
  [
    { active: false, selected: false, highlighted: true },
    { active: false, selected: false, highlighted: false },
    { active: true, selected: true, highlighted: true },
  ],
);
assert.strictEqual(result.focused, false);
assert.strictEqual(result.state, 'maximized');
assert.strictEqual(result.alwaysOnTop, true);
assert.deepStrictEqual(
  [result.left, result.top, result.width, result.height],
  [100, 200, 1200, 800],
);

const [activeResult] = handlers.get('tabs.query')({}, { active: true });
assert.strictEqual(activeResult.id, 13);
assert.strictEqual(activeResult.index, 2, 'tabs.query must preserve the window index');
assert.strictEqual(activeResult.selected, true, 'selected must remain an alias for active');

console.log('tabs.highlight regression tests passed');
