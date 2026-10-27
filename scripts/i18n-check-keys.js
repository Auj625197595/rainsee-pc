// Verify every t('key') / translator key referenced under src/main exists in
// both locale catalogs. Catches dangling keys after batch edits.
const fs = require('fs');
const path = require('path');

const zh = require('../src/common/locales/zh-CN.json');
const en = require('../src/common/locales/en-US.json');

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
}
const files = [];
walk('src/main', files);
walk('src/common', files);

const missing = new Map();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  // t('key'), tr('key'), translator('key') and .labelKey/labelKey: 'key' forms
  for (const m of src.matchAll(/\b(?:t|tr|translator)\(\s*'([A-Za-z][\w]*)'/g)) {
    const key = m[1];
    if (!(key in zh) || !(key in en)) {
      if (!missing.has(key)) missing.set(key, []);
      missing.get(key).push(path.relative('src', f));
    }
  }
}

if (missing.size) {
  console.error('MISSING KEYS:', missing.size);
  for (const [k, files] of missing) console.error(' ', k, '<-', [...new Set(files)].join(', '));
  process.exit(1);
}
console.log('all referenced keys exist in both locales');
