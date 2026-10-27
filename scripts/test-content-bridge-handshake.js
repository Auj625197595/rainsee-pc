const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

function loadTsModule(filename) {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
    },
    fileName: filename,
  }).outputText;
  const loaded = {exports: {}};
  new Function('require', 'module', 'exports', output)(
    require,
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}

function loadBridgeBuilder() {
  const filename = path.resolve(
    __dirname,
    '../src/vendor/electron-chrome-extensions/browser/api/content-bridge.ts',
  );
  return loadTsModule(filename).buildUserScriptMessagingBridge;
}

function verifyWindowOpenPreferences() {
  const filename = path.resolve(
    __dirname,
    '../src/main/view-web-preferences.ts',
  );
  const loaded = loadTsModule(filename);
  const previousMode = process.env.RAINSEE_SANDBOXED_TABS;
  delete process.env.RAINSEE_SANDBOXED_TABS;
  try {
    const session = {};
    const preferences = loaded.createViewWebPreferences(
      session,
      'E:/app/build/view-preload.bundle.js',
      false,
      'sandboxed',
    );
    assert.strictEqual(preferences.session, session);
    assert.strictEqual(preferences.preload, 'E:/app/build/view-preload.bundle.js');
    assert.strictEqual(preferences.contextIsolation, false);
    assert.strictEqual(preferences.sandbox, true);
    assert.strictEqual(preferences.nodeIntegration, false);
    const pdfPreferences = loaded.createViewWebPreferences(
      session,
      'E:/app/build/view-preload.bundle.js',
      false,
      'sandboxed',
      true,
    );
    assert.strictEqual(pdfPreferences.session, session);
    assert.strictEqual(pdfPreferences.sandbox, false);
    assert.strictEqual(
      loaded.getViewPreloadFilename('sandboxed'),
      'view-preload.bundle.js',
    );

    const koodo = loaded.createViewWebPreferences(
      session,
      'E:/app/build/privileged-view-preload.bundle.js',
      false,
      'privileged-koodo',
    );
    assert.strictEqual(koodo.contextIsolation, false);
    assert.strictEqual(koodo.sandbox, false);
    assert.strictEqual(
      loaded.getViewPreloadFilename('privileged-koodo'),
      'privileged-view-preload.bundle.js',
    );

    const extension = loaded.createViewWebPreferences(
      session,
      'E:/app/build/extension-view-preload.bundle.js',
      false,
      'privileged-extension',
    );
    assert.strictEqual(extension.contextIsolation, false);
    assert.strictEqual(extension.sandbox, false);
    assert.strictEqual(
      loaded.getViewPreloadFilename('privileged-extension'),
      'extension-view-preload.bundle.js',
    );
    assert.strictEqual(
      loaded.getViewPreloadFilename(
        'privileged-extension',
        'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html',
      ),
      'view-preload.bundle.js',
    );

    process.env.RAINSEE_SANDBOXED_TABS = '0';
    const rollback = loaded.createViewWebPreferences(
      session,
      'E:/app/build/privileged-view-preload.bundle.js',
      false,
      'sandboxed',
    );
    assert.strictEqual(rollback.contextIsolation, false);
    assert.strictEqual(rollback.sandbox, false);
    assert.strictEqual(
      loaded.getViewPreloadFilename('sandboxed'),
      'privileged-view-preload.bundle.js',
    );
  } finally {
    if (previousMode === undefined) delete process.env.RAINSEE_SANDBOXED_TABS;
    else process.env.RAINSEE_SANDBOXED_TABS = previousMode;
  }

  assert.strictEqual(loaded.getViewSecurityKind('https://example.test'), 'sandboxed');
  assert.strictEqual(loaded.getViewSecurityKind('file:///E:/book.html'), 'sandboxed');
  assert.strictEqual(loaded.getViewSecurityKind('about:blank'), 'sandboxed');
  assert.strictEqual(loaded.getViewSecurityKind('yjllq://settings/'), 'sandboxed');
  assert.strictEqual(loaded.isPdfUrl('https://example.test/document.pdf?download=1'), true);
  assert.strictEqual(loaded.isPdfUrl('https://example.test/document.html'), false);
  assert.strictEqual(
    loaded.isBuiltinPdfViewerUrl(
      'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html',
    ),
    true,
  );
  assert.strictEqual(
    loaded.isBuiltinPdfViewerUrl(
      'chrome-extension://abcdefghijklmnopabcdefghijklmnop/index.html',
    ),
    false,
  );
  assert.strictEqual(
    loaded.getViewSecurityKind('yjllq://web.koodoreader.com/#/pdf'),
    'privileged-koodo',
  );
  assert.strictEqual(
    loaded.getViewSecurityKind('chrome-extension://abcdefghijkl/page.html'),
    'privileged-extension',
  );
  assert.strictEqual(
    loaded.isCrossViewSecurityNavigation(
      'privileged-koodo',
      'https://example.test',
    ),
    true,
  );
  assert.strictEqual(
    loaded.isCrossViewSecurityNavigation('sandboxed', 'about:blank'),
    false,
  );

  const preloadSource = fs.readFileSync(
    path.resolve(__dirname, '../src/preloads/view-preload.ts'),
    'utf8',
  );
  assert.ok(preloadSource.includes('getContext: (): WebUIContext'));
  assert.ok(preloadSource.includes("contextBridge.exposeInMainWorld('rainseeWebUI'"));
  assert.ok(!preloadSource.includes("contextBridge.exposeInMainWorld('ipcInvoke'"));
  assert.ok(!preloadSource.includes("contextBridge.exposeInMainWorld('ipcSend'"));
  assert.ok(!preloadSource.includes("expose('settings'"));
  assert.ok(!preloadSource.includes("expose('windowId'"));
  assert.ok(preloadSource.includes('const errorBridge: RainseeWebUIErrorBridge'));
  assert.ok(preloadSource.includes('sanitizeWebUISettings'));
  assert.match(
    preloadSource,
    /ipcRenderer\.sendSync\('get-settings-sync'\)\s*\?\?\s*\{\}/,
    'a missing synchronous settings response must not abort the page preload',
  );
  assert.match(
    preloadSource,
    /channel === 'crx-cs-message'\s*\|\|\s*channel === 'crx-dynamic-cs-message'/,
    'subframe relay must forward dynamically registered content-script messages',
  );
  assert.ok(
    preloadSource.includes(
      "ipcRenderer.on('crx-dynamic-cs-message', crxForwardContentScriptMessage)",
    ),
    'top-frame preload must forward dynamically registered content-script messages',
  );

  const errorPageSource = fs.readFileSync(
    path.resolve(__dirname, '../static/pages/network-error.html'),
    'utf8',
  );
  assert.ok(errorPageSource.includes('rainseeWebUI && window.rainseeWebUI.error'));
  assert.ok(!errorPageSource.includes('window.errorReload'));
  assert.ok(!errorPageSource.includes('window.errorGoHome'));

  const viewSource = fs.readFileSync(
    path.resolve(__dirname, '../src/main/view.ts'),
    'utf8',
  );
  assert.ok(viewSource.includes('getViewPreloadFilename'));
  assert.ok(viewSource.includes('getViewSecurityKind(targetUrl)'));
  assert.ok(viewSource.includes('this.pdfCompat &&'));
  assert.ok(viewSource.includes('!isPdfUrl(navigationUrl)'));
  assert.ok(viewSource.includes('!isBuiltinPdfViewerUrl(navigationUrl)'));
  assert.ok(viewSource.includes("this.webContents.on('will-redirect'"));
  assert.ok(viewSource.includes('openCrossSecurityNavigation(navigation.url)'));

  const webpackSource = fs.readFileSync(
    path.resolve(__dirname, '../webpack.config.js'),
    'utf8',
  );
  const extensionsGate = webpackSource.indexOf('if (process.env.ENABLE_EXTENSIONS)');
  const extensionViewEntry = webpackSource.indexOf("'extension-view-preload':");
  assert.ok(extensionViewEntry >= 0 && extensionViewEntry < extensionsGate);
}

function verifyNavigationContext() {
  const filename = path.resolve(
    __dirname,
    '../src/main/utils/navigation-context.ts',
  );
  const loaded = loadTsModule(filename);
  const getNavigationContext = loaded.getNavigationContext;

  const structuredMainFrame = getNavigationContext(
    {
      url: 'chrome-extension://fixture/overlay/menu.html',
      isSameDocument: false,
      isMainFrame: true,
    },
    'https://stale.example/',
    true,
    false,
  );
  assert.strictEqual(structuredMainFrame.url, 'chrome-extension://fixture/overlay/menu.html');
  assert.strictEqual(structuredMainFrame.isSameDocument, false);
  assert.strictEqual(structuredMainFrame.isMainFrame, true);

  const structuredSubFrame = getNavigationContext(
    {
      url: 'chrome-extension://fixture/overlay/menu.html',
      isSameDocument: false,
      isMainFrame: false,
    },
    'https://stale.example/',
    true,
    true,
  );
  assert.strictEqual(structuredSubFrame.isMainFrame, false);
  assert.strictEqual(structuredSubFrame.url, 'chrome-extension://fixture/overlay/menu.html');

  const legacy = getNavigationContext({}, 'https://legacy.example/', true, false);
  assert.strictEqual(legacy.url, 'https://legacy.example/');
  assert.strictEqual(legacy.isSameDocument, true);
  assert.strictEqual(legacy.isMainFrame, false);

  const oldWillNavigate = getNavigationContext({}, 'https://main.example/');
  assert.strictEqual(oldWillNavigate.isMainFrame, true);
}

function verifyWebUIPolicy() {
  const filename = path.resolve(
    __dirname,
    '../src/common/webui-bridge-policy.ts',
  );
  const loaded = loadTsModule(filename);
  const policy = loaded;

  assert.strictEqual(policy.isTrustedWebUIUrl('yjllq://settings/'), true);
  assert.strictEqual(policy.isTrustedWebUIUrl('yjllq-error://network-error/'), true);
  assert.strictEqual(
    policy.isTrustedWebUIUrl('http://localhost:4444/settings.html?section=privacy'),
    true,
  );
  assert.strictEqual(policy.isTrustedWebUIUrl('https://example.test/'), false);
  assert.strictEqual(policy.isTrustedWebUIUrl('about:blank'), false);
  assert.strictEqual(
    policy.isTrustedWebUIUrl('http://localhost:4444/not-registered.html'),
    false,
  );
  assert.strictEqual(policy.isAllowedWebUIChannel('bookmarks-get', 'invoke'), true);
  assert.strictEqual(policy.isAllowedWebUIChannel('bookmarks-get', 'send'), false);
  assert.strictEqual(policy.isAllowedWebUIChannel('update-settings', 'event'), true);
  assert.strictEqual(policy.isAllowedWebUIChannel('update-settings', 'invoke'), false);
  assert.strictEqual(policy.isAllowedWebUIChannel('add-tab-42', 'send'), true);
  assert.strictEqual(policy.isAllowedWebUIChannel('add-tab-not-a-number', 'send'), false);
  assert.strictEqual(policy.isAllowedWebUIChannel('web-contents-call', 'invoke'), false);
  assert.strictEqual(
    policy.isAllowedWebUIChannelForUrl(
      'yjllq://bookmarks/',
      'bookmarks-get',
      'invoke',
    ),
    true,
  );
  assert.strictEqual(
    policy.isAllowedWebUIChannelForUrl(
      'yjllq://bookmarks/',
      'data-backup-create',
      'invoke',
    ),
    false,
  );
  assert.strictEqual(
    policy.isAllowedWebUIChannelForUrl(
      'yjllq://downloads/',
      'media-download-create',
      'invoke',
    ),
    true,
  );
  assert.strictEqual(
    policy.isAllowedWebUIChannelForUrl(
      'yjllq://bookmarks/',
      'bookmark-cloud-clear',
      'invoke',
    ),
    false,
  );
  assert.strictEqual(
    policy.isAllowedWebUIChannelForUrl(
      'yjllq://settings/',
      'bookmarks-get-folders',
      'invoke',
    ),
    true,
  );
  assert.strictEqual(
    policy.isAllowedWebUIChannelForUrl(
      'yjllq://newtab/',
      'profile-network-get',
      'invoke',
    ),
    false,
  );
  assert.strictEqual(
    policy.isAllowedWebUIChannelForUrl(
      'http://localhost:4444/newtab.html',
      'newtab-search-show-42',
      'send',
      42,
    ),
    true,
  );
  assert.strictEqual(
    policy.isAllowedWebUIChannelForUrl(
      'yjllq://history/',
      'update-settings',
      'event',
    ),
    true,
  );
  assert.strictEqual(
    policy.isAllowedWebUIChannelForUrl(
      'yjllq-error://network-error/',
      'update-settings',
      'event',
    ),
    false,
  );
  assert.strictEqual(
    policy.isAllowedWebUIChannelForUrl(
      'http://localhost:4444/newtab.html',
      'newtab-search-show-42',
      'send',
      41,
    ),
    false,
  );
  assert.strictEqual(
    policy.isAllowedWebUIChannelForUrl(
      'yjllq://bookmarks/',
      'show-bookmarks-bar-context-menu-42',
      'invoke',
      42,
    ),
    true,
  );
  for (const channel of [
    'image-viewer-get',
    'image-viewer-pack-zip',
    'media-download',
  ]) {
    assert.strictEqual(
      policy.isAllowedWebUIChannelForUrl(
        'yjllq://image-viewer/',
        channel,
        'invoke',
        42,
      ),
      true,
    );
  }
  assert.strictEqual(
    policy.isAllowedWebUIChannelForUrl(
      'yjllq://image-viewer/',
      'image-viewer-zip-progress',
      'event',
      42,
    ),
    true,
  );
  for (const channel of [
    'credentials-get-password',
    'clear-browsing-data-now',
    'data-backup-create',
    'data-backup-list',
    'data-backup-open-dir',
    'data-backup-restore',
    'data-backup-select-restore',
  ]) {
    assert.strictEqual(
      policy.isAllowedWebUIChannelForUrl('yjllq://settings/', channel, 'invoke', 42),
      true,
    );
  }
  assert.strictEqual(
    policy.isAllowedWebUIChannelForUrl(
      'yjllq://newtab/',
      'credentials-get-password',
      'invoke',
      42,
    ),
    false,
  );
  for (const channel of ['download-open', 'download-show-in-folder']) {
    assert.strictEqual(
      policy.isAllowedWebUIChannelForUrl(
        'yjllq://downloads/',
        channel,
        'invoke',
        42,
      ),
      true,
    );
  }

  const webUIRoots = [
    'bookmarks', 'downloads', 'extensions', 'flags', 'history',
    'image-viewer', 'login-success', 'memory', 'newtab', 'settings',
  ];
  const scan = (host, directory) => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        scan(host, target);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const source = fs.readFileSync(target, 'utf8');
      const sourceFile = ts.createSourceFile(
        target,
        source,
        ts.ScriptTarget.Latest,
        true,
      );
      const invokeAliases = new Set(['ipcInvoke', 'inv', 'invoke', 'ipc']);
      const sendAliases = new Set(['ipcSend']);
      const isLegacyGlobalAccess = (node) => {
        if (!ts.isPropertyAccessExpression(node)) return false;
        if (node.name.text !== 'electron' && node.name.text !== 'require') {
          return false;
        }
        let root = node.expression;
        while (
          ts.isParenthesizedExpression(root) ||
          ts.isAsExpression(root) ||
          ts.isTypeAssertionExpression(root)
        ) {
          root = root.expression;
        }
        return ts.isIdentifier(root) &&
          ['window', 'globalThis', 'w'].includes(root.text);
      };
      const visit = (node) => {
        if (isLegacyGlobalAccess(node)) {
          assert.fail(`${target} exposes a legacy ${node.name.text} dependency`);
        }
        if (ts.isCallExpression(node)) {
          let operation;
          const expression = node.expression;
          if (
            ts.isPropertyAccessExpression(expression) &&
            ['invoke', 'send', 'on', 'once'].includes(expression.name.text)
          ) {
            operation = ['on', 'once'].includes(expression.name.text)
              ? 'event'
              : expression.name.text;
          } else if (
            ts.isIdentifier(expression) &&
            (invokeAliases.has(expression.text) || sendAliases.has(expression.text))
          ) {
            operation = sendAliases.has(expression.text) ? 'send' : 'invoke';
          }
          const channel = node.arguments[0];
          if (operation && channel && ts.isStringLiteralLike(channel)) {
            assert.strictEqual(
              policy.isAllowedWebUIChannelForUrl(
                `yjllq://${host}/`,
                channel.text,
                operation,
                42,
              ),
              true,
              `${host} ${operation} channel is missing from policy: ${channel.text}`,
            );
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }
  };
  for (const host of webUIRoots) {
    scan(host, path.resolve(__dirname, `../src/renderer/views/${host}`));
  }
}

function verifySandboxPreloadBoundary() {
  const preloadFiles = [
    '../src/preloads/view-preload.ts',
    '../src/preloads/sandbox-bridge.ts',
    '../src/preloads/models/auto-complete.ts',
    '../src/preloads/selection-translate.ts',
    '../src/preloads/profile-fingerprint.ts',
  ];
  const sources = preloadFiles.map((file) =>
    fs.readFileSync(path.resolve(__dirname, file), 'utf8'),
  );
  const combined = sources.join('\n');
  assert.doesNotMatch(combined, /from ['"](?:fs|path|os|crypto|@electron\/remote)['"]/);
  assert.doesNotMatch(combined, /window\.(?:electron|require)\s*=/);
  assert.doesNotMatch(combined, /\bw\.(?:electron|require)\s*=/);
  assert.strictEqual(
    sources.filter((source) => /from ['"]electron['"]/.test(source)).length,
    1,
    'only sandbox-bridge.ts may import Electron in the ordinary preload graph',
  );
  const webpack = fs.readFileSync(
    path.resolve(__dirname, '../webpack.config.js'),
    'utf8',
  );
  assert.ok(webpack.includes("'privileged-view-preload'"));
  assert.ok(webpack.includes("'extension-view-preload'"));

  const extensionViewPreload = fs.readFileSync(
    path.resolve(__dirname, '../src/preloads/extension-view-preload.ts'),
    'utf8',
  );
  assert.match(
    extensionViewPreload,
    /vendor\/electron-chrome-extensions\/preload/,
    'extension tabs must load chrome APIs through a classic preload',
  );
  assert.match(
    extensionViewPreload,
    /\.\/view-preload/,
    'extension tabs must retain the ordinary tab bridge',
  );

  const extensionRenderer = fs.readFileSync(
    path.resolve(
      __dirname,
      '../src/vendor/electron-chrome-extensions/renderer/index.ts',
    ),
    'utf8',
  );
  assert.doesNotMatch(
    extensionRenderer,
    /Object\.freeze\(chrome\)/,
    'the chrome namespace must stay extensible for extension compatibility aliases',
  );

  const privilegedLegacy = fs.readFileSync(
    path.resolve(__dirname, '../src/preloads/privileged-legacy-bridge.ts'),
    'utf8',
  );
  assert.doesNotMatch(privilegedLegacy, /isTrustedWebUIUrl/);
  assert.match(privilegedLegacy, /if \(isKoodo\)/);

  const sessionsSource = fs.readFileSync(
    path.resolve(__dirname, '../src/main/sessions-service.ts'),
    'utf8',
  );
  assert.match(sessionsSource, /ipcMain\.handle\('download-open'/);
  assert.match(sessionsSource, /ipcMain\.handle\('download-show-in-folder'/);
  assert.match(sessionsSource, /getCompletedDownload\(id\)/);

  const messagingSource = fs.readFileSync(
    path.resolve(__dirname, '../src/main/services/messaging.ts'),
    'utf8',
  );
  assert.match(messagingSource, /pickerArmedWebContentsId/);
  assert.match(messagingSource, /isPickerSender\(e\.sender\)/);
  assert.match(messagingSource, /isPickerRuleAllowed/);
  assert.match(messagingSource, /value\.includes\('\@\@'\)/);
  assert.match(messagingSource, /value\.length > 64 \* 1024/);
  assert.match(messagingSource, /\/\[\\r\\n\\u0000\]\/.test\(value\)/);

  const pickerSource = fs.readFileSync(
    path.resolve(__dirname, '../src/main/services/adblock-picker.ts'),
    'utf8',
  );
  const pickerGenerator = fs.readFileSync(
    path.resolve(__dirname, './gen-adblock-picker.js'),
    'utf8',
  );
  assert.doesNotMatch(pickerSource, /window\.electron/);
  assert.doesNotMatch(pickerGenerator, /window\.electron/);
  assert.match(sources[0], /adblock-picker-bridge-enable/);

  const nativePopup = fs.readFileSync(
    path.resolve(__dirname, '../src/main/native-blank-popup.ts'),
    'utf8',
  );
  assert.match(nativePopup, /getViewSecurityKind\(navigation\.url\) !== 'sandboxed'/);
  assert.match(nativePopup, /webContents\.on\('will-redirect', reroutePrivileged\)/);

  const viewSource = sources[0];
  assert.match(viewSource, /value\.length <= 64 \* 1024/);
  assert.doesNotMatch(viewSource, /type === 'storage'/);
  assert.doesNotMatch(viewSource, /w\.clearBrowsingDataNow\s*=/);
  assert.doesNotMatch(viewSource, /imageViewerZipProgress/);

  const mainViewSource = fs.readFileSync(
    path.resolve(__dirname, '../src/main/view.ts'),
    'utf8',
  );
  assert.match(mainViewSource, /navigation\.isMainFrame/);
  assert.match(mainViewSource, /this\.pdfCompat &&/);
  assert.match(mainViewSource, /replacePdfView\(navigationUrl\)/);
  assert.match(mainViewSource, /pdfCompat: isPdfUrl\(url\)/);
  assert.match(mainViewSource, /if \(!navigationIsMainFrame\) return;/);
  assert.match(
    mainViewSource,
    /openCrossSecurityNavigation\(navigationUrl, undefined, true\)/,
  );
  assert.match(mainViewSource, /request\.stopCurrent/);
  assert.doesNotMatch(mainViewSource, /this\.loadResolvedUrl\(fallback, loadOptions\)/);
  assert.match(mainViewSource, /extension newtab unavailable, replacing with/);
  assert.match(mainViewSource, /fallbackView\.webContents\.getURL\(\)/);
  assert.match(mainViewSource, /const active\s*=/);
  assert.match(mainViewSource, /\bactive,\s*\r?\n\s*incognito/);
  assert.match(
    mainViewSource,
    /pendingCrossSecurityNavigation[\s\S]*?setImmediate\(\(\) =>/,
  );

  const indexSource = fs.readFileSync(
    path.resolve(__dirname, '../src/main/index.ts'),
    'utf8',
  );
  assert.match(indexSource, /getNavigationContext\(/);
  assert.match(indexSource, /if \(!navigation\.isMainFrame\) return;/);

  const appSource = fs.readFileSync(
    path.resolve(__dirname, '../src/main/windows/app.ts'),
    'utf8',
  );
  assert.match(appSource, /getNavigationContext\(e, url\)/);
  assert.match(appSource, /navigation\.isMainFrame/);
  assert.match(appSource, /resolveInternalFlagsUrl\(\s*navigation\.url/);
  assert.match(appSource, /filePathFromFileUrl\(navigation\.url\)/);

  const viewManagerSource = fs.readFileSync(
    path.resolve(__dirname, '../src/main/view-manager.ts'),
    'utf8',
  );
  assert.match(viewManagerSource, /getNavigationContext\(/);
  assert.match(viewManagerSource, /navigation\.isMainFrame/);

  assert.match(messagingSource, /getNavigationContext\(/);
  assert.match(messagingSource, /navigation\.isMainFrame/);
}

async function main() {
  verifyWindowOpenPreferences();
  verifyNavigationContext();
  verifyWebUIPolicy();
  verifySandboxPreloadBoundary();
  const buildBridge = loadBridgeBuilder();
  const listeners = [];
  const intervals = new Map();
  let nextTimer = 0;
  let relayReady = false;
  let connectPosts = 0;
  let acceptedConnects = 0;
  let messagePosts = 0;
  let acceptedMessages = 0;
  const acceptedIds = new Set();

  const context = {
    console: { log() {}, warn() {}, error() {} },
    location: { protocol: 'https:', href: 'https://example.test/' },
    navigator: { language: 'en-US' },
    queueMicrotask,
    Promise,
    setTimeout() {
      return ++nextTimer;
    },
    clearTimeout() {},
    setInterval(callback) {
      const id = ++nextTimer;
      intervals.set(id, callback);
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    addEventListener(type, listener) {
      if (type === 'message') listeners.push(listener);
    },
    postMessage(message) {
      for (const listener of [...listeners]) {
        listener({ data: message, source: context });
      }
      if (message.__crxCSConnect) {
        connectPosts++;
        if (!relayReady) return;
        if (!acceptedIds.has(message.connId)) {
          acceptedIds.add(message.connId);
          acceptedConnects++;
        }
        context.postMessage({
          __crxCSPortAck: true,
          connId: message.connId,
          extId: message.extId,
        });
      } else if (message.__crxCsSend) {
        messagePosts++;
        if (!relayReady || acceptedIds.has(message.mid)) return;
        acceptedIds.add(message.mid);
        acceptedMessages++;
        context.postMessage({
          __crxCsSendResp: true,
          mid: message.mid,
          response: message.message && message.message.reject ? undefined : { ready: true },
          error: message.message && message.message.reject
            ? 'polyfill no-op listener rejected'
            : undefined,
        });
      }
    },
  };
  context.window = context;
  context.self = context;

  vm.runInNewContext(
    buildBridge('tampermonkeyfixture', {
      manifest_version: 3,
      name: 'Tampermonkey fixture',
      version: '1.0.0',
    }),
    context,
  );

  const port = context.chrome.runtime.connect({ name: 'content-script' });
  assert.ok(port, 'runtime.connect must return a synthetic Port immediately');
  assert.strictEqual(connectPosts, 1, 'the initial document_start connect is sent');
  assert.strictEqual(acceptedConnects, 0, 'the initial connect is lost before preload');

  relayReady = true;
  for (const callback of [...intervals.values()]) callback();
  assert.strictEqual(connectPosts, 2, 'the bridge retries after preload becomes ready');
  assert.strictEqual(acceptedConnects, 1, 'the relay opens only one real Port');
  assert.strictEqual(intervals.size, 0, 'the acknowledgement stops connect retries');

  port.disconnect();

  relayReady = false;
  const responsePromise = context.chrome.runtime.sendMessage({ ping: true });
  assert.strictEqual(messagePosts, 1, 'the initial document_start message is sent');
  assert.strictEqual(acceptedMessages, 0, 'the initial message is lost before preload');

  relayReady = true;
  for (const callback of [...intervals.values()]) callback();
  const response = await responsePromise;
  assert.strictEqual(messagePosts, 2, 'runtime.sendMessage retries after preload is ready');
  assert.strictEqual(acceptedMessages, 1, 'the relay handles a retried message once');
  assert.strictEqual(response.ready, true, 'the retried message receives its response');
  assert.strictEqual(intervals.size, 0, 'the response stops message retries');

  await assert.rejects(
    context.chrome.runtime.sendMessage({reject: true}),
    /polyfill no-op listener rejected/,
    'a Chrome 148 Promise listener rejection must reject runtime.sendMessage',
  );

  console.log('content bridge handshake tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
