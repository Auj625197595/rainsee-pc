// End-to-end: simulate the patcher on a COPY of Dark Reader's popup/index.js —
// strip the leading marker-led shim block, prepend the NEW shim extracted from
// the bundle, and confirm the whole file parses. Does NOT touch the real file.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const popupFile = path.join(ROOT, 'data', 'extensions', 'eimadpbcbfnmbkopoojfekhnkhdbieeh', 'ui', 'popup', 'index.js');
const orig = fs.readFileSync(popupFile, 'utf8');

// Extract new shim from bundle (same logic as validate-shim-bundle.js).
const bundle = fs.readFileSync(path.join(ROOT, 'build', 'main.bundle.js'), 'utf8');
const needle = '(function(){try{var GB=';
const start = bundle.indexOf(needle);
let q = null, qi = -1;
for (let k = start - 1; k >= 0; k--) { const c = bundle[k]; if ((c === '"' || c === "'") && bundle[k - 1] !== '\\') { q = c; qi = k; break; } }
let shim = '';
for (let i = qi + 1; i < bundle.length; i++) {
  const c = bundle[i];
  if (c === '\\' && i + 1 < bundle.length) { const n = bundle[i + 1]; const map = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', "'": "'", '`': '`' }; if (n in map) { shim += map[n]; i++; } else { shim += n; i++; } }
  else if (c === q) break; else shim += c;
}

// Replicate stripLeadingShims EXACTLY (marker-led block anywhere). The real
// patcher requires a trailing ';' so it only matches the OUTER shim terminator,
// never an inner `})()` IIFE.
const re = /\/\*__crx_storage_sync_shim_[^*]*\*\/\s*\(function\s*\(\s*\)\s*\{[\s\S]*?\}\s*\)\s*\(\s*\)\s*;\r?\n?/g;
const stripped = orig.replace(re, '');
const patched = shim + stripped;

console.log('orig length:', orig.length, 'stripped length:', stripped.length, 'patched length:', patched.length);
console.log('stripped starts:', JSON.stringify(stripped.slice(0, 80)));
try { new Function(stripped); console.log('STRIPPED alone: parses OK'); }
catch (e) { console.log('STRIPPED alone: ERROR ->', e.message); }
console.log('shim ends with:', JSON.stringify(shim.slice(-12)));
try {
  new Function(patched);
  console.log('PATCHED popup/index.js: PARSES OK (end-to-end shim swap valid)');
} catch (e) {
  console.error('PATCHED popup/index.js: SYNTAX ERROR ->', e.message);
  process.exit(1);
}
// Also confirm the marker line count is exactly 1 (no orphan old shim left).
const markers = patched.match(/\/\*__crx_storage_sync_shim_/g) || [];
console.log('marker count in patched file:', markers.length, '(expect 1)');
