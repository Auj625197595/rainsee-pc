const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/common/internal-flags.ts');
const source = fs.readFileSync(filename, 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2019,
  },
  fileName: filename,
}).outputText;
const loaded = {exports: {}};
new Function('module', 'exports', output)(loaded, loaded.exports);

const {
  getInternalFlagsRedirectTarget,
  resolveInternalFlagsUrl,
} = loaded.exports;
const nativeUrl = 'yjllq://flags/';

assert.strictEqual(resolveInternalFlagsUrl('chrome://flags', nativeUrl), nativeUrl);
assert.strictEqual(resolveInternalFlagsUrl('chrome://flags/', nativeUrl), nativeUrl);
assert.strictEqual(
  resolveInternalFlagsUrl('chrome://flags/#enable-test', nativeUrl),
  'yjllq://flags/#enable-test',
);
assert.strictEqual(
  resolveInternalFlagsUrl('yjllq://flags////#enable-test', nativeUrl),
  'yjllq://flags/#enable-test',
);
assert.strictEqual(resolveInternalFlagsUrl('https://example.com', nativeUrl), '');

assert.strictEqual(
  getInternalFlagsRedirectTarget('chrome://flags/', nativeUrl),
  nativeUrl,
);
assert.strictEqual(
  getInternalFlagsRedirectTarget('yjllq://flags', nativeUrl),
  nativeUrl,
);
assert.strictEqual(
  getInternalFlagsRedirectTarget('yjllq://flags//', nativeUrl),
  nativeUrl,
);
assert.strictEqual(
  getInternalFlagsRedirectTarget('yjllq://flags/', nativeUrl),
  '',
);
assert.strictEqual(
  getInternalFlagsRedirectTarget('yjllq://flags/#enable-test', nativeUrl),
  '',
);

for (let slashCount = 1; slashCount <= 100; slashCount += 1) {
  const restoredUrl = `yjllq://flags${'/'.repeat(slashCount)}`;
  const redirect = getInternalFlagsRedirectTarget(restoredUrl, nativeUrl);
  assert.ok(redirect === '' || redirect === nativeUrl);
  assert.strictEqual(getInternalFlagsRedirectTarget(redirect || restoredUrl, nativeUrl), '');
}

console.log('internal flags URL tests passed');
