const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const compileModule = (sourceFile) => ts.transpileModule(
  fs.readFileSync(sourceFile, 'utf8'), {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2019,
  },
  fileName: sourceFile,
}).outputText;

const urlSourceFile = path.resolve(__dirname, '../src/utils/url.ts');
const urlModule = { exports: {} };
new Function('module', 'exports', 'require', compileModule(urlSourceFile))(
  urlModule,
  urlModule.exports,
  (id) => (id === './tld-list' ? { TLD_LIST: [] } : require(id)),
);

const chromeThemeSourceFile = path.resolve(__dirname, '../src/common/chrome-theme.ts');
const chromeThemeModule = { exports: {} };
new Function('module', 'exports', 'require', compileModule(chromeThemeSourceFile))(
  chromeThemeModule,
  chromeThemeModule.exports,
  (id) => (id === '~/interfaces' ? {} : require(id)),
);

const sourceFile = path.resolve(__dirname, '../src/main/workspace-service.ts');
const compiled = compileModule(sourceFile);

const ipcMain = { handle() {}, on() {} };
const compiledModule = { exports: {} };
const localRequire = (id) => {
  if (id === 'electron') return { ipcMain };
  if (id === './application') return { Application: { instance: {} } };
  if (id === './i18n') return { getMainTranslator: () => (key) => key };
  if (id === '~/interfaces') {
    return {
      WORKSPACE_COLORS: [
        '#2563eb', '#0891b2', '#059669', '#d97706',
        '#dc2626', '#db2777', '#7c3aed', '#475569',
      ],
    };
  }
  if (id === '~/utils/url') return urlModule.exports;
  return require(id);
};
new Function('module', 'exports', 'require', compiled)(compiledModule, compiledModule.exports, localRequire);

const { normalizeSnapshot, isRestorableUrl } = compiledModule.exports;
assert.strictEqual(isRestorableUrl('https://example.com'), true);
assert.strictEqual(isRestorableUrl('chrome-extension://blocked'), false);
assert.strictEqual(isRestorableUrl('about:blank/'), false);
assert.strictEqual(isRestorableUrl('data:text/html,blocked'), false);
assert.strictEqual(isRestorableUrl('yjllq://newtab'), true);

const { mixCssColors } = chromeThemeModule.exports;
assert.strictEqual(mixCssColors('rgba(60, 82, 184, 0.1)', '#dc2626', 0.2), 'rgb(92, 73, 155)');
assert.strictEqual(mixCssColors('rgb(255, 255, 255)', '#2563eb', 0.12), 'rgb(229, 236, 253)');

const result = normalizeSnapshot({
  groups: [{ key: 'group-a', name: '研究', color: '#2563eb' }],
  tabs: [
    { key: 'second', url: 'https://two.example', order: 8, groupKey: 'missing' },
    { key: 'first', url: 'https://one.example', order: 2 },
    { key: 'internal', url: 'chrome://settings', order: 1 },
  ],
});
assert.deepStrictEqual(result.tabs.map((tab) => tab.key), ['first', 'second']);
assert.deepStrictEqual(result.tabs.map((tab) => tab.order), [0, 1]);
assert.strictEqual(result.tabs.filter((tab) => tab.active).length, 1);
assert.strictEqual(result.tabs[1].groupKey, undefined);

console.log('workspace snapshot tests passed');
