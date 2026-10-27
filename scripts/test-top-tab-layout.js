const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const loadTypeScriptModule = (relativePath) => {
  const filename = path.resolve(__dirname, '..', relativePath);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
    },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} };
  new Function(
    'require',
    'module',
    'exports',
    '__filename',
    '__dirname',
    output,
  )(require, loaded, loaded.exports, filename, path.dirname(filename));
  return loaded.exports;
};

const { calculateTopTabRows } = loadTypeScriptModule(
  'src/renderer/views/app/utils/top-tab-layout.ts',
);
const { normalizeTopTabRows } = loadTypeScriptModule(
  'src/common/top-tab-rows.ts',
);
const { TAB_MAX_WIDTH, TAB_MIN_WIDTH, TAB_WRAP_WIDTH } = loadTypeScriptModule(
  'src/renderer/views/app/constants/tabs.ts',
);

const assertContiguous = (layout, itemCount) => {
  let cursor = 0;
  layout.ranges.forEach((range, row) => {
    assert.strictEqual(range.start, cursor);
    assert(range.end > range.start);
    for (let index = range.start; index < range.end; index++) {
      assert.strictEqual(layout.rowByIndex[index], row);
    }
    cursor = range.end;
  });
  assert.strictEqual(cursor, itemCount);
};

let layout = calculateTopTabRows([], 500, 5);
assert.deepStrictEqual(layout, { rows: 1, rowByIndex: [], ranges: [] });

layout = calculateTopTabRows([72, 72, 72], 500, 5);
assert.strictEqual(layout.rows, 1);
assertContiguous(layout, 3);

layout = calculateTopTabRows([80, 80, 80, 80, 80, 80], 250, 5);
assert.strictEqual(layout.rows, 2);
assert.deepStrictEqual(layout.ranges, [
  { start: 0, end: 3 },
  { start: 3, end: 6 },
]);
assertContiguous(layout, 6);

layout = calculateTopTabRows(new Array(10).fill(80), 250, 2);
assert.strictEqual(layout.rows, 2);
assert.deepStrictEqual(
  layout.ranges.map((range) => range.end - range.start),
  [5, 5],
);
assertContiguous(layout, 10);

// Shrink mode feeds preferred-width footprints into the same calculator, so
// it consumes configured rows before reducing tabs toward their minimum size.
layout = calculateTopTabRows(new Array(5).fill(246), 972, 5);
assert.strictEqual(layout.rows, 2);
assert.deepStrictEqual(
  layout.ranges.map((range) => range.end - range.start),
  [3, 2],
);

layout = calculateTopTabRows(new Array(9).fill(246), 1476, 5);
assert.deepStrictEqual(
  layout.ranges.map((range) => range.end - range.start),
  [6, 3],
);

layout = calculateTopTabRows(new Array(11).fill(246), 1450, 3, {
  previousRows: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, undefined],
  minimumFootprints: new Array(11).fill(78),
});
assert.deepStrictEqual(layout.ranges, [
  { start: 0, end: 5 },
  { start: 5, end: 11 },
]);

layout = calculateTopTabRows(new Array(13).fill(246), 972, 3);
assert.strictEqual(layout.rows, 3);
assertContiguous(layout, 13);

layout = calculateTopTabRows(new Array(4).fill(246), 900, 5, {
  previousRows: [0, 0, 0, undefined],
  minimumFootprints: new Array(4).fill(78),
});
assert.deepStrictEqual(layout.ranges, [
  { start: 0, end: 3 },
  { start: 3, end: 4 },
]);

layout = calculateTopTabRows(new Array(5).fill(246), 972, 5, {
  previousRows: [0, 0, 0, 1, undefined],
  minimumFootprints: new Array(5).fill(78),
});
assert.deepStrictEqual(layout.ranges, [
  { start: 0, end: 3 },
  { start: 3, end: 5 },
]);

// Closing from an earlier row must not leave a full-tab-sized hole there.
layout = calculateTopTabRows(new Array(5).fill(246), 1000, 5, {
  previousRows: [0, 0, 0, 1, 1],
  minimumFootprints: new Array(5).fill(78),
});
assert.deepStrictEqual(layout.ranges, [
  { start: 0, end: 4 },
  { start: 4, end: 5 },
]);

// At the row limit, reflow only the minimum number of existing slots needed
// to keep the crowded row at or above its minimum width.
layout = calculateTopTabRows(new Array(7).fill(200), 300, 2, {
  previousRows: [0, 0, 1, 1, 1, 1, 1],
  minimumFootprints: new Array(7).fill(75),
});
assert.deepStrictEqual(layout.ranges, [
  { start: 0, end: 3 },
  { start: 3, end: 7 },
]);

let previousRows = [];
for (let count = 1; count <= 40; count++) {
  layout = calculateTopTabRows(new Array(count).fill(246), 972, 3, {
    previousRows: [...previousRows, undefined],
    minimumFootprints: new Array(count).fill(78),
  });
  const movedExisting = previousRows.filter(
    (row, index) => layout.rowByIndex[index] !== row,
  ).length;
  assert(
    movedExisting <= layout.rows - 1,
    `append ${count} moved ${movedExisting} existing slots`,
  );
  previousRows = layout.rowByIndex;
}

layout = calculateTopTabRows([40, 300, 72, 72], 350, 5);
assert.strictEqual(layout.rows, 2);
assert.deepStrictEqual(layout.ranges, [
  { start: 0, end: 2 },
  { start: 2, end: 4 },
]);
assertContiguous(layout, 4);

layout = calculateTopTabRows(new Array(20).fill(100), 100, 99);
assert.strictEqual(layout.rows, 5);
assertContiguous(layout, 20);

assert.strictEqual(normalizeTopTabRows(undefined), 1);
assert.strictEqual(normalizeTopTabRows('3'), 1);
assert.strictEqual(normalizeTopTabRows(Number.NaN), 1);
assert.strictEqual(normalizeTopTabRows(-2), 1);
assert.strictEqual(normalizeTopTabRows(2.6), 3);
assert.strictEqual(normalizeTopTabRows(9), 5);
assert(TAB_WRAP_WIDTH < TAB_MAX_WIDTH);
assert(TAB_WRAP_WIDTH > TAB_MIN_WIDTH);

layout = calculateTopTabRows(new Array(14).fill(TAB_WRAP_WIDTH + 6), 1450, 3, {
  minimumFootprints: new Array(14).fill(TAB_MIN_WIDTH + 6),
});
assert.strictEqual(layout.rows, 2);
assert.deepStrictEqual(
  layout.ranges.map((range) => range.end - range.start),
  [7, 7],
);

// Single-row pitch remains unchanged; multi-row compaction is selected at
// runtime from the visible tab surface height.
const designSource = fs.readFileSync(
  path.resolve(__dirname, '..', 'src/constants/design.ts'),
  'utf8',
);
assert(designSource.includes('export const DEFAULT_TAB_ROW_PITCH = DEFAULT_TAB_HEIGHT + 8;'));
assert(designSource.includes('export const COMPACT_TAB_ROW_PITCH = COMPACT_TAB_HEIGHT + 8;'));

console.log('top tab layout tests passed');
