const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function loadProxyModule() {
  const filename = path.resolve(
    __dirname,
    '../src/vendor/electron-chrome-extensions/browser/api/proxy.ts',
  );
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} };
  const localRequire = (request) => {
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

async function main() {
  const { mapProxyConfig, ProxyAPI } = loadProxyModule();
  const pacSource = 'function FindProxyForURL(url, host) { return "DIRECT"; }';
  const inlinePac = mapProxyConfig({
    mode: 'pac_script',
    pacScript: { data: pacSource },
  });
  assert.strictEqual(inlinePac.mode, 'pac_script');
  assert.match(
    inlinePac.pacScript,
    /^data:application\/x-ns-proxy-autoconfig;base64,/,
  );
  assert.strictEqual(
    Buffer.from(inlinePac.pacScript.split(',')[1], 'base64').toString('utf8'),
    pacSource,
  );

  assert.deepStrictEqual(
    mapProxyConfig({
      mode: 'pac_script',
      pacScript: { url: 'https://proxy.example.test/config.pac' },
    }),
    {
      mode: 'pac_script',
      pacScript: 'https://proxy.example.test/config.pac',
    },
  );
  assert.deepStrictEqual(
    mapProxyConfig({
      mode: 'fixed_servers',
      rules: {
        proxyForHttp: { scheme: 'http', host: '127.0.0.1', port: 8080 },
        proxyForHttps: {
          scheme: 'https',
          host: 'secure.example.test',
          port: 8443,
        },
        bypassList: ['localhost', '*.example.test'],
      },
    }),
    {
      mode: 'fixed_servers',
      proxyRules: 'http=127.0.0.1:8080;https=https://secure.example.test:8443',
      proxyBypassRules: 'localhost,*.example.test',
    },
  );

  const handlers = new Map();
  const calls = [];
  const context = {
    router: {
      apiHandler: () => (name, callback) => handlers.set(name, callback),
    },
    session: {
      async setProxy(config) {
        calls.push(['setProxy', config]);
      },
      async closeAllConnections() {
        calls.push(['closeAllConnections']);
      },
    },
  };
  new ProxyAPI(context);
  await handlers.get('proxy.settings.set')(
    { extension: { id: 'proxy-a' } },
    { value: { mode: 'pac_script', pacScript: { data: pacSource } } },
  );
  assert.strictEqual(calls[0][0], 'setProxy');
  assert.match(calls[0][1].pacScript, /^data:/);
  assert.deepStrictEqual(calls[1], ['closeAllConnections']);

  const failure = new Error('invalid proxy');
  context.session.setProxy = async () => {
    throw failure;
  };
  await assert.rejects(
    handlers.get('proxy.settings.set')(
      { extension: { id: 'proxy-a' } },
      { value: { mode: 'pac_script', pacScript: { data: pacSource } } },
    ),
    (error) => error === failure,
  );

  const coordinatedCalls = [];
  const coordinatedHandlers = new Map();
  const coordinator = {
    async set(extensionId, value, config) {
      coordinatedCalls.push(['set', extensionId, value, config]);
    },
    async clear(extensionId) {
      coordinatedCalls.push(['clear', extensionId]);
    },
    async release(extensionId) {
      coordinatedCalls.push(['release', extensionId]);
    },
    async get(extensionId) {
      return {
        value: { mode: 'direct' },
        levelOfControl:
          extensionId === 'proxy-a'
            ? 'controlled_by_this_extension'
            : 'controlled_by_other_extensions',
      };
    },
  };
  const extensionListeners = new Map();
  const coordinatedContext = {
    router: {
      apiHandler: () => (name, callback) =>
        coordinatedHandlers.set(name, callback),
      sendEvent: async () => true,
    },
    session: {
      extensions: {
        on: (name, callback) => extensionListeners.set(name, callback),
        getAllExtensions: () => [],
      },
    },
    store: { impl: { proxy: coordinator } },
  };
  new ProxyAPI(coordinatedContext);
  await coordinatedHandlers.get('proxy.settings.set')(
    { extension: { id: 'proxy-a' } },
    { value: { mode: 'direct' } },
  );
  assert.deepStrictEqual(coordinatedCalls[0], [
    'set',
    'proxy-a',
    { mode: 'direct' },
    { mode: 'direct' },
  ]);
  assert.strictEqual(
    (
      await coordinatedHandlers.get('proxy.settings.get')(
        { extension: { id: 'proxy-b' } },
        {},
      )
    ).levelOfControl,
    'controlled_by_other_extensions',
  );
  await coordinatedHandlers.get('proxy.settings.clear')(
    { extension: { id: 'proxy-a' } },
    {},
  );
  extensionListeners.get('extension-unloaded')({}, { id: 'proxy-a' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(coordinatedCalls.slice(1), [
    ['clear', 'proxy-a'],
    ['release', 'proxy-a'],
  ]);

  console.log('extension proxy adapter tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
