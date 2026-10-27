const assert = require('assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ts = require('typescript');

function loadRouter(electron) {
  const filename = path.resolve(
    __dirname,
    '../src/vendor/electron-chrome-extensions/browser/router.ts',
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
    if (request === 'electron') return electron;
    if (request === './partition') return { resolvePartition: () => null };
    if (request === './safe-send') {
      return {
        sendToLiveMainFrame: (...args) =>
          typeof electron.sendFrame === 'function'
            ? electron.sendFrame(...args)
            : true,
      };
    }
    if (request === './api/common') return { matchesPattern: () => true };
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
  return loaded.exports.ExtensionRouter;
}

function loadMessaging(electron) {
  const filename = path.resolve(
    __dirname,
    '../src/vendor/electron-chrome-extensions/browser/api/messaging.ts',
  );
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
    },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} };
  const localRequire = (request) => {
    if (request === 'electron') return electron;
    if (request === '../safe-send') {
      return {
        sendToLiveFrame: () => true,
        sendToLiveMainFrame: () => true,
      };
    }
    if (request === './common') return { matchesPattern: () => true };
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
  return loaded.exports.MessagingAPI;
}

function loadDocumentIdleScheduler() {
  const filename = path.resolve(
    __dirname,
    '../src/vendor/electron-chrome-extensions/browser/api/document-idle.ts',
  );
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
    },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} };
  new Function(
    'require',
    'module',
    'exports',
    '__filename',
    '__dirname',
    output,
  )(require, loaded, loaded.exports, filename, path.dirname(filename));
  return loaded.exports.DocumentIdleScheduler;
}

function loadRuntimeState() {
  const filename = path.resolve(
    __dirname,
    '../src/main/extension-runtime-state.ts',
  );
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
    },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} };
  new Function(
    'require',
    'module',
    'exports',
    '__filename',
    '__dirname',
    output,
  )(require, loaded, loaded.exports, filename, path.dirname(filename));
  return loaded.exports;
}

async function main() {
  const DocumentIdleScheduler = loadDocumentIdleScheduler();
  const idleFrame = {};
  let idleToken = 1;
  let idleRuns = 0;
  const idleScheduler = new DocumentIdleScheduler(() => idleToken, 5);
  idleScheduler.schedule(idleFrame, () => idleRuns++);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.strictEqual(idleRuns, 1, 'document_idle must run when load never fires');

  idleScheduler.schedule(idleFrame, () => idleRuns++);
  idleToken++;
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.strictEqual(idleRuns, 1, 'a stale document_idle fallback must not cross navigation');

  idleScheduler.schedule(idleFrame, () => idleRuns++);
  idleScheduler.runNow(idleFrame, () => idleRuns++);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.strictEqual(idleRuns, 2, 'load must cancel a pending document_idle fallback');

  const app = new EventEmitter();
  const ipcMain = { handle() {}, on() {} };
  let frameOk = true;
  const ExtensionRouter = loadRouter({
    app,
    ipcMain,
    sendFrame: () => frameOk,
  });
  const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
  const extension = {
    id: extensionId,
    manifest: {
      manifest_version: 3,
      background: { service_worker: 'background.js' },
    },
  };
  const extensions = new EventEmitter();
  extensions.getExtension = (id) =>
    id === extensionId ? extension : undefined;

  const sent = [];
  const worker = {
    send(name, ...args) {
      sent.push({ name, args });
    },
  };
  const serviceWorkers = new EventEmitter();
  serviceWorkers.startWorkerForScope = async () => worker;
  serviceWorkers.getWorkerFromVersionID = () => null;
  const session = { extensions, serviceWorkers };
  const router = new ExtensionRouter(session);

  const details = { reason: 'install' };
  const queuedDelivery = router.sendEvent(
    extensionId,
    'runtime.onInstalled',
    details,
  );
  router.addListener(
    { type: 'service-worker', extensionId },
    extensionId,
    'runtime.onInstalled',
  );
  assert.strictEqual(await queuedDelivery, true);
  assert.deepStrictEqual(sent.shift(), {
    name: 'crx-runtime.onInstalled',
    args: [details],
  });

  router.addListener(
    { type: 'frame', extensionId, host: new EventEmitter() },
    extensionId,
    'runtime.onInstalled',
  );

  serviceWorkers.startWorkerForScope = async () => {
    throw new Error('worker unavailable');
  };
  frameOk = true;
  assert.strictEqual(
    await router.sendEvent(extensionId, 'runtime.onInstalled', details),
    false,
    'a frame success must not hide failed persistent worker delivery',
  );

  serviceWorkers.startWorkerForScope = async () => worker;
  frameOk = false;
  assert.strictEqual(
    await router.sendEvent(extensionId, 'runtime.onInstalled', details),
    true,
    'a closing temporary frame must not hide successful worker delivery',
  );
  assert.deepStrictEqual(sent.shift(), {
    name: 'crx-runtime.onInstalled',
    args: [details],
  });

  const bounded = [];
  for (let i = 0; i < 5; i++) {
    bounded.push(router.sendEvent(extensionId, 'runtime.onStartup', i));
  }
  let startupSettledFromFrame = false;
  void bounded[1].then(() => {
    startupSettledFromFrame = true;
  });
  router.addListener(
    { type: 'frame', extensionId, host: new EventEmitter() },
    extensionId,
    'runtime.onStartup',
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(
    startupSettledFromFrame,
    false,
    'a temporary frame must not consume a lifecycle event intended for a worker',
  );
  router.addListener(
    { type: 'service-worker', extensionId },
    extensionId,
    'runtime.onStartup',
  );
  assert.deepStrictEqual(
    await Promise.all(bounded),
    [false, true, true, true, true],
    'pending lifecycle queue must stay bounded',
  );
  assert.deepStrictEqual(
    sent.splice(0).map((item) => item.args[0]),
    [1, 2, 3, 4],
  );

  assert.strictEqual(
    await router.sendEvent(extensionId, 'tabs.onUpdated', 1),
    undefined,
    'ordinary hot-path events must not be queued',
  );

  // A running Chromium target is not yet a usable extension background. The
  // host must retain lifecycle events until the preload/main-world capability
  // handshake resolves, matching Chrome's event dispatch across an MV3 cold
  // start.
  let resolveWorkerReady;
  router.setServiceWorkerResolver(
    () =>
      new Promise((resolve) => {
        resolveWorkerReady = resolve;
      }),
  );
  const beforeReadyCount = sent.length;
  const readinessGated = router.sendEvent(
    extensionId,
    'runtime.onInstalled',
    { reason: 'update' },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(
    sent.length,
    beforeReadyCount,
    'events must not be sent while the worker bridge is only process-running',
  );
  resolveWorkerReady(worker);
  assert.strictEqual(await readinessGated, true);
  assert.deepStrictEqual(sent.pop(), {
    name: 'crx-runtime.onInstalled',
    args: [{ reason: 'update' }],
  });

  // MV3 connect is not complete until the worker explicitly accepts it. This
  // prevents a fast no-listener rejection from racing ahead of the caller's
  // disconnect listener and leaving a Port that can never make progress.
  const messagingIpc = { handle() {}, on() {} };
  const MessagingAPI = loadMessaging({
    BrowserWindow: class {},
    ipcMain: messagingIpc,
    webContents: { getAllWebContents: () => [] },
  });
  const messagingExtensions = new EventEmitter();
  messagingExtensions.getExtension = (id) =>
    id === extensionId ? extension : undefined;
  const messagingWorkers = new EventEmitter();
  let portWorker;
  let queriedPortWorker;
  let portWorkerRunning = false;
  messagingWorkers.getWorkerFromVersionID = (versionId) =>
    queriedPortWorker?.versionId === versionId ? queriedPortWorker : undefined;
  messagingWorkers.getAllRunning = () =>
    portWorkerRunning && queriedPortWorker
      ? {
          [queriedPortWorker.versionId]: {
            versionId: queriedPortWorker.versionId,
            scope: queriedPortWorker.scope,
          },
        }
      : {};
  const messagingContext = {
    session: {
      extensions: messagingExtensions,
      serviceWorkers: messagingWorkers,
    },
    router: {
      setServiceWorkerResolver() {},
      backgroundHostFor: () => undefined,
    },
    store: {
      tabs: new Set(),
      tabDetailsCache: new Map(),
      tabToWindow: new Map(),
      getTabIndex: () => -1,
    },
    dynamicContentScripts: {
      has: () => false,
    },
  };
  const messaging = new MessagingAPI(messagingContext);
  const overlapFrame = {
    parent: null,
    frameTreeNodeId: 1,
    framesInSubtree: [],
    url: 'https://example.test/',
  };
  overlapFrame.top = overlapFrame;
  overlapFrame.framesInSubtree = [overlapFrame];
  const overlapTab = {
    id: 9,
    mainFrame: overlapFrame,
    isDestroyed: () => false,
  };
  const overlapExtension = {
    ...extension,
    manifest: {
      ...extension.manifest,
      content_scripts: [{matches: ['<all_urls>']}],
    },
  };
  messagingContext.store.tabs.add(overlapTab);
  messagingContext.dynamicContentScripts.has = () => true;
  assert.strictEqual(
    messaging.contentScriptMessageChannel(overlapExtension, extensionId, overlapFrame),
    'crx-dynamic-cs-message',
    'a frame with manifest and dynamic receivers must receive one message',
  );
  messagingContext.dynamicContentScripts.has = () => false;
  assert.strictEqual(
    messaging.contentScriptMessageChannel(overlapExtension, extensionId, overlapFrame),
    'crx-cs-message',
    'a manifest-only frame must keep using the manifest channel',
  );
  assert.strictEqual(
    typeof messaging.runtimeContentScriptDeliveries,
    'undefined',
    'background runtime.sendMessage must not fan out to content scripts (Chrome semantics)',
  );
  const listenerRejection = messaging.sendMessageToFrame(
    overlapFrame,
    'crx-cs-message',
    {type: 'promise-rejection'},
    {id: extensionId},
  );
  const rejectionId = [...messaging.csResponses.keys()][0];
  messaging.onCsMessageResponse({}, rejectionId, undefined, 'listener promise rejected');
  await assert.rejects(
    listenerRejection,
    /listener promise rejected/,
    'runtime response routing must preserve rejected listener Promises',
  );
  const tabDeliveryChannels = [];
  messagingContext.store.getTabById = (id) =>
    id === overlapTab.id ? overlapTab : undefined;
  messagingContext.dynamicContentScripts.has = () => true;
  messaging.sendMessageToFrame = (_frame, channel) => {
    tabDeliveryChannels.push(channel);
    return Promise.resolve(undefined);
  };
  await messaging.sendMessageToTab(
    {extension: overlapExtension},
    overlapTab.id,
    {type: 'overlap-test'},
  );
  assert.deepStrictEqual(
    tabDeliveryChannels,
    ['crx-dynamic-cs-message'],
    'tabs.sendMessage must deliver once when manifest and dynamic receivers overlap',
  );
  const noReceiverExtension = {...extension, manifest: {...extension.manifest, content_scripts: []}};
  messagingContext.dynamicContentScripts.has = () => false;
  messagingContext.dynamicContentScripts.token = () => 0;
  const noReceiver = await messaging.sendMessageToTab(
    {extension: noReceiverExtension},
    overlapTab.id,
    {type: 'no-receiver'},
  );
  assert.deepStrictEqual(
    noReceiver,
    {__crxApiError: 'Could not establish connection. Receiving end does not exist.'},
    'tabs.sendMessage without a receiver must reject like Chrome',
  );
  messaging.markContentScriptInjected(
    {extension: noReceiverExtension},
    {tabId: overlapTab.id},
  );
  tabDeliveryChannels.length = 0;
  await messaging.sendMessageToTab(
    {extension: noReceiverExtension},
    overlapTab.id,
    {type: 'after-execute-script'},
  );
  assert.deepStrictEqual(
    tabDeliveryChannels,
    ['crx-cs-message'],
    'a frame reported by scripting.markInjected must be a receiver',
  );
  messagingContext.dynamicContentScripts.token = () => 1;
  assert.deepStrictEqual(
    await messaging.sendMessageToTab({extension: noReceiverExtension}, overlapTab.id, {type: 'after-nav'}),
    {__crxApiError: 'Could not establish connection. Receiving end does not exist.'},
    'an injected receiver must not survive navigation',
  );
  messagingContext.store.tabs.delete(overlapTab);
  let portWorkerDestroyed = false;
  let canonicalTaskCount = 0;
  let canonicalTaskEndCount = 0;
  let canonicalSendCount = 0;
  const canonicalSentChannels = [];
  const portWorkerIpc = new EventEmitter();
  portWorkerIpc.handle = () => {};
  portWorker = {
    versionId: 7,
    scope: `chrome-extension://${extensionId}/`,
    isDestroyed: () => portWorkerDestroyed,
    ipc: portWorkerIpc,
    startTask: () => {
      canonicalTaskCount++;
      return { end() { canonicalTaskEndCount++; } };
    },
    send(channel, payload) {
      canonicalSentChannels.push(channel);
      if (channel !== 'crx-runtime.onConnect') return;
      canonicalSendCount++;
      queueMicrotask(() => messaging.onPortAccept({}, payload.portId));
    },
  };
  let alternateTaskCount = 0;
  const alternateSentChannels = [];
  queriedPortWorker = {
    ...portWorker,
    startTask() {
      alternateTaskCount++;
      return { end() {} };
    },
    send(channel) {
      alternateSentChannels.push(channel);
    },
  };
  messagingWorkers.emit('running-status-changed', {
    runningStatus: 'starting',
    versionId: portWorker.versionId,
  });
  portWorkerIpc.emit(
    'crx-worker-ready',
    {
      serviceWorker: portWorker,
    },
    { protocol: 1 },
  );
  assert.strictEqual(
    messaging.workerReadiness.get(extensionId).bridgeReady,
    true,
    'a preload-ready signal emitted during starting must not be dropped',
  );
  assert.strictEqual(
    messaging.workerReadiness.get(extensionId).running,
    false,
    'an early preload-ready signal must not mark a starting worker as running',
  );
  assert.strictEqual(
    messaging.readyWorker(extensionId),
    undefined,
    'a ready preload bridge must wait for the worker running lifecycle event',
  );
  assert.strictEqual(
    messaging.workerReadiness.get(extensionId).worker,
    portWorker,
    'the IPC event worker, not the queried wrapper, must own the generation',
  );
  portWorkerRunning = true;
  messagingWorkers.emit('running-status-changed', {
    runningStatus: 'running',
    versionId: portWorker.versionId,
  });
  assert.strictEqual(
    messaging.readyWorker(extensionId),
    portWorker,
    'the preserved preload-ready signal must become usable on running',
  );
  portWorkerDestroyed = true;
  assert.strictEqual(
    messaging.readyWorker(extensionId),
    portWorker,
    'a transient isDestroyed value must not override the running lifecycle event',
  );
  portWorkerDestroyed = false;
  const senderFrame = {
    parent: null,
    frameTreeNodeId: 1,
    url: 'https://example.test/',
  };
  senderFrame.top = senderFrame;
  const acceptedPort = await messaging.onPortConnect(
    { senderFrame },
    extensionId,
    { name: 'accepted' },
  );
  assert.ok(acceptedPort, 'accepted MV3 Port must return an id');
  assert.strictEqual(
    canonicalTaskCount,
    2,
    'the bridged worker lease and accepted Port must each acquire a task',
  );
  assert.strictEqual(
    canonicalTaskEndCount,
    0,
    'the running-worker keep-alive must remain active while the Port is open',
  );
  assert.strictEqual(canonicalSendCount, 1);
  assert.strictEqual(
    alternateTaskCount,
    0,
    'keep-alive must use the wrapper which emitted the ready beacon',
  );
  assert.strictEqual(
    alternateSentChannels.filter((channel) => channel === 'crx-runtime.onConnect').length,
    0,
    'Port delivery must use the wrapper which emitted the ready beacon',
  );
  assert.strictEqual(
    [...canonicalSentChannels, ...alternateSentChannels].filter(
      (channel) => channel === 'crx-worker-wake',
    ).length,
    2,
    'an already-bound generation must probe readiness again when it becomes running',
  );
  portWorker.send = (channel, payload) => {
    if (channel !== 'crx-runtime.onConnect') return;
    queueMicrotask(() => messaging.onPortReject({}, payload.portId, 'no-listener'));
  };
  assert.strictEqual(
    await messaging.onPortConnect(
      { senderFrame },
      extensionId,
      { name: 'rejected' },
    ),
    '',
    'a worker with no onConnect receiver must fail the connect call',
  );
  messaging.onPortDisconnect({}, acceptedPort);
  // Protocol 3 uses a worker-originated pull rather than ServiceWorkerMain.send.
  portWorkerIpc.emit(
    'crx-worker-ready',
    {serviceWorker: portWorker},
    {protocol: 3},
  );
  const inboundPull = messaging.onWorkerNextEvent({
    serviceWorker: queriedPortWorker,
  });
  await new Promise((resolve) => setImmediate(resolve));
  messaging.sendToWorker(extensionId, portWorker, 'crx-test-event', {id: 1});
  assert.deepStrictEqual(await inboundPull, {
    channel: 'crx-test-event',
    args: [{id: 1}],
  });
  // Electron may create a new JS wrapper for the same live registration when
  // the pump invokes again after idle. The stable versionId/scope pair must be
  // accepted, and the native channel is used only to wake the pull transport.
  const wakeChannels = [];
  portWorker.send = (channel, ...args) => {
    wakeChannels.push({channel, args});
  };
  messaging.sendToWorker(extensionId, portWorker, 'crx-test-idle-event', {id: 2});
  assert.deepStrictEqual(wakeChannels, [
    {channel: 'crx-worker-wake', args: []},
  ]);
  assert.deepStrictEqual(
    await messaging.onWorkerNextEvent({serviceWorker: queriedPortWorker}),
    {channel: 'crx-test-idle-event', args: [{id: 2}]},
    'a same-registration wrapper must drain queued events after an idle wake',
  );
  portWorkerIpc.emit(
    'crx-worker-ready',
    {serviceWorker: portWorker},
    {extensionScriptTracking: true},
  );
  assert.strictEqual(
    messaging.workerReadiness.get(extensionId).inboundProtocol,
    3,
    'a later readiness beacon without protocol must preserve the negotiated pull protocol',
  );
  assert.strictEqual(
    messaging.workerReadiness.get(extensionId).details.extensionScriptTracking,
    true,
    'later readiness metadata must be merged into the generation state',
  );
  // Avoid waiting for the production 30s keep-alive debounce in this unit test.
  messaging.evictWorker(portWorker.versionId);
  portWorkerRunning = false;
  messagingWorkers.emit('running-status-changed', {
    runningStatus: 'starting',
    versionId: portWorker.versionId,
  });
  assert.strictEqual(
    portWorkerIpc.listenerCount('crx-worker-ready'),
    1,
    'a reused ServiceWorkerMain wrapper must rebind exactly one ready handler',
  );
  portWorkerIpc.emit(
    'crx-worker-ready',
    {serviceWorker: portWorker},
    {protocol: 3},
  );
  portWorkerRunning = true;
  messagingWorkers.emit('running-status-changed', {
    runningStatus: 'running',
    versionId: portWorker.versionId,
  });
  assert.strictEqual(
    messaging.readyWorker(extensionId),
    portWorker,
    'a reused worker wrapper must become bridge-ready in its next lifecycle',
  );
  messaging.evictWorker(portWorker.versionId);

  const runtimeState = loadRuntimeState();
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'rainsee-runtime-lifecycle-'),
  );
  const stateExtensionId = 'pendinginstallfixtureid';
  await fs.promises.mkdir(path.join(root, stateExtensionId));
  try {
    assert.strictEqual(
      await runtimeState.getRuntimeInstallDetails(
        root,
        stateExtensionId,
        '1.0.0',
      ),
      null,
    );
    await runtimeState.saveRuntimeInstalledState(
      root,
      stateExtensionId,
      '1.0.0',
      details,
    );
    assert.deepStrictEqual(
      await runtimeState.getRuntimeInstallDetails(
        root,
        stateExtensionId,
        '1.0.0',
      ),
      details,
      'an undelivered install must be replayed after restart',
    );
    assert.strictEqual(
      await runtimeState.markRuntimeInstalledDelivered(
        root,
        stateExtensionId,
        '2.0.0',
        details,
      ),
      false,
      'a stale delivery must not clear newer state',
    );
    assert.strictEqual(
      await runtimeState.markRuntimeInstalledDelivered(
        root,
        stateExtensionId,
        '1.0.0',
        details,
      ),
      true,
    );
    assert.strictEqual(
      await runtimeState.getRuntimeInstallDetails(
        root,
        stateExtensionId,
        '1.0.0',
      ),
      null,
      'a delivered install must not replay',
    );
    assert.deepStrictEqual(
      await runtimeState.getRuntimeInstallDetails(
        root,
        stateExtensionId,
        '2.0.0',
      ),
      { reason: 'update', previousVersion: '1.0.0' },
    );

    const retryExtensionId = 'retryinstallfixtureid';
    await fs.promises.mkdir(path.join(root, retryExtensionId));
    for (let attempt = 0; attempt < 3; attempt++) {
      await runtimeState.saveRuntimeInstalledState(
        root,
        retryExtensionId,
        '1.0.0',
        details,
      );
    }
    assert.strictEqual(
      await runtimeState.getRuntimeInstallDetails(
        root,
        retryExtensionId,
        '1.0.0',
      ),
      null,
      'an install pending must stop retrying after the bounded attempts',
    );
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
  console.log('runtime lifecycle delivery tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
