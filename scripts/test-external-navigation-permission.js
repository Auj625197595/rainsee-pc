const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const {getDomain} = require('tldts');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(
  path.join(root, 'src/main/services/external-navigation.ts'),
  'utf8',
);
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2019,
  },
}).outputText;

const getSingledHost = (raw) => {
  let host = '';
  try {
    host = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname;
  } catch {
    return '';
  }
  if (host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return host;
  }
  return getDomain(host, {allowPrivateDomains: true}) || host;
};

const moduleUnderTest = {exports: {}};
new Function('require', 'module', 'exports', output)(
  (name) => {
    if (name === '~/utils/url') return {getSingledHost};
    return require(name);
  },
  moduleUnderTest,
  moduleUnderTest.exports,
);

const {getExternalNavigationDetails} = moduleUnderTest.exports;

assert.strictEqual(
  getExternalNavigationDetails(
    'https://account.example.com/login',
    'https://www.example.com/home',
  ),
  null,
);
assert.strictEqual(
  getExternalNavigationDetails('https://example.com', 'mailto:test@example.com'),
  null,
);
assert.strictEqual(
  getExternalNavigationDetails('not a url', 'https://example.com'),
  null,
);
assert.deepStrictEqual(
  getExternalNavigationDetails(
    'https://source.example/path',
    'https://target.example/welcome',
  ),
  {
    sourceUrl: 'https://source.example/path',
    sourceHost: 'source.example',
    targetUrl: 'https://target.example/welcome',
    targetHost: 'target.example',
  },
);

const permissionSource = fs.readFileSync(
  path.join(root, 'src/renderer/views/settings/components/Permissions/index.tsx'),
  'utf8',
);
assert.match(permissionSource, /kind: 'external-navigation'/);
assert.match(permissionSource, /value: 'ask', label: '询问'/);
assert.match(permissionSource, /value === 'ask' \? 3/);

const promptSource = fs.readFileSync(
  path.join(root, 'src/renderer/views/permissions/components/App/index.tsx'),
  'utf8',
);
assert.match(promptSource, /setTimeout\(\(\) => sendResult\(false\), 5000\)/);
assert.match(promptSource, /const root = rootRef\.current/);
assert.match(promptSource, /if \(!root\.isConnected\) return/);
assert.doesNotMatch(promptSource, /rootRef\.current\.scrollHeight/);

console.log('external navigation permission tests passed');
