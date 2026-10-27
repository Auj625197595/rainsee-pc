const fs = require('fs');
const crypto = require('crypto');
const b = fs.readFileSync(require('path').join(__dirname, '..', 'build', 'main.bundle.js'), 'utf8');

// Webpack leaves the imported module binding in the extracted expression;
// provide its JSON-compatible value so this standalone validator can eval it.
const runtime_context_type_1 = {
  RUNTIME_CONTEXT_TYPE: {
    TAB: 'TAB',
    POPUP: 'POPUP',
    BACKGROUND: 'BACKGROUND',
    OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT',
    SIDE_PANEL: 'SIDE_PANEL',
    DEVELOPER_TOOLS: 'DEVELOPER_TOOLS',
    ALL: 'ALL',
    CONTENT_SCRIPT: 'CONTENT_SCRIPT',
    SERVICE_WORKER: 'SERVICE_WORKER',
    PANEL: 'PANEL',
  },
};
const RUNTIME_CONTEXT_TYPE = runtime_context_type_1.RUNTIME_CONTEXT_TYPE;

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

  // Current production webpack output uses `(0,module.createHash)("sha256")`
  // and keeps the body in a minified local such as `xr`. Avoid depending on
  // the exact import alias or regex escaping: locate the stable call suffix,
  // read its argument, then evaluate the preceding `<body>=...` expression.
  for (const suffix of ['sha256").update(', "sha256').update("]) {
    let at = 0;
    while ((at = src.indexOf(suffix, at)) >= 0) {
      const argStart = at + suffix.length;
      const argEnd = src.indexOf(')', argStart);
      const variable = argEnd >= 0 ? src.slice(argStart, argEnd) : '';
      if (/^[A-Za-z_$][\w$]*$/.test(variable)) {
        const hashEquals = src.lastIndexOf('=', at);
        const hashAssignmentStart = src.lastIndexOf(',', hashEquals);
        const bodyStart = src.lastIndexOf(`${variable}=`, hashAssignmentStart);
        if (bodyStart >= 0 && at - bodyStart < 250000) {
          let expression = src.slice(
            bodyStart + variable.length + 1,
            hashAssignmentStart,
          );
          if (expression.endsWith(',')) expression = expression.slice(0, -1);
          // Terser keeps the one compile-time enum interpolation inside the
          // folded template literal, but renames its local import alias. The
          // validator already provides the enum value, so substitute that
          // interpolation before evaluating the expression instead of relying
          // on a particular minifier-generated identifier.
          expression = expression.replace(
            /\$\{JSON\.stringify\([A-Za-z_$][\w$]*\)\}/g,
            JSON.stringify(JSON.stringify(RUNTIME_CONTEXT_TYPE)),
          );
          try {
            const value = eval(expression);
            if (typeof value === 'string' && value.includes('__crxShimInstalled')) {
              return value;
            }
          } catch {
            // Try the next crypto call; bundles contain unrelated hashes.
          }
        }
      }
      at = argEnd >= 0 ? argEnd + 1 : at + suffix.length;
    }
  }

  const hashCall = /(?:\.createHash|\(0,[A-Za-z_$][\w$]*\.createHash\))\(["']sha256["']\)\.update\(([A-Za-z_$][\w$]*)\)/g;
  let match;
  while ((match = hashCall.exec(src))) {
    const variable = match[1];
    const marker = '/*__crx_storage_sync_shim_';
    const windowStart = Math.max(0, match.index - 250000);
    if (src.indexOf(marker, windowStart) < 0) continue;
    const escapedVariable = variable.replace(/[$]/g, '\\$&');
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

    // Terser often emits the body as `xr=<concatenated expression>,Cr=hash(xr)`
    // without a declaration keyword. Evaluate that exact assignment directly;
    // unlike the literal-only path above this also preserves `.replace(...)`.
    const directStart = src.lastIndexOf(`${variable}=`, match.index);
    if (directStart >= 0 && match.index - directStart < 250000) {
      let directExpression = src.slice(
        directStart + variable.length + 1,
        match.index,
      );
      if (directExpression.endsWith(',')) directExpression = directExpression.slice(0, -1);
      try {
        const directValue = eval(directExpression);
        if (
          typeof directValue === 'string' &&
          directValue.includes('__crxShimInstalled')
        ) {
          return directValue;
        }
      } catch {
        // Fall through to the more restrictive compatibility probes below.
      }
    }

    // Terser can keep SHIM_BODY as a concatenation followed by `.replace()`
    // and emit the crypto import as `(0,x.createHash)(...)`. In that form the
    // body is not a single string literal. Its assignment immediately
    // precedes the hash variable, so evaluate that self-contained expression.
    const hashAssignment = new RegExp(
      `,([A-Za-z_$][\\w$]*)=${match[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
    ).exec(src.slice(windowStart, match.index + match[0].length));
    if (hashAssignment) {
      const localHashStart = hashAssignment.index;
      const bodyAssignment = prefix.lastIndexOf(`${variable}=`, localHashStart);
      if (bodyAssignment >= 0) {
        const expression = prefix.slice(
          bodyAssignment + variable.length + 1,
          localHashStart,
        );
        try {
          const expressionValue = eval(expression);
          if (
            typeof expressionValue === 'string' &&
            expressionValue.includes('__crxShimInstalled')
          ) {
            return expressionValue;
          }
        } catch {
          // Ignore unrelated minified assignments.
        }
      }
    }
  }
  throw new Error('could not locate minified SHIM_BODY assignment');
}

function checkBundleShimHash() {
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
  return { shim, hash, srcHash, matches };
}

if (require.main === module) checkBundleShimHash();

module.exports = { extractBundleShim, checkBundleShimHash };
