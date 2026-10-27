const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/common/browser-internal-url.ts');
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

const {parseBrowserInternalUrl} = loaded.exports;

assert.deepStrictEqual(parseBrowserInternalUrl('chrome://extensions/'), {
  page: 'extensions',
  suffix: '',
});
assert.deepStrictEqual(parseBrowserInternalUrl('edge://history/?q=rainsee#top'), {
  page: 'history',
  suffix: '?q=rainsee#top',
});
assert.deepStrictEqual(parseBrowserInternalUrl('chrome://flags/#test-flag'), {
  page: 'flags',
  suffix: '#test-flag',
});

for (const invalid of [
  'https://example.com',
  'chrome://password-manager',
  'chrome://extensions/detail/example',
  'chrome://extensions.example.com',
  '',
  null,
]) {
  assert.strictEqual(parseBrowserInternalUrl(invalid), null);
}

console.log('browser internal URL tests passed');
