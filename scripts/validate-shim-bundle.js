// Extract the assembled SHIM_BODY string literal from the built main bundle and
// verify it parses. This is the ground truth (webpack already evaluated the
// backtick concatenation, so no comment/backtick ambiguity).
const fs = require('fs');
const path = require('path');

const bundle = fs.readFileSync(path.join(__dirname, '..', 'build', 'main.bundle.js'), 'utf8');
const needle = '(function(){try{var GB=';
const start = bundle.indexOf(needle);
if (start < 0) { console.error('SHIM start not found in bundle'); process.exit(1); }

// The literal is a double-quoted JS string (webpack output). Find the quote that
// opens it: walk back from `start` to the nearest unescaped " or ' .
let q = null, qi = -1;
for (let k = start - 1; k >= 0; k--) {
  const c = bundle[k];
  if ((c === '"' || c === "'") && bundle[k - 1] !== '\\') { q = c; qi = k; break; }
}
if (q == null) { console.error('could not find opening quote'); process.exit(1); }

// Scan forward from qi+1 to the matching unescaped closing quote, decoding
// standard JS string escapes, to recover the real shim text.
let out = '';
for (let i = qi + 1; i < bundle.length; i++) {
  const c = bundle[i];
  if (c === '\\' && i + 1 < bundle.length) {
    const n = bundle[i + 1];
    if (n === 'n') { out += '\n'; i++; }
    else if (n === 't') { out += '\t'; i++; }
    else if (n === 'r') { out += '\r'; i++; }
    else if (n === '\\') { out += '\\'; i++; }
    else if (n === '"') { out += '"'; i++; }
    else if (n === "'") { out += "'"; i++; }
    else if (n === '`') { out += '`'; i++; }
    else { out += n; i++; }
  } else if (c === q) {
    break;
  } else {
    out += c;
  }
}

console.log('recovered shim length:', out.length, 'ends with })();:', out.trimEnd().endsWith('})();'));
try {
  new Function(out);
  console.log('SHIM from bundle: PARSES OK');
} catch (e) {
  console.error('SHIM from bundle: SYNTAX ERROR ->', e.message);
  process.exit(1);
}
