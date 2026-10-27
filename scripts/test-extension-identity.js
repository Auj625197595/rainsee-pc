const assert = require('assert');
const {EventEmitter} = require('events');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

class FakeWebContents extends EventEmitter {
  constructor() {
    super();
    this.url = 'about:blank';
  }

  getURL() {
    return this.url;
  }
}

class FakeBrowserWindow extends EventEmitter {
  static instances = [];
  static nextLoad = () => new Promise(() => {});

  constructor(options) {
    super();
    this.id = FakeBrowserWindow.instances.length + 1;
    this.options = options;
    this.webContents = new FakeWebContents();
    this.destroyed = false;
    FakeBrowserWindow.instances.push(this);
  }

  isVisible() {
    return Boolean(this.options.show);
  }

  show() {}

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    this.destroyed = true;
  }

  loadURL(url) {
    this.webContents.url = url;
    return FakeBrowserWindow.nextLoad(this, url);
  }
}

function loadIdentityAPI() {
  const filename = path.resolve(
    __dirname,
    '../src/vendor/electron-chrome-extensions/browser/api/identity.ts',
  );
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
    },
    fileName: filename,
  }).outputText;
  const loaded = {exports: {}};
  const localRequire = (request) => {
    if (request === 'electron') return {BrowserWindow: FakeBrowserWindow};
    if (request === 'debug') return () => () => {};
    if (request === '../context' || request === '../router') return {};
    return require(request);
  };
  new Function('require', 'module', 'exports', output)(
    localRequire,
    loaded,
    loaded.exports,
  );
  return loaded.exports.IdentityAPI;
}

function createHandler(IdentityAPI) {
  const handlers = {};
  const ctx = {
    session: {partition: 'persist:test'},
    router: {
      apiHandler() {
        return (name, handler) => {
          handlers[name] = handler;
        };
      },
    },
  };
  new IdentityAPI(ctx);
  return handlers['identity.launchWebAuthFlow'];
}

const extensionEvent = {
  extension: {id: 'abcdefghijklmnopabcdefghijklmnop', name: 'Fixture'},
};

async function main() {
  const IdentityAPI = loadIdentityAPI();
  const launch = createHandler(IdentityAPI);

  FakeBrowserWindow.nextLoad = () => new Promise(() => {});
  const success = launch(extensionEvent, {
    url: 'https://accounts.example.test/authorize?state=secret',
    interactive: true,
  });
  const successWindow = FakeBrowserWindow.instances.at(-1);
  let prevented = false;
  const redirect =
    'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/callback?code=secret';
  successWindow.webContents.emit(
    'will-redirect',
    {preventDefault() { prevented = true; }},
    redirect,
  );
  assert.strictEqual(await success, redirect);
  assert.strictEqual(prevented, true);
  assert.strictEqual(successWindow.destroyed, true);

  FakeBrowserWindow.nextLoad = () => new Promise(() => {});
  const closed = launch(extensionEvent, {
    url: 'https://accounts.example.test/authorize',
    interactive: true,
  });
  FakeBrowserWindow.instances.at(-1).emit('closed');
  await assert.rejects(closed, /did not approve access/);

  FakeBrowserWindow.nextLoad = () =>
    Promise.reject(Object.assign(new Error('ERR_ABORTED loading auth URL'), {
      code: 'ERR_ABORTED',
      errno: -3,
    }));
  await assert.rejects(
    launch(extensionEvent, {
      url: 'https://accounts.example.test/authorize',
      interactive: true,
    }),
    (error) => /ERR_ABORTED/.test(error.message) && !error.message.includes('authorize'),
  );

  let rejectInitialNavigation;
  FakeBrowserWindow.nextLoad = () => new Promise((_resolve, reject) => {
    rejectInitialNavigation = reject;
  });
  const redirected = launch(extensionEvent, {
    url: 'https://accounts.example.test/authorize',
    interactive: true,
  });
  const redirectedWindow = FakeBrowserWindow.instances.at(-1);
  redirectedWindow.webContents.emit(
    'will-redirect',
    {preventDefault() {}},
    'https://accounts.example.test/chooser',
    false,
    true,
  );
  rejectInitialNavigation(Object.assign(new Error('ERR_ABORTED'), {
    code: 'ERR_ABORTED',
    errno: -3,
  }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  redirectedWindow.webContents.emit(
    'will-redirect',
    {preventDefault() {}},
    redirect,
    false,
    true,
  );
  assert.strictEqual(await redirected, redirect);

  let attempts = 0;
  FakeBrowserWindow.nextLoad = () => {
    attempts++;
    if (attempts === 1) {
      return Promise.reject(Object.assign(new Error('ERR_CONNECTION_CLOSED'), {
        code: 'ERR_CONNECTION_CLOSED',
        errno: -100,
      }));
    }
    return new Promise(() => {});
  };
  const retrying = launch(extensionEvent, {
    url: 'https://accounts.example.test/authorize',
    interactive: true,
  });
  const retryWindow = FakeBrowserWindow.instances.at(-1);
  await Promise.resolve();
  retryWindow.webContents.url = 'chrome-error://chromewebdata/';
  retryWindow.webContents.emit('did-finish-load');
  await new Promise((resolve) => setTimeout(resolve, 320));
  assert.strictEqual(attempts, 2);
  retryWindow.emit('closed');
  await assert.rejects(retrying, /did not approve access/);
}

main().then(
  () => console.log('extension identity regression tests passed'),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
