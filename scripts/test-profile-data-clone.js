const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/main/profile-data-clone.ts');
const source = fs.readFileSync(filename, 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
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

const write = (root, relative, value) => {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, value, 'utf8');
};

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rainsee-profile-clone-'));
  const sourceRoot = path.join(temp, 'source');
  const destinationRoot = path.join(temp, 'destination');

  try {
    write(sourceRoot, 'settings.json', JSON.stringify({theme: 'wexond-dark'}));
    write(
      sourceRoot,
      'storage/bookmarks.db',
      '{"_id":"bookmark-1","url":"https://example.com"}\n{"broken":',
    );
    write(
      sourceRoot,
      'storage/formfill.db',
      '{"_id":"password-1","type":"password"}\n' +
        '{"_id":"address-1","type":"address"}\n',
    );
    write(sourceRoot, 'storage/history.db', '{"_id":"history-1"}\n');
    write(sourceRoot, 'storage/downloads.db', '{"_id":"download-1"}\n');
    write(sourceRoot, 'Cookies', 'must-not-be-copied');
    write(
      sourceRoot,
      'extensions/extension-id/manifest.json',
      JSON.stringify({name: 'Test extension', version: '1.0.0'}),
    );
    write(sourceRoot, 'extensions/extension-id/script.js', 'void 0;');
    write(sourceRoot, 'extensions/.staging/temporary.txt', 'ignore');
    write(
      sourceRoot,
      'crx-permissions.json',
      JSON.stringify({'extension-id': {permissions: ['tabs']}}),
    );

    await loaded.exports.cloneMainProfileData(sourceRoot, destinationRoot, {
      bookmarks: true,
      passwords: false,
      history: false,
      extensions: true,
      settings: false,
    });

    assert.strictEqual(
      fs.existsSync(path.join(destinationRoot, 'settings.json')),
      false,
    );
    assert.strictEqual(
      fs.readFileSync(path.join(destinationRoot, 'storage/bookmarks.db'), 'utf8'),
      '{"_id":"bookmark-1","url":"https://example.com"}\n',
    );
    assert.strictEqual(
      fs.existsSync(path.join(destinationRoot, 'storage/downloads.db')),
      false,
    );
    assert.strictEqual(
      fs.existsSync(path.join(destinationRoot, 'storage/formfill.db')),
      false,
    );
    assert.strictEqual(
      fs.existsSync(path.join(destinationRoot, 'storage/history.db')),
      false,
    );
    assert.strictEqual(fs.existsSync(path.join(destinationRoot, 'Cookies')), false);
    assert.strictEqual(
      fs.existsSync(path.join(destinationRoot, 'extensions/extension-id/script.js')),
      true,
    );
    assert.strictEqual(
      fs.existsSync(path.join(destinationRoot, 'extensions/.staging')),
      false,
    );
    assert.strictEqual(
      fs.existsSync(path.join(destinationRoot, 'crx-permissions.json')),
      true,
    );

    const passwordsDestination = path.join(temp, 'passwords-only');
    await loaded.exports.cloneMainProfileData(sourceRoot, passwordsDestination, {
      bookmarks: false,
      passwords: true,
      history: false,
      extensions: false,
      settings: false,
    });
    const passwordRecords = fs
      .readFileSync(path.join(passwordsDestination, 'storage/formfill.db'), 'utf8')
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.deepStrictEqual(passwordRecords, [
      {_id: 'password-1', type: 'password'},
    ]);
    assert.strictEqual(
      fs.existsSync(path.join(passwordsDestination, 'extensions')),
      false,
    );

    console.log('profile data clone tests passed');
  } finally {
    fs.rmSync(temp, {recursive: true, force: true});
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
