// Merge scripts/i18n-keys/*.json into src/common/locales/{zh-CN,en-US}.json.
// Fails loudly on: duplicate key with different text, missing en value.
const fs = require('fs');
const path = require('path');

const keysDir = path.join(__dirname, 'i18n-keys');
const zhPath = path.join(__dirname, '..', 'src', 'common', 'locales', 'zh-CN.json');
const enPath = path.join(__dirname, '..', 'src', 'common', 'locales', 'en-US.json');
const zh = JSON.parse(fs.readFileSync(zhPath, 'utf8'));
const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));

let added = 0;
const conflicts = [];
for (const file of fs.readdirSync(keysDir).filter(f => f.endsWith('.json')).sort()) {
  const entries = JSON.parse(fs.readFileSync(path.join(keysDir, file), 'utf8'));
  for (const [key, pair] of Object.entries(entries)) {
    if (!Array.isArray(pair) || pair.length !== 2 || !pair[0] || !pair[1]) {
      conflicts.push(`${file}:${key} — malformed entry (need ["zh","en"])`);
      continue;
    }
    const [z, e] = pair;
    if (zh[key] !== undefined && zh[key] !== z) {
      conflicts.push(`zh-CN:${key} — existing "${zh[key]}" vs new "${z}"`);
      continue;
    }
    if (en[key] !== undefined && en[key] !== e) {
      conflicts.push(`en-US:${key} — existing "${en[key]}" vs new "${e}"`);
      continue;
    }
    if (zh[key] === undefined && en[key] === undefined) added++;
    zh[key] = z;
    en[key] = e;
  }
}

if (conflicts.length) {
  console.error('CONFLICTS:');
  for (const c of conflicts) console.error('  ' + c);
  process.exit(1);
}

// keep key order stable: append new keys at end, preserving original order first
const sortLike = (src, ref) => {
  const out = {};
  for (const k of Object.keys(ref)) out[k] = src[k];
  for (const k of Object.keys(src)) if (!(k in out)) out[k] = src[k];
  return out;
};
fs.writeFileSync(zhPath, JSON.stringify(sortLike(zh, zh), null, 2) + '\n');
fs.writeFileSync(enPath, JSON.stringify(sortLike(en, en), null, 2) + '\n');
console.log(`merged OK. new keys added: ${added}. totals: zh=${Object.keys(zh).length} en=${Object.keys(en).length}`);
if (Object.keys(zh).length !== Object.keys(en).length) {
  console.error('WARN: key count mismatch between locales');
}
