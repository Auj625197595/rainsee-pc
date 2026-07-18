// One-shot cleanup for extension JS poisoned by a historical SHIM orphan
// (SHIM_v2 IIFE-era force-repatch left marker-less body fragments). Scans
// data/extensions/**/*.js, finds syntax-broken files, locates the original
// host JS (after the last SHIM terminator `})();\n`), re-prepends current SHIM.
// Verifies via `node --check` with a .mjs/.cjs temp file so ES-module chunks
// (popup/options use `import {}`) are validated correctly — new Function() can't
// parse `import`.
//   node scripts/_clean-shim-orphan.js           (dry-run)
//   node scripts/_clean-shim-orphan.js --write   (apply)
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'extension-storage-patch.ts'), 'utf8');
function findExpr(s, k1, k2) {
  const a = s.indexOf(k1); const b = s.indexOf(k2, a); let e = b;
  for (let i = a + k1.length; i < b;) {
    const c = s[i], c2 = s[i + 1];
    if (c === '/' && c2 === '/') { while (i < b && s[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') { i += 2; while (i < b && !(s[i] === '*' && s[i + 1] === '/')) i++; i++; continue; }
    if (c === '`' || c === "'" || c === '"') { const q = c; i++; while (i < b) { if (s[i] === '\\') { i += 2; continue; } if (s[i] === q) break; i++; } continue; }
    if (c === ';') { e = i; break; }
    i++;
  }
  return s.slice(a + k1.length, e);
}
const SHIM_BODY = eval(findExpr(src, 'const SHIM_BODY = ', 'const SHIM_VERSION = '));
const SHIM_VERSION = crypto.createHash('sha256').update(SHIM_BODY).digest('hex').slice(0, 12);
const MARKER = `/*__crx_storage_sync_shim_${SHIM_VERSION}__*/`;
const SHIM = MARKER + SHIM_BODY;
const SIGS = ['__crx', '[crx-', 'crx-msg', 'invokeExtension', '__crxShimInstalled', '__crxPortBroker'];

let _uid = 0;
function syntaxOK(code) {
  // SHIM is a CommonJS-style IIFE; host JS may be an ES module (import/export).
  // Validate as .mjs when the code looks modular, else .cjs. node --check on a
  // temp file handles both; new Function() can't parse `import`.
  const isModule = /^\s*(import|export)\b/m.test(code);
  const f = path.join(os.tmpdir(), `crxclean-${process.pid}-${_uid++}${isModule ? '.mjs' : '.cjs'}`);
  try {
    fs.writeFileSync(f, code);
    try { execFileSync('node', ['--check', f], { stdio: 'ignore' }); return true; } catch (e) { return false; }
  } finally { try { fs.unlinkSync(f); } catch (_) {} }
}

function cleanFile(file, write) {
  const bg = fs.readFileSync(file, 'utf8');
  let lastSig = -1;
  for (const sig of SIGS) { let i = 0; while ((i = bg.indexOf(sig, i + 1)) !== -1) if (i > lastSig) lastSig = i; }
  if (lastSig < 0) { console.log(`[skip] ${path.relative(path.join(__dirname, '..'), file)}  no SHIM signature — not a SHIM file`); return false; }
  const term = bg.indexOf('})();\n', lastSig);
  const cut = term >= 0 ? term + '})();'.length : lastSig;
  const original = bg.slice(cut).replace(/^[\r\n]+/, '');
  const origOK = syntaxOK(original);
  console.log(`${write ? '[write]' : '[dry ]'} ${path.relative(path.join(__dirname, '..'), file)}  lastSig=${lastSig} cut=${cut}/${bg.length} origOK=${origOK}`);
  if (!origOK) { console.log('   ABORT: original host JS not valid — skipping'); return false; }
  if (write) {
    fs.writeFileSync(file, SHIM + original, 'utf8');
    const verify = syntaxOK(original);
    console.log('   written, full-body re-check ' + (verify ? 'OK' : 'BAD'));
  }
  return true;
}

const write = process.argv.includes('--write');
const root = path.join(__dirname, '..', 'data', 'extensions');
let checked = 0, bad = 0;
function walk(d) {
  for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, ent.name);
    if (ent.isDirectory()) { if (ent.name === '_locales' || ent.name === 'node_modules') continue; walk(f); }
    else if (/\.js$/i.test(ent.name) && ent.name !== 'crx-shim.js' && ent.name !== '__crx_shim.js') {
      checked++;
      if (!syntaxOK(fs.readFileSync(f, 'utf8'))) { bad++; cleanFile(f, write); }
    }
  }
}
if (fs.existsSync(root)) walk(root);
console.log(`\nscanned ${checked} JS, ${bad} broken`);
