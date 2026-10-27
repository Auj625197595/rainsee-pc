// Audit Chinese strings in string literals (excluding comments) under src/main.
// Outputs per-file list of user-facing Chinese string candidates.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'src', 'main');
const results = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) scan(full);
  }
}

// Remove comments while preserving string literals so we can locate Chinese in code strings.
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let mode = 'code'; // code | line | block | squote | dquote | template
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
    // string modes: keep content, handle escapes, close on matching quote
    if (c === '\\') {
      out += mode === 'template' ? src[i] + (next ?? '') : src[i] + (next ?? '');
      i += 2; continue;
    }
    if (mode === 'squote' && c === "'") {mode = 'code'; out += "'"; i++; continue;}
    if (mode === 'dquote' && c === '"') {mode = 'code'; out += '"'; i++; continue;}
    if (mode === 'template' && c === '`') {mode = 'code'; out += '`'; i++; continue;}
    out += c; i++;
  }
  return out;
}

const CJK = /[一-鿿]/;

function scan(file) {
  const src = fs.readFileSync(file, 'utf8');
  const stripped = stripComments(src);
  const lines = stripped.split('\n');
  const hits = [];
  lines.forEach((line, idx) => {
    if (CJK.test(line)) {
      // extract the string-literal segments containing Chinese
      const segs = line.match(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g) || [];
      const chineseSegs = segs.filter(s => CJK.test(s));
      if (chineseSegs.length) hits.push({line: idx + 1, text: chineseSegs.map(s => s.slice(0, 160)).join(' | ')});
    }
  });
  if (hits.length) results.push({file: path.relative(ROOT, file), hits});
}

walk(ROOT);
for (const r of results) {
  console.log(`\n### ${r.file} (${r.hits.length})`);
  for (const h of r.hits) console.log(`  L${h.line}: ${h.text}`);
}
console.log(`\nTOTAL files: ${results.length}, strings: ${results.reduce((a, r) => a + r.hits.length, 0)}`);
