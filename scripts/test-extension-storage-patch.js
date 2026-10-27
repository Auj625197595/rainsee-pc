const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

function loadPatcher() {
  const filename = path.resolve(
    __dirname,
    '../src/main/extension-storage-patch.ts',
  );
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
    },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} };
  const localRequire = (request) => {
    if (request.endsWith('/runtime-context-type')) {
      return { RUNTIME_CONTEXT_TYPE: {} };
    }
    return require(request);
  };
  const evaluate = new Function(
    'require',
    'module',
    'exports',
    '__filename',
    '__dirname',
    output,
  );
  evaluate(
    localRequire,
    loaded,
    loaded.exports,
    filename,
    path.dirname(filename),
  );
  return loaded.exports;
}

const { isExtensionStoragePatched, patchExtensionStorage } = loadPatcher();
const markerPattern = /\/\*__crx_storage_sync_shim_[^*]*\*\//g;

async function createFixture(root, name, source) {
  const dir = path.join(root, name);
  await fs.promises.mkdir(dir);
  await fs.promises.writeFile(
    path.join(dir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name,
      version: '1.0.0',
      background: { service_worker: 'background.js' },
    }),
    'utf8',
  );
  await fs.promises.writeFile(path.join(dir, 'background.js'), source, 'utf8');
  return dir;
}

async function readPatched(dir) {
  await patchExtensionStorage(dir);
  return fs.promises.readFile(path.join(dir, 'background.js'), 'utf8');
}

function createEvent() {
  const listeners = [];
  return {
    addListener(listener) {
      listeners.push(listener);
    },
    removeListener(listener) {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
    emit(...args) {
      for (const listener of [...listeners]) listener(...args);
    },
  };
}

function createBrowserNamespaceContext(manifestVersion, browser, options = {}) {
  const chrome = {
    runtime: {
      id: 'browsernamespacefixtureid',
      onMessage: createEvent(),
      onConnect: createEvent(),
      getManifest() {
        return {
          manifest_version: manifestVersion,
          name: 'browser-namespace-fixture',
          ...(options.devtoolsPage ? {devtools_page: 'devtools.html'} : {}),
        };
      },
    },
  };
  const context = {
    chrome,
    location: {
      protocol: 'chrome-extension:',
      href: 'chrome-extension://browsernamespacefixtureid/background.js',
      hash: '',
    },
    console: {log() {}, warn() {}, error() {}},
    navigator: {
      userAgent: `Mozilla/5.0 Chrome/${options.chromeMajor || 150}.0.0.0`,
    },
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
    setInterval() {
      return 1;
    },
    clearInterval() {},
  };
  if (browser !== undefined) context.browser = browser;
  context.self = context;
  return context;
}

function simulateWebextensionPolyfillBootstrap(context) {
  // webextension-polyfill returns the host browser object unchanged when a
  // usable browser.runtime already exists; otherwise it wraps chrome.
  if (context.browser && context.browser.runtime && context.browser.runtime.id) {
    return false;
  }
  context.browser = {runtime: context.chrome.runtime};
  return true;
}

function verifyBrowserNamespace(source) {
  const nativeBrowser = {runtime: {}, tabs: {native: true}};
  const nativeMv3 = createBrowserNamespaceContext(3, nativeBrowser);
  vm.runInNewContext(source, nativeMv3);
  assert.strictEqual(nativeMv3.browser, nativeBrowser);
  assert.strictEqual(nativeMv3.browser.runtime, nativeMv3.chrome.runtime);
  assert.strictEqual(nativeMv3.browser.tabs, nativeMv3.chrome.tabs);
  for (const key of Object.getOwnPropertyNames(nativeMv3.chrome)) {
    if (key.startsWith('__crx')) continue;
    assert.strictEqual(
      nativeMv3.browser[key],
      nativeMv3.chrome[key],
      `browser.${key} must be the same API object as chrome.${key}`,
    );
  }
  assert.strictEqual(simulateWebextensionPolyfillBootstrap(nativeMv3), false);

  const missingMv3 = createBrowserNamespaceContext(3);
  vm.runInNewContext(source, missingMv3);
  assert.strictEqual(missingMv3.browser, missingMv3.chrome);
  assert.strictEqual(missingMv3.browser.tabs, missingMv3.chrome.tabs);
  assert.strictEqual(simulateWebextensionPolyfillBootstrap(missingMv3), false);

  const missingMv2 = createBrowserNamespaceContext(2);
  vm.runInNewContext(source, missingMv2);
  assert.strictEqual(missingMv2.browser, undefined);

  // Chrome 148-151 disables browser for the entire extension when a DevTools
  // page is declared. Keeping it absent lets webextension-polyfill wrap chrome.
  const devtoolsChrome150 = createBrowserNamespaceContext(3, undefined, {
    chromeMajor: 150,
    devtoolsPage: true,
  });
  vm.runInNewContext(source, devtoolsChrome150);
  assert.strictEqual(devtoolsChrome150.browser, undefined);
  assert.strictEqual(simulateWebextensionPolyfillBootstrap(devtoolsChrome150), true);

  const devtoolsChrome152 = createBrowserNamespaceContext(3, undefined, {
    chromeMajor: 152,
    devtoolsPage: true,
  });
  vm.runInNewContext(source, devtoolsChrome152);
  assert.strictEqual(devtoolsChrome152.browser, devtoolsChrome152.chrome);
  assert.strictEqual(simulateWebextensionPolyfillBootstrap(devtoolsChrome152), false);
}

async function brokerRequest(
  runtimeOnConnect,
  { message, sender, senderUrl, mid = 'broker-test', name = 'crxreq-test' },
) {
  const responses = [];
  const port = {
    name,
    sender,
    onMessage: createEvent(),
    onDisconnect: createEvent(),
    postMessage(response) {
      responses.push(response);
    },
  };
  runtimeOnConnect.emit(port);
  port.onMessage.emit({
    __crxBrokerReq: true,
    mid,
    message,
    senderUrl,
  });
  for (let i = 0; i < 4; i++) await Promise.resolve();
  return {
    port,
    responses,
    response: responses.find((response) => response.mid === mid)?.response,
  };
}

function verifyHiddenPageAnimationFrameFallback(source) {
  const timers = new Map();
  let nextTimer = 1;
  let canceledNativeId;
  const context = {
    document: { visibilityState: 'hidden' },
    performance: { now: () => 123 },
    requestAnimationFrame() {
      return 77;
    },
    cancelAnimationFrame(id) {
      canceledNativeId = id;
    },
    setTimeout(callback) {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    console: { log() {}, warn() {}, error() {} },
  };
  context.window = context;

  vm.runInNewContext(source, context);
  assert.strictEqual(
    context.__rainseeHiddenPageAnimationFrameFallbackInstalled,
    1,
  );

  let timestamp;
  context.requestAnimationFrame((value) => {
    timestamp = value;
  });
  assert.strictEqual(timers.size, 1);
  [...timers.values()][0]();
  assert.strictEqual(timestamp, 123);

  let canceledCallbackRan = false;
  const canceledId = context.requestAnimationFrame(() => {
    canceledCallbackRan = true;
  });
  context.cancelAnimationFrame(canceledId);
  assert.strictEqual(canceledNativeId, 77);
  assert.strictEqual(canceledCallbackRan, false);
  assert.strictEqual(timers.size, 0);
}

async function verifyIdentityContract(source) {
  const completions = [];
  const runtime = {
    id: 'identityfixtureidentityfixtureid',
    onMessage: createEvent(),
    onConnect: createEvent(),
    getManifest() {
      return {
        manifest_version: 3,
        name: 'identity-fixture',
        version: '1.0.0',
        permissions: ['identity'],
      };
    },
    getURL(value = '') {
      return `chrome-extension://${this.id}/${String(value).replace(/^\/+/, '')}`;
    },
  };
  const context = {
    chrome: {runtime},
    electron: {
      launchIdentityWebAuthFlow(_id, _details, complete) {
        completions.push(complete);
      },
    },
    console: {log() {}, warn() {}, error() {}},
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
    setInterval() {
      return 1;
    },
    clearInterval() {},
  };
  context.self = context;
  vm.runInNewContext(source, context);

  assert.strictEqual(
    context.chrome.identity.getRedirectURL('/callback'),
    `https://${runtime.id}.chromiumapp.org/callback`,
  );

  const rejected = context.chrome.identity.launchWebAuthFlow({
    url: 'https://accounts.example.test/authorize',
    interactive: true,
  });
  completions.shift()({ok: false, error: 'access denied'});
  await assert.rejects(rejected, /access denied/);

  let callbackValue = 'not-called';
  let callbackError;
  const callbackReturn = context.chrome.identity.launchWebAuthFlow(
    {url: 'https://accounts.example.test/authorize', interactive: true},
    (value) => {
      callbackValue = value;
      callbackError = context.chrome.runtime.lastError?.message;
    },
  );
  assert.strictEqual(callbackReturn, undefined);
  completions.shift()({ok: false, error: 'user cancelled'});
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(callbackValue, undefined);
  assert.strictEqual(callbackError, 'user cancelled');
  assert.strictEqual(context.chrome.runtime.lastError, undefined);

  const successUrl = `https://${runtime.id}.chromiumapp.org/?code=ok`;
  const resolved = context.chrome.identity.launchWebAuthFlow({
    url: 'https://accounts.example.test/authorize',
    interactive: true,
  });
  completions.shift()({ok: true, value: successUrl});
  assert.strictEqual(await resolved, successUrl);

  const emptyResult = context.chrome.identity.launchWebAuthFlow({
    url: 'https://accounts.example.test/authorize',
    interactive: true,
  });
  completions.shift()({ok: true, value: ''});
  await assert.rejects(emptyResult, /no redirect URL/);
}

async function verifyPagePortReconnect(source) {
  const ports = [];
  const runtimeOnMessage = createEvent();
  const runtimeOnConnect = createEvent();
  const runtime = {
    id: 'reconnectfixtureid',
    onMessage: runtimeOnMessage,
    onConnect: runtimeOnConnect,
    connect({ name }) {
      const port = {
        name,
        messages: [],
        onMessage: createEvent(),
        onDisconnect: createEvent(),
        postMessage(message) {
          this.messages.push(message);
        },
        disconnect() {},
      };
      ports.push(port);
      return port;
    },
    getURL(value = '') {
      return `chrome-extension://reconnectfixtureid/${String(value).replace(
        /^\/+/,
        '',
      )}`;
    },
    getManifest() {
      return { manifest_version: 3, name: 'reconnect', version: '1.0.0' };
    },
    sendMessage() {
      return Promise.resolve(undefined);
    },
  };
  const context = {
    chrome: { runtime },
    console: { log() {}, warn() {}, error() {} },
    history: { state: null, replaceState() {} },
    location: {
      protocol: 'chrome-extension:',
      origin: 'chrome-extension://reconnectfixtureid',
      pathname: '/sidepanel.html',
      search: '',
      hash: '',
    },
    navigator: { language: 'en-US' },
    setTimeout,
    clearTimeout,
    __crxTabs: [{ id: 12, active: true, windowId: 1, url: 'https://example.test/' }],
  };
  context.window = context;

  vm.runInNewContext(source, context);
  assert.strictEqual(ports.length, 1);
  assert.strictEqual(context.__crxPageListenArmed, true);

  let delivered;
  runtime.onMessage.addListener((message) => {
    if (message?.type === 'probe') delivered = message.seq;
  });
  context.__crxPageEventSubscribe('tabs.onUpdated');
  assert.ok(
    ports[0].messages.some(
      (message) =>
        message.__crxPageEventSubscribe &&
        message.eventName === 'tabs.onUpdated',
    ),
  );

  // A broker ACK marks every connection as healthy. More than eight ordinary
  // MV3 worker idle-stop cycles must therefore keep reconnecting.
  ports[0].onMessage.emit({ __crxPageListenReady: true });
  for (let cycle = 0; cycle < 9; cycle++) {
    ports[cycle].onDisconnect.emit();
    assert.strictEqual(context.__crxPageListenArmed, false);
    await new Promise((resolve) => setTimeout(resolve, 180));
    assert.strictEqual(ports.length, cycle + 2);
    assert.strictEqual(context.__crxPageListenArmed, true);
    assert.ok(
      ports[cycle + 1].messages.some(
        (message) =>
          message.__crxPageEventSubscribe &&
          message.eventName === 'tabs.onUpdated',
      ),
    );
    ports[cycle + 1].onMessage.emit({ __crxPageListenReady: true });
  }

  ports[9].onMessage.emit({
    message: { type: 'probe', seq: 7 },
    sender: { id: runtime.id },
  });
  assert.strictEqual(delivered, 7);
  assert.strictEqual(await context.chrome.tabs.getCurrent(), undefined);
  assert.strictEqual((await context.chrome.tabs.query({ active: true }))[0].id, 12);
}

async function verifyBrokerGetCurrentContext(source) {
  const runtimeOnMessage = createEvent();
  const runtimeOnConnect = createEvent();
  const forwarded = [];
  let rejectGet = false;
  const liveTab = { id: 21, windowId: 3, active: true, title: 'Live title' };
  const context = {
    chrome: {
      runtime: {
        id: 'getcurrentfixtureid',
        onMessage: runtimeOnMessage,
        onConnect: runtimeOnConnect,
        getManifest() {
          return { manifest_version: 3, name: 'get-current', version: '1.0.0' };
        },
      },
    },
    electron: {
      invokeExtensionRaw(id, method, _options, tabId) {
        forwarded.push({ id, method, tabId });
        if (rejectGet) return Promise.reject(new Error('transport unavailable'));
        return Promise.resolve(liveTab);
      },
    },
    console: { log() {}, warn() {}, error() {} },
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
    setInterval() {
      return 1;
    },
    clearInterval() {},
  };
  context.self = context;
  vm.runInNewContext(source, context);

  const request = async (sender) =>
    (
      await brokerRequest(runtimeOnConnect, {
        name: 'crxreq-get-current',
        sender,
        message: {
          __crxApiRequest: true,
          method: 'tabs.getCurrent',
          args: [],
        },
      },
      )
    ).response;

  const ownTab = { id: 21, windowId: 3, active: false, title: 'Port snapshot' };
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(await request({ tab: ownTab }))),
    { __crxApiResponse: true, ok: true, value: liveTab },
  );
  assert.deepStrictEqual(forwarded, [
    { id: 'getcurrentfixtureid', method: 'tabs.get', tabId: ownTab.id },
  ]);

  rejectGet = true;
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(await request({ tab: ownTab }))),
    { __crxApiResponse: true, ok: true, value: ownTab },
  );

  const popupResponse = await request({ id: 'getcurrentfixtureid' });
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(popupResponse)),
    { __crxApiResponse: true, ok: true },
  );
  assert.strictEqual(Object.prototype.hasOwnProperty.call(popupResponse, 'value'), true);
  assert.strictEqual(popupResponse.value, undefined);
  assert.strictEqual(forwarded.length, 2);
}

async function verifyLockedNativeTabsCreateRoute(source) {
  const nativeCalls = [];
  const forwarded = [];
  const nativeCreate = (details) => {
    nativeCalls.push(details);
  };
  const tabs = {};
  // Electron can expose native API methods as accessors. A plain assignment is
  // then silently ignored in this non-strict shim, even though redefining the
  // configurable property is allowed. This reproduced the false "patched"
  // marker that left popup tabs.create on Electron's untracked tab model.
  Object.defineProperty(tabs, 'create', {
    get: () => nativeCreate,
    configurable: true,
    enumerable: true,
  });

  const runtime = {
    id: 'lockedtabsfixtureid',
    onMessage: createEvent(),
    onConnect: createEvent(),
    getManifest() {
      return { manifest_version: 3, name: 'locked-tabs', version: '1.0.0' };
    },
    getURL(value = '') {
      return `chrome-extension://lockedtabsfixtureid/${String(value).replace(
        /^\/+/,
        '',
      )}`;
    },
    sendMessage() {
      return Promise.resolve(undefined);
    },
  };
  const context = {
    chrome: { runtime, tabs },
    electron: {
      invokeExtensionRaw(id, method, _options, details) {
        forwarded.push({ id, method, details });
        if (method === 'tabs.create') {
          return Promise.resolve({
            id: 77,
            index: 1,
            active: true,
            windowId: 4,
            url: `chrome-extension://${id}/downloader.html?requestId=57117`,
          });
        }
        return Promise.resolve(undefined);
      },
      addExtensionListener() {},
    },
    console: { log() {}, warn() {}, error() {} },
    history: { state: null, replaceState() {} },
    location: {
      protocol: 'chrome-extension:',
      origin: 'chrome-extension://lockedtabsfixtureid',
      pathname: '/popup.html',
      search: '',
      hash: '',
    },
    navigator: { language: 'en-US' },
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
    setInterval() {
      return 1;
    },
    clearInterval() {},
  };
  context.window = context;
  context.self = context;

  vm.runInNewContext(source, context);
  assert.notStrictEqual(context.chrome.tabs.create, nativeCreate);
  assert.strictEqual(context.chrome.tabs.create.__crxIpcRoute, true);

  const created = await context.chrome.tabs.create({
    url: '/downloader.html?requestId=57117',
    index: 1,
    active: true,
  });
  assert.strictEqual(created.id, 77);
  assert.strictEqual(nativeCalls.length, 0);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(forwarded)), [
    {
      id: 'lockedtabsfixtureid',
      method: 'tabs.create',
      details: {
        url: '/downloader.html?requestId=57117',
        index: 1,
        active: true,
      },
    },
  ]);
}

async function verifyStorageMutationVisibilityBarrier(source) {
  const order = [];
  const localChanges = [];
  const globalChanges = [];
  let relayCalls = 0;
  const createArea = () => ({
    get() {
      return Promise.resolve({ account: 'old' });
    },
    set() {
      setTimeout(() => order.push('onChanged'), 0);
      return Promise.resolve().then(() => order.push('nativeResolved'));
    },
    onChanged: {
      dispatch(changes) {
        localChanges.push(changes);
      },
    },
  });
  const local = createArea();
  const session = createArea();
  const context = {
    chrome: {
      runtime: {
        sendMessage() {
          relayCalls++;
          return new Promise(() => {});
        },
      },
      storage: {
        local,
        session,
        onChanged: {
          dispatch(changes, area) {
            globalChanges.push({ changes, area });
          },
        },
      },
    },
    document: {},
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
  };

  vm.runInNewContext(source, context);
  await Promise.race([
    context.chrome.storage.session.set({ account: 'ready' }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('storage.set waited for relay')), 250),
    ),
  ]);
  order.push('callerContinued');

  assert.strictEqual(context.chrome.storage.sync, local);
  // Chrome without policy: storage.managed is empty and read-only, never local.
  const managed = context.chrome.storage.managed;
  assert.notStrictEqual(managed, local);
  assert.deepStrictEqual(Object.keys(await managed.get(null)), []);
  await assert.rejects(managed.set({ x: 1 }), /read-only/);
  assert.strictEqual(session.set.__crxVisibilityBarrier, true);
  assert.strictEqual(relayCalls, 1);
  assert.ok(order.indexOf('onChanged') < order.indexOf('callerContinued'));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(localChanges)), [
    { account: { oldValue: 'old', newValue: 'ready' } },
  ]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(globalChanges)), [
    {
      changes: { account: { oldValue: 'old', newValue: 'ready' } },
      area: 'session',
    },
  ]);
}

async function verifyStorageHydrationGuard(source) {
  const createContext = ({
    missing = false,
    emptyStore = false,
    specificLag = false,
    storageBytes = 1024,
  } = {}) => {
    let specificReads = 0;
    let fullReads = 0;
    let sizeReads = 0;
    const runtimeOnMessage = createEvent();
    const local = {
      get(keys) {
        if (keys === null) {
          fullReads++;
          if (emptyStore) return Promise.resolve({});
          if (missing) return Promise.resolve({ anotherKey: 'present' });
          if (specificLag) {
            return Promise.resolve({
              anotherKey: 'present',
              stateVersion: { value: 82 },
            });
          }
          return Promise.resolve(
            fullReads >= 2 ? { stateVersion: { value: 82 } } : {},
          );
        }
        specificReads++;
        return Promise.resolve({});
      },
      getBytesInUse() {
        sizeReads++;
        return Promise.resolve(storageBytes);
      },
      set() {
        return Promise.resolve();
      },
    };
    const context = {
      chrome: {
        runtime: { onMessage: runtimeOnMessage },
        storage: { local },
      },
      console: { log() {}, warn() {}, error() {} },
      setTimeout,
      clearTimeout,
    };
    context.self = context;
    vm.runInNewContext(source, context);
    return {
      context,
      local,
      runtimeOnMessage,
      reads: () => ({ specificReads, fullReads, sizeReads }),
    };
  };

  const promiseCase = createContext();
  const promiseResult = await promiseCase.context.chrome.storage.local.get(
    'stateVersion',
  );
  assert.deepStrictEqual(JSON.parse(JSON.stringify(promiseResult)), {
    stateVersion: { value: 82 },
  });
  assert.strictEqual(promiseCase.local.get.__crxHydrationGuard, true);
  assert.deepStrictEqual(promiseCase.reads(), {
    specificReads: 1,
    fullReads: 2,
    sizeReads: 2,
  });

  const callbackCase = createContext();
  const callbackResult = await new Promise((resolve) => {
    const returned = callbackCase.context.chrome.storage.local.get(
      ['stateVersion'],
      resolve,
    );
    assert.strictEqual(returned, undefined);
  });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(callbackResult)), {
    stateVersion: { value: 82 },
  });
  assert.deepStrictEqual(callbackCase.reads(), {
    specificReads: 1,
    fullReads: 2,
    sizeReads: 2,
  });

  // A relayed page write must repair a stale concrete-key read in a long-lived
  // worker without copying the full storage area.
  const specificLagCase = createContext({ specificLag: true });
  specificLagCase.context.__lateNow = () => Date.now() + 10000;
  vm.runInNewContext('Date.now = __lateNow', specificLagCase.context);
  specificLagCase.runtimeOnMessage.emit(
    {
      __crxStorageSyntheticChange: true,
      area: 'local',
      changes: { stateVersion: { newValue: { value: 82 } } },
    },
    {},
    () => {},
  );
  const specificLagResult = await specificLagCase.context.chrome.storage.local.get(
    'stateVersion',
  );
  assert.deepStrictEqual(JSON.parse(JSON.stringify(specificLagResult)), {
    stateVersion: { value: 82 },
  });
  assert.deepStrictEqual(specificLagCase.reads(), {
    specificReads: 1,
    fullReads: 0,
    sizeReads: 0,
  });

  const missingCase = createContext({ missing: true });
  const missingResult = await missingCase.context.chrome.storage.local.get(
    'missingKey',
  );
  assert.deepStrictEqual(missingResult, {});
  assert.deepStrictEqual(missingCase.reads(), {
    specificReads: 1,
    fullReads: 1,
    sizeReads: 1,
  });

  // A genuinely empty first-install store pays one shared, bounded probe. More
  // missing-key reads reuse it instead of each polling or reading the full area.
  const emptyCase = createContext({ emptyStore: true });
  const started = Date.now();
  const [firstEmpty, secondEmpty] = await Promise.all([
    emptyCase.context.chrome.storage.local.get('firstMissing'),
    emptyCase.context.chrome.storage.local.get('secondMissing'),
  ]);
  assert.deepStrictEqual(firstEmpty, {});
  assert.deepStrictEqual(secondEmpty, {});
  assert.ok(Date.now() - started < 500);
  assert.deepStrictEqual(emptyCase.reads(), {
    specificReads: 2,
    fullReads: 3,
    sizeReads: 3,
  });
  await emptyCase.context.chrome.storage.local.get('thirdMissing');
  assert.deepStrictEqual(emptyCase.reads(), {
    specificReads: 3,
    fullReads: 3,
    sizeReads: 3,
  });

  const largeStoreCase = createContext({ storageBytes: 32 * 1024 * 1024 });
  assert.deepStrictEqual(
    await largeStoreCase.context.chrome.storage.local.get('missingKey'),
    {},
  );
  assert.deepStrictEqual(largeStoreCase.reads(), {
    specificReads: 1,
    fullReads: 0,
    sizeReads: 1,
  });

  // Outside startup, an ordinary missing key never triggers get(null).
  const lateMissingCase = createContext({ emptyStore: true });
  const muchLater = Date.now() + 10000;
  vm.runInNewContext(`Date.now = () => ${muchLater}`, lateMissingCase.context);
  assert.deepStrictEqual(
    await lateMissingCase.context.chrome.storage.local.get('missingKey'),
    {},
  );
  assert.deepStrictEqual(lateMissingCase.reads(), {
    specificReads: 1,
    fullReads: 0,
    sizeReads: 0,
  });
}

async function verifyStorageSyntheticRelay(source) {
  const sent = [];
  const makeArea = (dispatched) => ({
    get() {
      return Promise.resolve({});
    },
    set() {
      return Promise.resolve();
    },
    onChanged: {
      dispatch(changes) {
        dispatched.push(changes);
      },
    },
  });

  const pageDispatched = [];
  const pageLocal = makeArea(pageDispatched);
  const pageContext = {
    chrome: {
      runtime: {
        id: 'storagefixtureid',
        sendMessage(message) {
          sent.push(message);
          return Promise.resolve({ __crxStorageSyntheticAck: true });
        },
      },
      storage: {
        local: pageLocal,
        onChanged: { dispatch() {} },
      },
    },
    document: {},
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(source, pageContext);
  await pageContext.chrome.storage.local.set({ activeAccountId: 'account-1' });
  const synthetic = sent.find((message) => message.__crxStorageSyntheticChange);
  assert.ok(synthetic);
  assert.strictEqual(synthetic.area, 'local');

  const workerDispatched = [];
  const workerOnMessage = createEvent();
  const workerContext = {
    chrome: {
      runtime: {
        id: 'storagefixtureid',
        onMessage: workerOnMessage,
      },
      storage: {
        local: makeArea(workerDispatched),
        onChanged: { dispatch() {} },
      },
    },
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
  };
  workerContext.self = workerContext;
  vm.runInNewContext(source, workerContext);
  let response;
  workerOnMessage.emit(synthetic, {}, (value) => {
    response = value;
  });

  assert.deepStrictEqual(JSON.parse(JSON.stringify(workerDispatched)), [
    { activeAccountId: { newValue: 'account-1' } },
  ]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(response)), {
    __crxStorageSyntheticAck: true,
  });
}

async function verifyBrokerExtensionPageSender(source) {
  const runtimeOnMessage = createEvent();
  const runtimeOnConnect = createEvent();
  const runtime = {
    id: 'senderfixtureid',
    onMessage: runtimeOnMessage,
    onConnect: runtimeOnConnect,
    getURL(value = '') {
      return `chrome-extension://senderfixtureid/${String(value).replace(
        /^\/+/,
        '',
      )}`;
    },
    getManifest() {
      return { manifest_version: 3, name: 'sender', version: '1.0.0' };
    },
    sendMessage() {
      return Promise.resolve(undefined);
    },
  };
  const context = {
    chrome: { runtime },
    console: { log() {}, warn() {}, error() {} },
    navigator: { language: 'en-US' },
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
    setInterval() {
      return 1;
    },
    clearInterval() {},
  };
  context.self = context;

  vm.runInNewContext(source, context);

  let publicConnects = 0;
  const publicConnectListener = () => {
    publicConnects++;
  };
  runtime.onConnect.addListener(publicConnectListener);
  assert.strictEqual(runtime.onConnect.hasListener(publicConnectListener), true);

  let sender;
  runtime.onMessage.addListener((_message, messageSender, sendResponse) => {
    sender = messageSender;
    sendResponse({ ok: true });
    return true;
  });

  const { response } = await brokerRequest(runtimeOnConnect, {
    name: 'crxreq-sender-test',
    mid: 'sender-test',
    message: { action: 'get_status' },
    senderUrl: 'chrome-extension://senderfixtureid/popup.html',
  });
  assert.strictEqual(publicConnects, 0);

  assert.ok(sender);
  assert.strictEqual(sender.id, runtime.id);
  assert.strictEqual(sender.url, 'chrome-extension://senderfixtureid/popup.html');
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(sender, 'tab'),
    false,
  );
  assert.deepStrictEqual(response, { ok: true });

  const pagePort = {
    name: 'crx-page-listen',
    onMessage: createEvent(),
    onDisconnect: createEvent(),
    messages: [],
    postMessage(message) {
      this.messages.push(message);
    },
  };
  runtime.onConnect.emit(pagePort);
  assert.strictEqual(publicConnects, 0);
  assert.ok(pagePort.messages.some((message) => message.__crxPageListenReady));

  runtime.onConnect.emit({ name: 'extension-public-port' });
  assert.strictEqual(publicConnects, 1);
  runtime.onConnect.removeListener(publicConnectListener);
  assert.strictEqual(runtime.onConnect.hasListener(publicConnectListener), false);
}

async function verifyPageBrokerUndefinedExtensionId(source) {
  const requests = [];
  const nativeCalls = [];
  const nativeConnectCalls = [];
  const runtime = {
    id: 'pagebrokerfixtureid',
    onMessage: createEvent(),
    onConnect: createEvent(),
    sendMessage(...args) {
      nativeCalls.push(args);
      return Promise.resolve(undefined);
    },
    connect(...args) {
      nativeConnectCalls.push(args);
      const onMessage = createEvent();
      return {
        onMessage,
        onDisconnect: createEvent(),
        disconnect() {},
        postMessage(request) {
          requests.push(request);
          onMessage.emit({
            __crxBrokerResp: true,
            mid: request.mid,
            response: { received: request.message },
          });
        },
      };
    },
  };
  const context = {
    chrome: { runtime },
    location: {
      protocol: 'chrome-extension:',
      origin: 'chrome-extension://pagebrokerfixtureid',
      pathname: '/options.html',
    },
    console: { log() {}, warn() {}, error() {} },
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
    setInterval() {
      return 1;
    },
    clearInterval() {},
  };
  context.window = context;
  context.self = context;
  vm.runInNewContext(source, context);

  // Ignore the broker's own subscription Ports created during bootstrap.
  nativeConnectCalls.length = 0;
  const normalizedPort = runtime.connect(undefined, { name: 'normalized' });
  assert.ok(normalizedPort && normalizedPort.onMessage);
  runtime.connect(undefined);
  runtime.connect(null, { name: 'invalid-null-preserved' });
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(nativeConnectCalls)),
    [[{ name: 'normalized' }], [], [null, { name: 'invalid-null-preserved' }]],
  );

  const callbackResponse = await new Promise((resolve) => {
    const returnValue = runtime.sendMessage(
      undefined,
      'SettingsPage_GetInitialData',
      undefined,
      resolve,
    );
    assert.strictEqual(returnValue, undefined);
  });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(callbackResponse)), {
    received: 'SettingsPage_GetInitialData',
  });

  const promiseResponse = await runtime.sendMessage(
    undefined,
    { command: 'options-request' },
    undefined,
  );
  assert.deepStrictEqual(JSON.parse(JSON.stringify(promiseResponse)), {
    received: { command: 'options-request' },
  });
  assert.deepStrictEqual(
    requests.map((request) => request.message),
    ['SettingsPage_GetInitialData', { command: 'options-request' }],
  );
  assert.strictEqual(nativeCalls.length, 0);
}

function verifyIframeOutboundRelay(source) {
  const topMessages = [];
  const top = {
    top: null,
    parent: null,
    frames: [],
    postMessage(message) {
      topMessages.push(message);
    },
  };
  top.top = top;
  const child = {
    top,
    parent: top,
    frames: [],
    addEventListener() {},
    postMessage() {
      throw new Error('iframe message must be promoted to top');
    },
  };
  top.frames.push(child);
  const runtime = {
    id: 'iframefixtureid',
    onMessage: createEvent(),
    onConnect: createEvent(),
    sendMessage() {
      return Promise.resolve(undefined);
    },
    connect() {
      return undefined;
    },
  };
  const context = {
    chrome: { runtime },
    window: child,
    self: child,
    location: { protocol: 'https:', href: 'https://frame.example/' },
    console: { log() {}, warn() {}, error() {} },
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
    setInterval() {
      return 1;
    },
    clearInterval() {},
  };
  vm.runInNewContext(source, context);
  runtime.sendMessage({ command: 'triggerAutofillScriptInjection' });
  assert.ok(topMessages.some((message) => message.__crxCsSend));
  const port = runtime.connect({ name: 'iframe-port' });
  assert.ok(topMessages.some((message) => message.__crxCSConnect));
  port.postMessage({ hello: 'world' });
  assert.ok(topMessages.some((message) => message.__crxCSPortOut));
  port.disconnect();
  assert.ok(topMessages.some((message) => message.__crxCSPortDisOut));
}

async function main() {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'rainsee-extension-patch-'),
  );
  try {
    const strictDir = await createFixture(
      root,
      'strict',
      '"use strict"\nglobalThis.__strictResult=(function(){return this===undefined})();\n',
    );
    const strictPatched = await readPatched(strictDir);
    assert.ok(strictPatched.startsWith('"use strict"\n'));
    const context = {};
    vm.runInNewContext(strictPatched, context);
    assert.strictEqual(context.__strictResult, true);

    const directivesDir = await createFixture(
      root,
      'directives',
      '/* lead */\n"custom";\n/* between */\n\'use strict\';\nglobalThis.__done=true;\n',
    );
    const directivesPatched = await readPatched(directivesDir);
    assert.ok(
      directivesPatched.indexOf('/*__crx_storage_sync_shim_') >
        directivesPatched.indexOf("'use strict';"),
    );
    assert.ok(
      directivesPatched.indexOf('/*__crx_storage_sync_shim_') <
        directivesPatched.indexOf('globalThis.__done'),
    );

    const plainDir = await createFixture(
      root,
      'plain',
      'globalThis.__plain=true;\n',
    );
    const plainPatched = await readPatched(plainDir);
    assert.ok(plainPatched.startsWith('/*__crx_storage_sync_shim_'));
    assert.ok(plainPatched.includes('var __crxWarn=function()'));
    assert.ok(!plainPatched.includes('console.warn'));
    verifyBrowserNamespace(plainPatched);
    await verifyStorageMutationVisibilityBarrier(plainPatched);
    await verifyStorageHydrationGuard(plainPatched);
    await verifyStorageSyntheticRelay(plainPatched);
    await verifyPagePortReconnect(plainPatched);
    await verifyBrokerGetCurrentContext(plainPatched);
    await verifyLockedNativeTabsCreateRoute(plainPatched);
    await verifyBrokerExtensionPageSender(plainPatched);
    await verifyPageBrokerUndefinedExtensionId(plainPatched);
    verifyIframeOutboundRelay(plainPatched);

    const identityDir = await createFixture(
      root,
      'identity',
      'globalThis.__identity=true;\n',
    );
    const identityManifestPath = path.join(identityDir, 'manifest.json');
    const identityManifest = JSON.parse(
      await fs.promises.readFile(identityManifestPath, 'utf8'),
    );
    identityManifest.permissions = ['identity'];
    await fs.promises.writeFile(
      identityManifestPath,
      JSON.stringify(identityManifest),
      'utf8',
    );
    const identityPatched = await readPatched(identityDir);
    assert.ok(!identityPatched.includes('mbepccofdnoepgicagpchfmafecckdam'));
    await verifyIdentityContract(identityPatched);

    const rootedDir = path.join(root, 'rooted-service-worker');
    await fs.promises.mkdir(path.join(rootedDir, 'js'), { recursive: true });
    await fs.promises.writeFile(
      path.join(rootedDir, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'rooted-service-worker',
        version: '1.0.0',
        background: { service_worker: '/js/background.js', type: 'module' },
      }),
      'utf8',
    );
    await fs.promises.writeFile(
      path.join(rootedDir, 'js', 'background.js'),
      "import './dependency.js';\nglobalThis.__rooted=true;\n",
      'utf8',
    );
    await patchExtensionStorage(rootedDir);
    const rootedPatched = await fs.promises.readFile(
      path.join(rootedDir, 'js', 'background.js'),
      'utf8',
    );
    assert.ok(rootedPatched.startsWith('/*__crx_storage_sync_shim_'));
    const moduleParse = ts.transpileModule(rootedPatched, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2020,
      },
      reportDiagnostics: true,
    });
    assert.strictEqual(
      (moduleParse.diagnostics || []).filter(
        (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
      ).length,
      0,
    );
    assert.strictEqual(await isExtensionStoragePatched(rootedDir), true);

    const firstPass = await readPatched(strictDir);
    const secondPass = await readPatched(strictDir);
    assert.strictEqual(secondPass, firstPass);
    assert.strictEqual((secondPass.match(markerPattern) || []).length, 1);
    assert.strictEqual(await isExtensionStoragePatched(strictDir), true);

    const stateFile = path.join(strictDir, '.crx_storage_patch');
    const currentState = await fs.promises.readFile(stateFile, 'utf8');
    assert.ok(currentState.endsWith(':3'));
    await fs.promises.writeFile(
      stateFile,
      currentState.split(':')[0],
      'utf8',
    );
    assert.strictEqual(await isExtensionStoragePatched(strictDir), false);
    await patchExtensionStorage(strictDir);
    assert.strictEqual(await isExtensionStoragePatched(strictDir), true);

    const legacyMarker = firstPass.replace(
      /\/\*__crx_storage_sync_shim_[^*]*\*\//,
      '/*__crx_storage_sync_shim_legacy__*/',
    );
    await fs.promises.writeFile(
      path.join(strictDir, 'background.js'),
      legacyMarker,
      'utf8',
    );
    const repatched = await readPatched(strictDir);
    assert.strictEqual((repatched.match(markerPattern) || []).length, 1);
    assert.ok(!repatched.includes('shim_legacy'));
    assert.ok(repatched.startsWith('"use strict"\n'));

    // Simulate a complete installation produced by an older browser build:
    // both its source marker/body and directory success record are stale.
    // The hash-derived state must make startup re-run the patcher and replace
    // the persisted shim, not trust the old successful installation forever.
    const persistedOldShim = repatched.replace(
      /\/\*__crx_storage_sync_shim_[^*]*\*\/\s*;?\s*\(function\s*\(\s*\)\s*\{[\s\S]*?\}\s*\)\s*\(\s*\)\s*;\r?\n/,
      '/*__crx_storage_sync_shim_oldbuild__*/;(function(){globalThis.__oldShim=true})();\n',
    );
    await fs.promises.writeFile(
      path.join(strictDir, 'background.js'),
      persistedOldShim,
      'utf8',
    );
    await fs.promises.writeFile(stateFile, 'oldbuildhash:3', 'utf8');
    assert.strictEqual(await isExtensionStoragePatched(strictDir), false);
    await patchExtensionStorage(strictDir);
    const upgradedPersisted = await fs.promises.readFile(
      path.join(strictDir, 'background.js'),
      'utf8',
    );
    assert.strictEqual((upgradedPersisted.match(markerPattern) || []).length, 1);
    assert.ok(!upgradedPersisted.includes('__oldShim'));
    assert.notStrictEqual(
      (await fs.promises.readFile(stateFile, 'utf8')).trim(),
      'oldbuildhash:3',
    );
    assert.strictEqual(await isExtensionStoragePatched(strictDir), true);

    const hashbangDir = await createFixture(
      root,
      'hashbang',
      '#!/usr/bin/env node\r\nglobalThis.__hashbang=true;\n',
    );
    const hashbangPatched = await readPatched(hashbangDir);
    assert.ok(
      hashbangPatched.startsWith(
        '#!/usr/bin/env node\r\n/*__crx_storage_sync_shim_',
      ),
    );
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
}

main().then(
  () => console.log('extension storage patch regression tests passed'),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
