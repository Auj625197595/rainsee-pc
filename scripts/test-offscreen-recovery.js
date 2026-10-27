const assert = require('assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

class MockWebContents extends EventEmitter {
  constructor(preferences) {
    super();
    this.id = MockWebContents.nextId++;
    this.preferences = preferences;
    this.destroyed = false;
  }

  getLastWebPreferences() {
    return this.preferences;
  }

  isDestroyed() {
    return this.destroyed;
  }

  setWindowOpenHandler() {}

  async loadURL(url) {
    this.url = url;
    this.emit('did-start-loading');
    if (MockBrowserWindow.failNextBootstrap) {
      MockBrowserWindow.failNextBootstrap = false;
      this.emit(
        'console-message',
        {},
        {
          level: 3,
          message:
            "TypeError: Cannot destructure property 'preloadScripts' of 'binding.startupData' as it is null.",
          lineNumber: 2,
          sourceId: 'node:electron/js2c/sandbox_bundle',
        },
      );
    }
    this.emit('dom-ready');
    this.emit('did-finish-load');
  }
}

MockWebContents.nextId = 1;

class MockBrowserWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.destroyed = false;
    this.webContents = new MockWebContents(options.webPreferences);
    MockBrowserWindow.instances.push(this);
  }

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.webContents.destroyed = true;
    this.emit('closed');
  }
}

MockBrowserWindow.instances = [];
MockBrowserWindow.failNextBootstrap = false;

function loadOffscreenApi() {
  const filename = path.resolve(
    __dirname,
    '../src/vendor/electron-chrome-extensions/browser/api/offscreen.ts',
  );
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
    },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} };
  const localRequire = (request) => {
    if (request === 'electron') return { BrowserWindow: MockBrowserWindow };
    if (request === 'node:fs') return { existsSync: () => true };
    if (request === '../context' || request === '../router') return {};
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
  return loaded.exports.OffscreenAPI;
}

async function main() {
  const extensionId = 'offscreenrecoveryfixtureid';
  const handlers = new Map();
  const extensionListeners = new Map();
  const extension = {
    id: extensionId,
    path: 'fixture-extension',
    manifest: { permissions: ['offscreen'] },
  };
  const extensions = {
    getExtension(id) {
      return id === extensionId ? extension : undefined;
    },
    on(name, listener) {
      extensionListeners.set(name, listener);
    },
  };
  const context = {
    preloadPath: 'C:\\app\\build\\crx-preload.bundle.js',
    router: {
      apiHandler() {
        return (name, handler) => handlers.set(name, handler);
      },
    },
    session: {
      extensions,
      isPersistent: () => true,
    },
    store: { impl: {} },
  };

  const OffscreenAPI = loadOffscreenApi();
  new OffscreenAPI(context);

  assert.strictEqual(await context.offscreen.ensureDocument(extensionId), true);
  assert.strictEqual(MockBrowserWindow.instances.length, 1);
  const first = MockBrowserWindow.instances[0];
  assert.strictEqual(
    first.options.webPreferences.preload,
    path.join(
      path.dirname(context.preloadPath),
      'crx-offscreen-preload.bundle.js',
    ),
  );
  assert.strictEqual(first.options.webPreferences.sandbox, false);
  assert.strictEqual(first.options.webPreferences.contextIsolation, false);
  first.webContents.emit(
    'render-process-gone',
    {},
    {
      reason: 'crashed',
      exitCode: -2147483645,
    },
  );

  const recoveryStarted = Date.now();
  const lazyRecovery = context.offscreen.ensureDocument(extensionId);
  const explicitRecovery = handlers.get('offscreen.createDocument')(
    { extension },
    {
      url: 'offscreen.html',
      reasons: ['DOM_PARSER'],
      justification: 'recovery test',
    },
  );
  assert.deepStrictEqual(await Promise.all([lazyRecovery, explicitRecovery]), [
    true,
    undefined,
  ]);
  assert.ok(Date.now() - recoveryStarted >= 200);
  assert.strictEqual(MockBrowserWindow.instances.length, 2);
  assert.strictEqual(
    await handlers.get('offscreen.hasDocument')({ extension }),
    true,
  );
  assert.ok(extensionListeners.has('extension-unloaded'));

  extensionListeners.get('extension-unloaded')({}, extension);
  MockBrowserWindow.failNextBootstrap = true;
  assert.strictEqual(await context.offscreen.ensureDocument(extensionId), true);
  assert.strictEqual(MockBrowserWindow.instances.length, 3);
  assert.strictEqual(MockBrowserWindow.instances[2].destroyed, false);
  assert.strictEqual(
    await handlers.get('offscreen.hasDocument')({ extension }),
    true,
  );

  console.log('offscreen recovery tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
