const assert = require('assert');
const fs = require('fs');
const path = require('path');
const typescript = require('typescript');

const filename = path.join(
  __dirname,
  '..',
  'src',
  'main',
  'services',
  'gesture-recognizer.ts',
);
const output = typescript.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: {
    module: typescript.ModuleKind.CommonJS,
    target: typescript.ScriptTarget.ES2019,
  },
  fileName: filename,
}).outputText;
const moduleValue = { exports: {} };
new Function('module', 'exports', output)(moduleValue, moduleValue.exports);
const { recognizeGesture } = moduleValue.exports;

const nativeFilename = path.join(
  __dirname,
  '..',
  'src',
  'main',
  'services',
  'native-right-gesture.ts',
);
const nativeOutput = typescript.transpileModule(
  fs.readFileSync(nativeFilename, 'utf8'),
  {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2019,
    },
    fileName: nativeFilename,
  },
).outputText;
const nativeModule = { exports: {} };
new Function('module', 'exports', 'require', nativeOutput)(
  nativeModule,
  nativeModule.exports,
  (request) => {
    if (request === './gesture-recognizer') return moduleValue.exports;
    throw new Error(`unexpected test dependency: ${request}`);
  },
);
const { NativeRightGesture } = nativeModule.exports;

assert.strictEqual(
  recognizeGesture([
    { x: 0, y: 0 },
    { x: 23, y: 0 },
  ]),
  null,
);
assert.strictEqual(
  recognizeGesture([
    { x: 0, y: 0 },
    { x: 30, y: 0 },
  ]),
  'R',
);
assert.strictEqual(
  recognizeGesture([
    { x: 30, y: 0 },
    { x: 0, y: 0 },
  ]),
  'L',
);
assert.strictEqual(
  recognizeGesture([
    { x: 0, y: 30 },
    { x: 0, y: 0 },
  ]),
  'U',
);
assert.strictEqual(
  recognizeGesture([
    { x: 0, y: 0 },
    { x: 0, y: 30 },
  ]),
  'D',
);
assert.strictEqual(
  recognizeGesture([
    { x: 0, y: 0 },
    { x: 0, y: 30 },
    { x: 30, y: 30 },
  ]),
  'DR',
);
assert.strictEqual(
  recognizeGesture([
    { x: 0, y: 0 },
    { x: 14, y: 0 },
    { x: 30, y: 0 },
  ]),
  'R',
);

const dispatched = [];
const nativeGesture = new NativeRightGesture(
  () => ({
    enabled: true,
    color: '#123456',
    map: { R: 'forward' },
    labels: { forward: '前进' },
  }),
  (actionId) => dispatched.push(actionId),
);
let prevented = 0;
const preventable = { preventDefault: () => prevented++ };
assert.strictEqual(
  nativeGesture.handle(preventable, {
    type: 'mouseDown',
    button: 'right',
    x: 0,
    y: 0,
  }).phase,
  'start',
);
const moveUpdate = nativeGesture.handle(preventable, {
  type: 'mouseMove',
  x: 30,
  y: 0,
});
assert.strictEqual(moveUpdate.phase, 'move');
assert.strictEqual(moveUpdate.engaged, true);
const endUpdate = nativeGesture.handle(preventable, {
  type: 'mouseUp',
  button: 'right',
  x: 30,
  y: 0,
});
assert.strictEqual(endUpdate.label, '前进');
assert.deepStrictEqual(dispatched, []);
nativeGesture.handle(preventable, {
  type: 'contextMenu',
  button: 'right',
  x: 30,
  y: 0,
});
assert.strictEqual(prevented, 1);
assert.deepStrictEqual(dispatched, ['forward']);

nativeGesture.handle(preventable, {
  type: 'mouseDown',
  button: 'right',
  x: 0,
  y: 0,
});
nativeGesture.handle(preventable, {
  type: 'mouseMove',
  x: 30,
  y: 0,
});
nativeGesture.handle(preventable, {
  type: 'mouseLeave',
  x: 30,
  y: 0,
});
nativeGesture.handle(preventable, {
  type: 'contextMenu',
  button: 'right',
  x: 30,
  y: 0,
});
assert.strictEqual(prevented, 2);
assert.strictEqual(nativeGesture.consumeContextMenuSuppression(), true);
assert.strictEqual(nativeGesture.consumeContextMenuSuppression(), false);

nativeGesture.handle(preventable, {
  type: 'mouseDown',
  button: 'right',
  x: 0,
  y: 0,
});
nativeGesture.handle(preventable, {
  type: 'mouseUp',
  button: 'right',
  x: 5,
  y: 0,
});
nativeGesture.handle(preventable, {
  type: 'contextMenu',
  button: 'right',
  x: 5,
  y: 0,
});
assert.strictEqual(prevented, 2);
assert.deepStrictEqual(dispatched, ['forward']);

console.log('gesture recognizer and native state tests passed');
