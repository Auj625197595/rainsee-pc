const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const filename = path.resolve(
  __dirname,
  '../src/vendor/electron-chrome-extensions/browser/api/lib/winreg.ts',
);
const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2019,
  },
}).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', output)(
  require,
  loaded,
  loaded.exports,
);

const { parseRegistryQueryOutput } = loaded.exports;
const manifest =
  'C:/Users/test/AppData/Local/KeePassXC/org.keepassxc.keepassxc_browser.json';

assert.strictEqual(
  parseRegistryQueryOutput(
    `HKEY_CURRENT_USER\\Software\\NativeMessagingHosts\r\n    (Default)    REG_SZ    ${manifest}\r\n`,
  ),
  manifest,
);
assert.strictEqual(
  parseRegistryQueryOutput(
    `HKEY_CURRENT_USER\\Software\\NativeMessagingHosts\r\n    (Ĭ��)    REG_SZ    ${manifest}\r\n`,
  ),
  manifest,
);
assert.strictEqual(
  parseRegistryQueryOutput(
    'HKEY_CURRENT_USER\\Software\\Example\r\n    InstallPath    REG_SZ    C:\\Program Files\\Example\r\n',
    'installpath',
  ),
  'C:\\Program Files\\Example',
);
assert.strictEqual(parseRegistryQueryOutput('HKEY_CURRENT_USER\\Software\\Empty'), null);

console.log('winreg parser regression tests passed');
