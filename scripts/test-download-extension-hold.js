const assert = require('assert');
const fs = require('fs');
const path = require('path');
const typescript = require('typescript');

const filename = path.resolve(
  __dirname,
  '../src/vendor/electron-chrome-extensions/browser/api/downloads.ts',
);
const output = typescript.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: {
    module: typescript.ModuleKind.CommonJS,
    target: typescript.ScriptTarget.ES2019,
  },
}).outputText;

const holdTimers = [];
const fakeSetTimeout = (callback, delay) => {
  if (delay === 2000) holdTimers.push(callback);
  return { unref() {} };
};

const requireMock = (request) => {
  if (request === 'electron') {
    return {
      app: { getPath: () => 'C:\\Downloads' },
      net: {},
      shell: {},
    };
  }
  if (request === '../context' || request === '../router') return {};
  return require(request);
};

const loaded = { exports: {} };
new Function('require', 'module', 'exports', 'setTimeout', output)(
  requireMock,
  loaded,
  loaded.exports,
  fakeSetTimeout,
);

const { DownloadsAPI } = loaded.exports;

const flushImmediate = () => new Promise((resolve) => setImmediate(resolve));

const createNativeItem = ({ synchronousCancel = false } = {}) => {
  let paused = false;
  let state = 'progressing';
  const listeners = new Map();
  const onceListeners = new Map();
  return {
    pauseCalls: 0,
    resumeCalls: 0,
    getURL: () => 'https://example.test/archive.zip',
    getURLChain: () => [],
    getFilename: () => 'archive.zip',
    getTotalBytes: () => 1024,
    getMimeType: () => 'application/zip',
    getReceivedBytes: () => 0,
    getState: () => state,
    getSavePath: () => 'C:\\Downloads\\archive.zip',
    isPaused: () => paused,
    isDestroyed: () => false,
    pause() {
      paused = true;
      this.pauseCalls++;
    },
    resume() {
      paused = false;
      this.resumeCalls++;
    },
    canResume: () => false,
    on(name, callback) { listeners.set(name, callback); },
    once(name, callback) { onceListeners.set(name, callback); },
    emitUpdated(nextState) {
      state = nextState;
      listeners.get('updated')?.({}, nextState);
    },
    emitDone(nextState) {
      state = nextState;
      const callback = onceListeners.get('done');
      onceListeners.delete('done');
      callback?.({}, nextState);
    },
    cancel() {
      state = 'cancelled';
      if (synchronousCancel) this.emitDone('cancelled');
    },
  };
};

const createApi = ({ created = false, determining = false } = {}) => {
  let willDownload;
  const broadcasts = [];
  const handlers = new Map();
  const ctx = {
    router: {
      apiHandler: () => (name, callback) => handlers.set(name, callback),
      hasListeners: (name) =>
        name === 'downloads.onCreated'
          ? created
          : name === 'downloads.onDeterminingFilename'
            ? determining
            : false,
      broadcastEvent: (name, ...args) => broadcasts.push([name, ...args]),
    },
    session: {
      on: (name, callback) => {
        if (name === 'will-download') willDownload = callback;
      },
    },
  };
  const api = new DownloadsAPI(ctx);
  return { api, broadcasts, handlers, willDownload };
};

(async () => {
  {
    const { willDownload, broadcasts } = createApi({ created: true });
    const nativeItem = createNativeItem();
    willDownload({ defaultPrevented: false }, nativeItem, {});
    await flushImmediate();
    assert.strictEqual(nativeItem.pauseCalls, 0, 'onCreated observers must not delay downloads');
    assert.strictEqual(broadcasts[0][0], 'downloads.onCreated');
  }

  {
    const { willDownload, broadcasts } = createApi({ determining: true });
    const nativeItem = createNativeItem();
    willDownload({ defaultPrevented: true }, nativeItem, {});
    await flushImmediate();
    assert.strictEqual(nativeItem.pauseCalls, 0, 'defaultPrevented downloads must not be paused');
    assert.strictEqual(broadcasts.length, 0, 'host-handled downloads must not be advertised');
  }

  {
    const { api, willDownload } = createApi({ determining: true });
    const nativeItem = createNativeItem();
    willDownload({ defaultPrevented: false }, nativeItem, {});
    await flushImmediate();
    assert.strictEqual(nativeItem.pauseCalls, 1, 'intercepting extensions should get a hold window');
    api.items.clear();
    holdTimers.shift()();
    assert.strictEqual(nativeItem.resumeCalls, 1, 'erasing metadata must not strand a paused download');
  }

  {
    const { handlers, willDownload, broadcasts } = createApi();
    const nativeItem = createNativeItem();
    willDownload({ defaultPrevented: false }, nativeItem, {});
    await flushImmediate();
    nativeItem.emitUpdated('interrupted');
    nativeItem.emitDone('interrupted');

    const changes = broadcasts
      .filter(([name]) => name === 'downloads.onChanged')
      .map(([, delta]) => delta);
    const errors = changes.filter((delta) => delta.error);
    assert.strictEqual(errors.length, 1, 'native interruption must publish its error once');
    assert.deepStrictEqual(errors[0].error, { current: 'NETWORK_FAILED' });
    assert.deepStrictEqual(errors[0].state, { previous: 'in_progress', current: 'interrupted' });
    const [result] = await handlers.get('downloads.search')({}, { id: 1 });
    assert.strictEqual(result.error, 'NETWORK_FAILED', 'search must retain the interrupt reason');
  }

  {
    const { handlers, willDownload, broadcasts } = createApi();
    const nativeItem = createNativeItem({ synchronousCancel: true });
    willDownload({ defaultPrevented: false }, nativeItem, {});
    await flushImmediate();
    assert.strictEqual(handlers.get('downloads.cancel')({}, 1), true);

    const changes = broadcasts
      .filter(([name]) => name === 'downloads.onChanged')
      .map(([, delta]) => delta);
    const errors = changes.filter((delta) => delta.error);
    assert.strictEqual(errors.length, 1, 'cancel must publish its error once');
    assert.deepStrictEqual(errors[0].error, { current: 'USER_CANCELED' });
    assert.strictEqual(
      changes.some((delta) => delta.error?.current === 'NETWORK_FAILED'),
      false,
      'synchronous native cancellation must not be reported as a network failure',
    );
  }

  console.log('download extension hold regression tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
