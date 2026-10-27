const assert = require('assert');
const {EventEmitter} = require('events');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function loadNormalizer() {
  const filename = path.resolve(
    __dirname,
    '../src/vendor/electron-chrome-extensions/browser/api/window-create.ts',
  );
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
    },
    fileName: filename,
  }).outputText;
  const loaded = {exports: {}};
  new Function(
    'require',
    'module',
    'exports',
    '__filename',
    '__dirname',
    output,
  )(require, loaded, loaded.exports, filename, path.dirname(filename));
  return loaded.exports.normalizeWindowCreateData;
}

function loadExtensionStore() {
  const filename = path.resolve(
    __dirname,
    '../src/vendor/electron-chrome-extensions/browser/store.ts',
  );
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
    },
    fileName: filename,
  }).outputText;
  const loaded = {exports: {}};
  const localRequire = (request) => {
    if (request === 'electron') {
      return {
        BrowserWindow: {fromWebContents: () => null},
        webContents: {fromId: () => null},
      };
    }
    return require(request);
  };
  new Function(
    'require',
    'module',
    'exports',
    '__filename',
    '__dirname',
    output,
  )(localRequire, loaded, loaded.exports, filename, path.dirname(filename));
  return loaded.exports.ExtensionStore;
}

const normalizeWindowCreateData = loadNormalizer();
const event = {
  extension: {url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/'},
};

function rejects(details, pattern) {
  assert.throws(() => normalizeWindowCreateData(event, details), pattern);
}

const defaults = normalizeWindowCreateData(event, undefined);
assert.strictEqual(defaults.type, 'normal');
assert.strictEqual(defaults.url, undefined);

const relative = normalizeWindowCreateData(event, {
  type: 'popup',
  url: 'popup/index.html?uilocation=popout',
  width: 500,
  height: 650,
});
assert.strictEqual(relative.type, 'popup');
assert.strictEqual(
  relative.url,
  `${event.extension.url}popup/index.html?uilocation=popout`,
);

const multiple = normalizeWindowCreateData(event, {
  url: ['first.html', 'https://example.com/second'],
});
assert.deepStrictEqual(multiple.url, [
  `${event.extension.url}first.html`,
  'https://example.com/second',
]);

const movedTab = normalizeWindowCreateData(event, {tabId: 42});
assert.strictEqual(movedTab.tabId, 42);

rejects({url: 'page.html', tabId: 42}, /cannot be combined/);
rejects({tabId: -1}, /Invalid tabId/);
rejects({type: 'devtools'}, /Invalid window type/);
rejects({state: 'devtools'}, /Invalid window state/);
rejects(
  {state: 'minimized', focused: false},
  /cannot be combined with focused: false/,
);
rejects(
  {state: 'fullscreen', focused: false},
  /cannot be combined with focused: false/,
);
rejects({url: 'javascript:window.close()'}, /Invalid URL/);
rejects({url: 'chrome://quit'}, /Invalid URL/);
rejects({width: 0}, /Invalid value for width/);
rejects({left: Number.NaN}, /Invalid value for left/);
rejects({state: 'maximized', left: 10}, /cannot be combined with bounds/);

const ExtensionStore = loadExtensionStore();
const store = new ExtensionStore({});
const nativeWindow = Object.assign(new EventEmitter(), {
  id: 7,
  isDestroyed: () => false,
});
let windowAddedCount = 0;
store.on('window-added', () => {
  windowAddedCount += 1;
});
store.addWindow(nativeWindow);
store.windows.delete(nativeWindow);
store.addWindow(nativeWindow);
assert.strictEqual(windowAddedCount, 1);
assert.strictEqual(nativeWindow.listenerCount('focus'), 1);

console.log('chrome.windows.create behavior tests passed');
