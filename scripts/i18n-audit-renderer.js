// Audit renderer files for remaining Chinese (code + JSX text, comments stripped).
const fs = require('fs');
const path = require('path');

const ROOTS = ['src/renderer', 'src/preloads'];

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) out.push(full);
  }
}

// Strip comments while keeping string/template/JSX content intact.
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let mode = 'code';
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && next === '/') {mode = 'line'; out += '  '; i += 2; continue;}
      if (c === '/' && next === '*') {mode = 'block'; out += '  '; i += 2; continue;}
      if (c === "'") {mode = 'squote'; out += ' '; i++; continue;}
      if (c === '"') {mode = 'dquote'; out += ' '; i++; continue;}
      if (c === '`') {mode = 'template'; out += ' '; i++; continue;}
      out += c; i++; continue;
    }
    if (mode === 'line') {
      if (c === '\n') {mode = 'code'; out += '\n';} else out += ' ';
      i++; continue;
    }
    if (mode === 'block') {
      if (c === '*' && next === '/') {mode = 'code'; out += '  '; i += 2; continue;}
      out += c === '\n' ? '\n' : ' '; i++; continue;
    }
    if (c === '\\') {out += c + (next ?? ''); i += 2; continue;}
    if (mode === 'squote' && c === "'") {mode = 'code'; out += "'"; i++; continue;}
    if (mode === 'dquote' && c === '"') {mode = 'code'; out += '"'; i++; continue;}
    if (mode === 'template' && c === '`') {mode = 'code'; out += '`'; i++; continue;}
    out += c; i++;
  }
  return out;
}

const CJK = /[一-鿿]/;
const results = [];
for (const root of ROOTS) {
  const files = [];
  walk(root, files);
  for (const f of files) {
    const stripped = stripComments(fs.readFileSync(f, 'utf8'));
    const lines = stripped.split('\n');
    const hits = [];
    lines.forEach((line, idx) => {
      if (CJK.test(line)) {
        const t = line.trim();
        if (t.length > 200) hits.push({line: idx + 1, text: t.slice(0, 160) + '…'});
        else hits.push({line: idx + 1, text: t});
      }
    });
    if (hits.length) results.push({file: path.relative('.', f), hits});
  }
}
for (const r of results) {
  console.log(`\n### ${r.file} (${r.hits.length})`);
  for (const h of r.hits.slice(0, 60)) console.log(`  L${h.line}: ${h.text}`);
}
console.log(`\nTOTAL files: ${results.length}, lines: ${results.reduce((a, r) => a + r.hits.length, 0)}`);
