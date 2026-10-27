const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ts = require('typescript');

function loadDnrModule() {
  const filename = path.resolve(
    __dirname,
    '../src/vendor/electron-chrome-extensions/browser/api/declarative-net-request.ts',
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
    if (request === 'electron') {
      return { app: { getPath: () => os.tmpdir() } };
    }
    if (request === 'debug') {
      return { __esModule: true, default: () => () => {} };
    }
    if (request === './common') {
      return {
        normalizeResourceType: (value) => value || 'other',
        resolveExtensionPath: () => undefined,
      };
    }
    if (request === '../context' || request === '../router') return {};
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

const { DeclarativeNetRequestAPI, extractDomainHints } = loadDnrModule();

assert.deepStrictEqual(extractDomainHints({ urlFilter: '||example.com^' }), [
  'example.com',
]);
assert.deepStrictEqual(extractDomainHints({ urlFilter: '||*.example.com^' }), [
  'example.com',
]);
assert.deepStrictEqual(
  extractDomainHints({ urlFilter: '|https://static.example.com/path' }),
  ['static.example.com'],
);
assert.deepStrictEqual(
  extractDomainHints({ urlFilter: '||telemetry*.transcend.io^' }),
  [],
);
assert.deepStrictEqual(
  extractDomainHints({ urlFilter: '||cas.*.criteo.com^' }),
  [],
);
assert.deepStrictEqual(
  extractDomainHints({ urlFilter: '||user@example.com^' }),
  [],
);
assert.deepStrictEqual(extractDomainHints({ urlFilter: '||[::1]^' }), []);
assert.deepStrictEqual(
  extractDomainHints({
    requestDomains: ['cdn.example.com'],
    urlFilter: '||cdn-*.example.com^',
  }),
  ['cdn.example.com'],
);

function createDnr(resolveTabId, addRule = true, redirectRule = false) {
  const handlers = new Map();
  const extension = {
    id: 'dnr-tab-id-test',
    manifest: { permissions: ['declarativeNetRequestWithHostAccess'] },
  };
  const extensions = {
    getAllExtensions: () => [extension],
    getExtension: (id) => (id === extension.id ? extension : undefined),
    on() {},
  };
  const ctx = {
    router: {
      apiHandler: () => (name, handler) => handlers.set(name, handler),
      broadcastEvent() {},
    },
    session: { extensions },
    store: { impl: resolveTabId ? { resolveTabId } : {} },
    permissions: {
      hasOrigin: () => true,
      hasPermission: () => false,
      onChanged() {},
    },
  };
  const api = new DeclarativeNetRequestAPI(ctx);
  if (addRule) {
    handlers.get('declarativeNetRequest.updateSessionRules')(
      { extension },
      {
        addRules: [
          {
            id: redirectRule ? 2 : 1,
            action: redirectRule
              ? { type: 'redirect', redirect: { extensionPath: 'src/install.html' } }
              : {
                  type: 'modifyHeaders',
                  requestHeaders: [
                    { header: 'Referer', operation: 'set', value: 'https://www.example.test/' },
                  ],
                },
            condition: redirectRule
              ? { resourceTypes: ['main_frame'], urlFilter: 'script.example.test' }
              : {
                  tabIds: [7],
                  resourceTypes: ['xmlhttprequest'],
                  urlFilter: 'media.example.test/video.m4s',
                },
          },
        ],
      },
    );
  }
  return api;
}

const mediaRequest = {
  url: 'https://media.example.test/video.m4s?token=valid',
  resourceType: 'xmlhttprequest',
  webContentsId: 9,
};

let unusedResolverCalls = 0;
const emptyDnr = createDnr((webContentsId) => {
  unusedResolverCalls++;
  return webContentsId;
}, false);
assert.strictEqual(emptyDnr.hasHeaderRules('request'), false);
assert.strictEqual(emptyDnr.hasRules(), false);
assert.strictEqual(emptyDnr.matchHeaders(mediaRequest, 'request', []), undefined);
assert.strictEqual(unusedResolverCalls, 0, 'no-rule hot path must not resolve a tab id');

const redirectDnr = createDnr(undefined, true, true);
assert.strictEqual(redirectDnr.hasHeaderRules('request'), false);
assert.strictEqual(redirectDnr.hasRules(), true);
assert.strictEqual(
  redirectDnr.decideBeforeRequest({
    url: 'https://script.example.test/install.user.js',
    resourceType: 'main_frame',
    method: 'GET',
  }).action,
  'redirect',
);

const mappedHeaders = createDnr((webContentsId) =>
  webContentsId === 9 ? 7 : webContentsId,
).matchHeaders(mediaRequest, 'request', []);
assert.deepStrictEqual(mappedHeaders, [
  { name: 'Referer', value: 'https://www.example.test/' },
]);

const detachedRequestDnr = createDnr(() => undefined);
assert.strictEqual(
  detachedRequestDnr.matchHeaders(mediaRequest, 'request', []),
  undefined,
  'an unassociated extension context must use Chrome tabId -1',
);

const unmappedDnr = createDnr();
assert.strictEqual(unmappedDnr.matchHeaders(mediaRequest, 'request', []), undefined);
assert.deepStrictEqual(
  unmappedDnr.matchHeaders(
    { ...mediaRequest, webContentsId: 7 },
    'request',
    [],
  ),
  [{ name: 'Referer', value: 'https://www.example.test/' }],
);

console.log('DNR index regression tests passed');
