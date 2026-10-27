const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');

const ipcCalls = {
  on: [],
  handle: [],
  removeListener: [],
  removeHandler: [],
};
const fakeIpcMain = {
  on: (channel, listener) => ipcCalls.on.push({channel, listener}),
  handle: (channel, handler) => ipcCalls.handle.push({channel, handler}),
  removeListener: (channel, listener) =>
    ipcCalls.removeListener.push({channel, listener}),
  removeHandler: (channel) => ipcCalls.removeHandler.push(channel),
};

const trackedSource = read('src/main/services/tracked-ipc.ts');
const trackedJs = ts.transpileModule(trackedSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2019,
  },
}).outputText;
const trackedModule = {exports: {}};
const mockRequire = (name) => {
  if (name === 'electron') return {ipcMain: fakeIpcMain};
  return require(name);
};
new Function('require', 'module', 'exports', trackedJs)(
  mockRequire,
  trackedModule,
  trackedModule.exports,
);

const {TrackedIpcMain} = trackedModule.exports;
const tracker = new TrackedIpcMain();
const listener = () => {};
const handler = () => true;
tracker.on('listener-channel', listener);
tracker.handle('handler-channel', handler);

assert.deepStrictEqual(ipcCalls.on, [
  {channel: 'listener-channel', listener},
]);
assert.deepStrictEqual(ipcCalls.handle, [
  {channel: 'handler-channel', handler},
]);

tracker.dispose();
tracker.dispose();
tracker.on('late-listener', listener);
tracker.handle('late-handler', handler);

assert.deepStrictEqual(ipcCalls.removeListener, [
  {channel: 'listener-channel', listener},
]);
assert.deepStrictEqual(ipcCalls.removeHandler, ['handler-channel']);
assert.strictEqual(ipcCalls.on.length, 1);
assert.strictEqual(ipcCalls.handle.length, 1);

const messaging = read('src/main/services/messaging.ts');
assert.match(messaging, /const ipcMain = new TrackedIpcMain\(\)/);
assert.match(messaging, /appWindow\.win\.once\('closed',[\s\S]*ipcMain\.dispose\(\)/);
assert.match(messaging, /const globalIpc = new TrackedIpcMain\(\)/);
assert.doesNotMatch(messaging, /ipcMain\.removeHandler\('credentials-get-password'/);

const viewManager = read('src/main/view-manager.ts');
assert.match(viewManager, /private ownsIpcSender\(/);
assert.match(
  viewManager,
  /ipc\.on\('open-dev-tool',[\s\S]*ownsIpcSender\(e\.sender\)/,
);
assert.match(
  viewManager,
  /ipc\.on\('change-zoom',[\s\S]*ownsIpcSender\(e\.sender\)/,
);
assert.match(
  viewManager,
  /ipc\.on\('reset-zoom',[\s\S]*ownsIpcSender\(e\.sender\)/,
);

const view = read('src/main/view.ts');
assert.match(view, /mainFrame\.framesInSubtree/);
assert.doesNotMatch(view, /framesCache\.(push|some)/);
assert.match(view, /private rememberVideoUrl\(/);
assert.match(view, /videoUrls = this\.videoUrls\.filter/);
assert.match(view, /videoMeta\.delete\(evicted\)/);

const appWindow = read('src/main/windows/app.ts');
assert.match(appWindow, /this\.ipc\.on\(dragResizeChannel/);
assert.doesNotMatch(appWindow, /ipcMain\.on\(dragResizeChannel/);

console.log('memory lifecycle regression tests passed');
