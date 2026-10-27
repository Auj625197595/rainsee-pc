const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/main/window-state.ts');
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

const {getWindowStateFileNames, loadWindowState} = loaded.exports;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rainsee-window-state-'));

try {
  const normalNames = getWindowStateFileNames(false);
  const incognitoNames = getWindowStateFileNames(true);
  assert.strictEqual(normalNames.primary, 'window-data.json');
  assert.strictEqual(normalNames.fallback, undefined);
  assert.strictEqual(incognitoNames.primary, 'incognito-window-data.json');
  assert.strictEqual(incognitoNames.fallback, 'window-data.json');

  const normalPath = path.join(root, normalNames.primary);
  const incognitoPath = path.join(root, incognitoNames.primary);
  const normalState = {
    bounds: {x: 20, y: 30, width: 1400, height: 900},
    maximized: true,
  };
  fs.writeFileSync(normalPath, JSON.stringify(normalState));

  assert.deepStrictEqual(
    loadWindowState([incognitoPath, normalPath]),
    normalState,
    'first incognito launch must fall back to normal window geometry',
  );

  const incognitoState = {
    bounds: {x: 100, y: 120, width: 900, height: 600},
    maximized: false,
  };
  fs.writeFileSync(incognitoPath, JSON.stringify(incognitoState));
  assert.deepStrictEqual(
    loadWindowState([incognitoPath, normalPath]),
    incognitoState,
    'incognito state must take priority once it has been saved separately',
  );
  assert.deepStrictEqual(
    loadWindowState([normalPath]),
    normalState,
    'incognito state must not alter normal window state',
  );
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}

console.log('window state isolation tests passed');
