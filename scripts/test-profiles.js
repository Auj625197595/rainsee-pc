const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/common/profiles.ts');
const source = fs.readFileSync(filename, 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2019,
  },
  fileName: filename,
}).outputText;
const loaded = { exports: {} };
new Function('module', 'exports', output)(loaded, loaded.exports);

const {
  getProfileArgument,
  parseProfileArgument,
  profileNameKey,
  validateProfileName,
} = loaded.exports;

assert.deepStrictEqual(validateProfileName('  工作号  '), {
  ok: true,
  name: '工作号',
});
assert.strictEqual(validateProfileName('').ok, false);
assert.strictEqual(validateProfileName('../escape').ok, false);
assert.strictEqual(validateProfileName('folder/name').ok, false);
assert.strictEqual(validateProfileName('name\\child').ok, false);
assert.strictEqual(validateProfileName('CON').ok, false);
assert.strictEqual(validateProfileName('lpt9.txt').ok, false);
assert.strictEqual(validateProfileName('trailing.').ok, false);
assert.strictEqual(validateProfileName('.internal').ok, false);
assert.strictEqual(validateProfileName('a'.repeat(41)).ok, false);
assert.strictEqual(validateProfileName('😀'.repeat(40)).ok, true);

const argument = getProfileArgument('工作 号/测试'.replace('/', '-'));
assert.strictEqual(
  argument,
  '--rainsee-profile=%E5%B7%A5%E4%BD%9C%20%E5%8F%B7-%E6%B5%8B%E8%AF%95',
);
assert.deepStrictEqual(parseProfileArgument(['electron', argument]), {
  present: true,
  name: '工作 号-测试',
});
assert.strictEqual(parseProfileArgument(['electron']).present, false);
assert.strictEqual(
  parseProfileArgument(['electron', '--rainsee-profile=..']).name,
  null,
);
assert.strictEqual(
  parseProfileArgument(['electron', '--rainsee-profile=%E0%A4%A']).name,
  null,
);
assert.strictEqual(profileNameKey('Work'), profileNameKey('work'));

console.log('profile validation and argument tests passed');

const networkFilename = path.resolve(
  __dirname,
  '../src/common/profile-network.ts',
);
const networkSource = fs.readFileSync(networkFilename, 'utf8');
const networkOutput = ts.transpileModule(networkSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2019,
  },
  fileName: networkFilename,
}).outputText;
const networkModule = { exports: {} };
const proxyRoutingFilename = path.resolve(
  __dirname,
  '../src/common/proxy-routing.ts',
);
const proxyRoutingOutput = ts.transpileModule(
  fs.readFileSync(proxyRoutingFilename, 'utf8'),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: proxyRoutingFilename,
  },
).outputText;
const testRequire = (request) => {
  if (request === './proxy-routing') {
    const module = { exports: {} };
    new Function('require', 'module', 'exports', proxyRoutingOutput)(
      testRequire,
      module,
      module.exports,
    );
    return module.exports;
  }
  return require(request);
};
new Function('require', 'module', 'exports', networkOutput)(
  testRequire,
  networkModule,
  networkModule.exports,
);

const {
  deriveProfileFingerprint,
  normalizeProfileProxy,
} = networkModule.exports;

const defaultRouting = {
  mode: 'global',
  proxyRules: '',
  directRules: '',
  bypassLocal: true,
  gfwListUrl: 'https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt',
};

const fingerprintA = deriveProfileFingerprint('a'.repeat(48), 'win32');
assert.deepStrictEqual(
  fingerprintA,
  deriveProfileFingerprint('a'.repeat(48), 'win32'),
);
assert.notStrictEqual(
  fingerprintA.id,
  deriveProfileFingerprint('b'.repeat(48), 'win32').id,
);
assert.strictEqual(
  deriveProfileFingerprint('a'.repeat(48), 'win32', false).enabled,
  false,
);

assert.strictEqual(normalizeProfileProxy({ mode: 'direct' }).ok, true);
assert.strictEqual(
  normalizeProfileProxy({
    mode: 'http',
    host: '127.0.0.1',
    port: 8080,
    routing: { ...defaultRouting, mode: 'gfwlist' },
  }).settings.routing.mode,
  'bypass_mainland',
);
assert.deepStrictEqual(normalizeProfileProxy({ mode: 'system' }).settings, {
  force: false,
  mode: 'system',
  host: '',
  port: 0,
  username: '',
  password: '',
  bypass: '<local>',
  pacScript: '',
  routing: defaultRouting,
});
assert.deepStrictEqual(
  normalizeProfileProxy({
    mode: 'system',
    host: 'proxy.example.com',
    port: 8080,
    username: 'user',
    password: 'secret',
    bypass: 'localhost',
  }).settings,
  {
    force: false,
    mode: 'system',
    host: '',
    port: 0,
    username: '',
    password: '',
    bypass: '<local>',
  pacScript: '',
  routing: defaultRouting,
  },
);
assert.deepStrictEqual(
  normalizeProfileProxy({
    mode: 'http',
    host: ' 127.0.0.1 ',
    port: '8080',
    username: ' user ',
    password: 'secret',
    bypass: '<local>',
  }).settings,
  {
    force: false,
    mode: 'http',
    host: '127.0.0.1',
    port: 8080,
    username: 'user',
    password: 'secret',
    bypass: '<local>',
  pacScript: '',
  routing: defaultRouting,
  },
);
assert.strictEqual(
  normalizeProfileProxy({ mode: 'direct', force: true }).settings.force,
  true,
);
assert.strictEqual(
  normalizeProfileProxy({ mode: 'http', host: 'http://127.0.0.1', port: 80 })
    .ok,
  false,
);
assert.strictEqual(
  normalizeProfileProxy({ mode: 'socks5', host: '::1', port: 1080 }).ok,
  false,
);
assert.strictEqual(
  normalizeProfileProxy({ mode: 'socks5', host: '[::1]', port: 1080 }).ok,
  true,
);
assert.strictEqual(
  normalizeProfileProxy({ mode: 'http', host: 'proxy.local', port: 70000 }).ok,
  false,
);

console.log('profile fingerprint and proxy validation tests passed');
