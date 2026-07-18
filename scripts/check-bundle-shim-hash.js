const fs = require('fs');
const crypto = require('crypto');
const b = fs.readFileSync(require('path').join(__dirname, '..', 'build', 'main.bundle.js'), 'utf8');

function findExpr(src, startKw, endKw) {
  // startKw is the declaration keyword (e.g. 'const SHIM_BODY'); tolerate any
  // whitespace between it and the '=' and after the '='. The TS source puts the
  // value on the next line ('=\n'), webpack output joins it onto one line.
  const startIdx = src.indexOf(startKw);
  if (startIdx < 0) throw new Error(`could not locate ${startKw}`);
  let p = startIdx + startKw.length;
  while (p < src.length && /\s/.test(src[p])) p++;
  if (src[p] !== '=') throw new Error(`expected '=' after ${startKw}`);
  p++;
  while (p < src.length && /\s/.test(src[p])) p++;
  const exprStart = p;
  const endIdx = src.indexOf(endKw, exprStart);
  if (endIdx < 0) throw new Error(`could not locate ${endKw}`);
  for (let i = exprStart; i < endIdx; i++) {
    const c = src[i], c2 = src[i + 1];
    if (c === '/' && c2 === '/') { while (i < endIdx && src[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') { i += 2; while (i < endIdx && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; continue; }
    if (c === '`' || c === "'" || c === '"') {
      const q = c; i++;
      while (i < endIdx) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) break;
        i++;
      }
      continue;
    }
    if (c === ';') return src.slice(exprStart, i);
  }
  throw new Error(`terminating ; not found for ${startKw}`);
}

function extractBundleShim(src) {
  // Development bundles retain the declaration; production minimization
  // renames it (for example `c="...",l=hash.update(c)`). Support both so this
  // check validates the artifact produced by the real `npm run build` command.
  if (src.includes('const SHIM_BODY')) {
    return eval(findExpr(src, 'const SHIM_BODY', 'const SHIM_VERSION'));
  }

  const hashCall = /\.createHash\(["']sha256["']\)\.update\(([A-Za-z_$][\w$]*)\)/g;
  let match;
  while ((match = hashCall.exec(src))) {
    const variable = match[1];
    const marker = '/*__crx_storage_sync_shim_';
    if (src.indexOf(marker, match.index) < 0) continue;
    const escapedVariable = variable.replace(/[$]/g, '\\$&');
    const windowStart = Math.max(0, match.index - 200000);
    const prefix = src.slice(windowStart, match.index + match[0].length);
    const assignment = new RegExp(
      `(?:const |let |var |,)${escapedVariable}=("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'),` +
        `[A-Za-z_$][\\w$]*=[A-Za-z_$][\\w$]*\\.createHash\\(["']sha256["']\\)` +
        `\\.update\\(${escapedVariable}\\)`,
    ).exec(prefix);
    if (!assignment) continue;
    const value = eval(assignment[1]);
    if (typeof value === 'string' && value.includes('__crxShimInstalled')) {
      return value;
    }
  }
  throw new Error('could not locate minified SHIM_BODY assignment');
}

const shim = extractBundleShim(b);
const hash = crypto.createHash('sha256').update(shim).digest('hex').slice(0, 12);
console.log('bundle shim hash:', hash, 'len:', shim.length, 'hasNewlines:', shim.indexOf('\n') >= 0);

// Source hash: eval SHIM_BODY from the TS source.
const fs2 = require('fs');
const src = fs2.readFileSync(require('path').join(__dirname, '..', 'src', 'main', 'extension-storage-patch.ts'), 'utf8');
const srcBody = eval(findExpr(src, 'const SHIM_BODY', 'const SHIM_VERSION'));
const srcHash = crypto.createHash('sha256').update(srcBody).digest('hex').slice(0, 12);
console.log('source hash:', srcHash);
const matches = hash === srcHash;
console.log('MATCH:', matches);
if (!matches) process.exitCode = 1;
