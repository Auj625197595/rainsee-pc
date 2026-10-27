const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const vm = require('vm');

const filename = path.resolve(__dirname, '../src/common/proxy-routing.ts');
const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: filename,
}).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', output)(
  require,
  loaded,
  loaded.exports,
);
const {
  EMPTY_PROXY_RULE_SET,
  decideProxyRoute,
  generateProxyPac,
  parseGfwList,
  parseProxyRules,
} = loaded.exports;

const parsed = parseProxyRules(
  '# comment\nexample.com\n*.example.org\n192.0.2.0/24\n2001:db8::/32',
);
assert.strictEqual(parsed.ok, true);
assert.strictEqual(parsed.rules.exactDomains[0], 'example.com');
assert.strictEqual(parsed.rules.wildcardDomains[0], 'example.org');
assert.strictEqual(parsed.rules.ipv4Ranges.length, 1);
assert.strictEqual(parsed.rules.ipv6Ranges.length, 1);
assert.strictEqual(
  decideProxyRoute(
    '192.0.2.7',
    {
      mode: 'proxy_list',
      proxyRules: '',
      directRules: '',
      bypassLocal: false,
      gfwListUrl: '',
    },
    EMPTY_PROXY_RULE_SET(),
    parsed.rules,
    { gfwlist: EMPTY_PROXY_RULE_SET(), gfwlistAvailable: false },
  ).action,
  'proxy',
);
assert.strictEqual(parseProxyRules('https://example.com/path').ok, false);
assert.strictEqual(parseProxyRules('example.com\nnot valid').errorLine, 2);

const directRules = parseProxyRules('direct.example').rules;
const proxyRules = parseProxyRules('proxy.example').rules;
const routing = {
  mode: 'bypass_mainland',
  proxyRules: '',
  directRules: '',
  bypassLocal: true,
  gfwListUrl: '',
};
const data = {
  gfwlist: parseProxyRules('blocked.example\n203.0.113.0/24').rules,
  gfwlistAvailable: true,
};
assert.strictEqual(
  decideProxyRoute('localhost', routing, directRules, proxyRules, data).action,
  'direct',
);
assert.strictEqual(
  decideProxyRoute('direct.example', routing, directRules, proxyRules, data).source,
  'direct_rule',
);
assert.strictEqual(
  decideProxyRoute('blocked.example', routing, directRules, proxyRules, data).action,
  'proxy',
);
assert.strictEqual(
  decideProxyRoute('foreign.example', routing, directRules, proxyRules, data, ['198.51.100.2']).action,
  'direct',
);
assert.strictEqual(
  decideProxyRoute(
    'blocked.example',
    { ...routing, mode: 'proxy_mainland' },
    directRules,
    proxyRules,
    data,
  ).action,
  'direct',
);
assert.strictEqual(
  decideProxyRoute(
    'foreign.example',
    { ...routing, mode: 'proxy_mainland' },
    directRules,
    proxyRules,
    data,
    ['198.51.100.2'],
  ).action,
  'proxy',
);
assert.strictEqual(
  decideProxyRoute(
    'ordinary.example',
    routing,
    directRules,
    proxyRules,
    { gfwlist: EMPTY_PROXY_RULE_SET(), gfwlistAvailable: false },
  ).action,
  'proxy',
);

const gfw = parseGfwList('||google.com\n@@||allowed.example\n! comment');
assert.strictEqual(gfw.ok, true);
assert.strictEqual(gfw.rules.suffixDomains.includes('google.com'), true);
const encodedGfw = Buffer.from(
  '[AutoProxy 0.2.9]\n||google.com\n||slash-test.example/path\n',
).toString('base64');
assert.strictEqual(parseGfwList(encodedGfw).rules.suffixDomains.includes('google.com'), true);

const pac = generateProxyPac(
  routing,
  directRules,
  proxyRules,
  data,
  'PROXY 127.0.0.1:8080',
);
assert.match(pac, /function FindProxyForURL/);
assert.match(pac, /PROXY 127\.0\.0\.1:8080/);
assert.doesNotMatch(pac, /typeof dnsResolve(?:Ex)?/);

const executePac = (mode, host, available = true) => {
  const script = generateProxyPac(
    { ...routing, mode },
    directRules,
    proxyRules,
    { ...data, gfwlistAvailable: available },
    'PROXY 127.0.0.1:8080',
  );
  const context = {
    dnsResolve: () => {
      throw new Error('PAC must not use the local DNS resolver');
    },
    dnsResolveEx: () => {
      throw new Error('PAC must not use the local DNS resolver');
    },
  };
  vm.runInNewContext(script, context);
  return context.FindProxyForURL(`https://${host}/`, host);
};

assert.strictEqual(executePac('bypass_mainland', 'blocked.example'), 'PROXY 127.0.0.1:8080');
assert.strictEqual(executePac('bypass_mainland', 'ordinary.example'), 'DIRECT');
assert.strictEqual(executePac('proxy_mainland', 'blocked.example'), 'DIRECT');
assert.strictEqual(executePac('proxy_mainland', 'ordinary.example'), 'PROXY 127.0.0.1:8080');
assert.strictEqual(executePac('bypass_mainland', 'ordinary.example', false), 'PROXY 127.0.0.1:8080');
console.log('proxy routing tests passed');
