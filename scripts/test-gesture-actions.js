const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const readSource = (relativePath) =>
  fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
    },
  }).outputText;

const actionsModule = { exports: {} };
new Function('module', 'exports', transpile(readSource('src/main/menus/gesture-actions.ts')))(
  actionsModule,
  actionsModule.exports,
);
const { effectiveShape, resolveGestures, localizeGestureActions, buildGestureConfig } =
  actionsModule.exports;
const catalog = JSON.parse(readSource('src/common/locales/zh-CN.json'));
const translate = (key) => catalog[key];
assert.strictEqual(effectiveShape('close-all-tabs'), 'RD');
assert.strictEqual(resolveGestures().RD, 'close-all-tabs');
assert.strictEqual(buildGestureConfig({}, translate).labels['close-all-tabs'], '关闭所有标签');
assert(localizeGestureActions(translate).some(
  (action) => action.id === 'close-all-tabs' && action.category === 'tabs',
));
assert.strictEqual(resolveGestures({ 'close-all-tabs': null }).RD, undefined);
assert.strictEqual(resolveGestures({ 'close-all-tabs': 'UR' }).UR, 'close-all-tabs');
// An existing custom binding must win over the newly added default.
assert.strictEqual(resolveGestures({ back: 'RD' }).RD, 'back');
assert.strictEqual(effectiveShape('close-all-tabs', { back: 'RD' }), null);

const parse = (filename) => ts.createSourceFile(
  filename, readSource(filename), ts.ScriptTarget.Latest, true,
);
const findNode = (source, predicate) => {
  let found;
  const visit = (node) => {
    if (found) return;
    if (predicate(node)) found = node;
    else ts.forEachChild(node, visit);
  };
  visit(source);
  assert(found, 'Expected implementation node');
  return found;
};

// Execute the real renderer handler against a list that grows when the last
// tab closes, as ITab.close does when it opens a replacement new tab.
const tabsSource = parse('src/renderer/views/app/store/tabs.ts');
const listener = findNode(tabsSource, (node) =>
  ts.isCallExpression(node) && node.expression.getText(tabsSource) === 'ipcRenderer.on' &&
  node.arguments[0]?.text === 'close-all-tabs',
);
const store = { list: [] };
const closed = [];
const replacement = { id: 99, isClosing: false };
const makeTab = (id, extras = {}) => ({
  id,
  isClosing: false,
  isSelected: false,
  ...extras,
  close() {
    assert(!this.isClosing, 'Must skip tabs already closing');
    closed.push(id);
    this.isClosing = true;
    if (store.list.every((tab) => tab.isClosing)) store.list.push(replacement);
  },
});
store.list = [
  makeTab(1, { isSelected: true }),
  makeTab(2, { isPinned: true }),
  makeTab(3, { tabGroupId: 7 }),
  makeTab(4, { discarded: true }),
  makeTab(5, { isClosing: true }),
];
let immersiveHeader = false;
const closeAll = new Function(
  'isImmersiveHeaderWindow',
  transpile(`const handler = ${listener.arguments[1].getText(tabsSource)}; return handler;`),
).call(store, () => immersiveHeader);
immersiveHeader = true;
closeAll();
assert.deepStrictEqual(closed, []);
immersiveHeader = false;

// Execute the actual main-process dispatch and route only to the source window.
const applicationSource = parse('src/main/application.ts');
const dispatch = findNode(applicationSource, (node) =>
  ts.isMethodDeclaration(node) && node.name.getText(applicationSource) === 'runGestureAction',
);
const TestApplication = new Function(
  'webContents',
  transpile(`class TestApplication { ${dispatch.getText(applicationSource)} } return TestApplication;`),
)({ fromId: () => undefined });
const application = new TestApplication();
application.windows = {
  findByBrowserView: (id) => id === 42 ? {
    send: (channel) => {
      assert.strictEqual(channel, 'close-all-tabs');
      closeAll();
    },
  } : undefined,
};
application.runGestureAction(resolveGestures().RD, 43);
assert.deepStrictEqual(closed, []);
application.runGestureAction(resolveGestures().RD, 42);
assert.deepStrictEqual(closed, [2, 3, 4, 1]);
assert.strictEqual(store.list.filter((tab) => !tab.isClosing)[0], replacement);
console.log('gesture action configuration and close-all dispatch tests passed');
