const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function loadBookmarksBridge() {
  const filename = path.resolve(
    __dirname,
    '../src/main/services/extension-bookmarks-history.ts',
  );
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
    },
    fileName: filename,
  }).outputText;
  const loaded = {exports: {}};
  const localRequire = (request) => {
    if (request === '~/interfaces' || request === './storage') return {};
    if (request.includes('electron-chrome-extensions/browser/impl')) return {};
    return require(request);
  };
  new Function('require', 'module', 'exports', output)(
    localRequire,
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}

async function main() {
  const {createBookmarksImpl} = loadBookmarksBridge();
  const calls = [];
  const storage = {
    bookmarks: [],
    async ensureBookmarksReady() {
      calls.push('ready');
      if (this.bookmarks.length) return;
      this.bookmarks.push(
        {_id: 'mobile', static: 'mobile', isFolder: true, order: 0},
        {_id: 'other', static: 'other', isFolder: true, order: 0},
        {_id: 'bar', static: 'main', isFolder: true, order: 0},
        {_id: 'folder', parent: 'bar', title: 'Folder', isFolder: true, order: 0},
        {_id: 'nested', parent: 'folder', title: 'Nested', url: 'https://nested.test/', order: 0},
        {_id: 'link', parent: 'bar', title: 'Link', url: 'https://example.test/', order: 1},
      );
    },
  };
  const bookmarks = createBookmarksImpl(storage);

  const tree = await bookmarks.getTree();
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(tree[0].children.map((node) => node.id), [
    'bar',
    'other',
    'mobile',
  ]);
  assert.strictEqual(tree[0].children[0].children[0].children[0].id, 'nested');

  const [folder] = await bookmarks.get(['folder']);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(folder, 'children'), false);
  const rootChildren = await bookmarks.getChildren('0');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(rootChildren[0], 'children'), false);
  const [subtree] = await bookmarks.getSubTree('folder');
  assert.strictEqual(subtree.children[0].id, 'nested');

  await assert.rejects(bookmarks.get(['missing']), /Can't find bookmark/);
  await assert.rejects(bookmarks.get([]), /must not be empty/);
  await assert.rejects(bookmarks.getChildren('missing'), /Can't find bookmark/);
  await assert.rejects(bookmarks.getSubTree('missing'), /Can't find bookmark/);
  await assert.rejects(bookmarks.getRecent(0), /cannot be less than 1/);
}

main().then(
  () => console.log('extension bookmarks regression tests passed'),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
