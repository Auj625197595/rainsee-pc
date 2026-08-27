// Force-repatch every extension JS AND HTML file on disk with the CURRENT
// source SHIM. Use after editing extension-storage-patch.ts so files are
// correct immediately, independent of the app's startup patcher. Mirrors
// patchExtensionStorage logic: inject SHIM after any directive prologue in JS
// entries, and inject SHIM as the first <head> child of HTML pages.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Mirrors runtime-context-type.ts for the source-expression eval below.
const RUNTIME_CONTEXT_TYPE = {
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
};

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'extension-storage-patch.ts'), 'utf8');
// Tolerate either `const SHIM_BODY = \`...` (single line) or `const SHIM_BODY =\n  \`...`
// (Prettier splits the assignment onto its own line). Match the keyword without a
// trailing space; eval() handles the leading newline/whitespace before the template.
const startKw = 'const SHIM_BODY =';
const startIdx = src.indexOf(startKw);
const versionIdx = src.indexOf('const SHIM_VERSION =', startIdx);
const exprStart = startIdx + startKw.length;
let end = -1;
for (let i = exprStart; i < versionIdx; i++) {
  const c = src[i], c2 = src[i + 1];
  if (c === '/' && c2 === '/') { while (i < versionIdx && src[i] !== '\n') i++; continue; }
  if (c === '/' && c2 === '*') { i += 2; while (i < versionIdx && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; continue; }
  if (c === '`' || c === "'" || c === '"') { const q = c; i++; while (i < versionIdx) { if (src[i] === '\\') { i += 2; continue; } if (src[i] === q) break; i++; } continue; }
  if (c === ';') { end = i; break; }
}
const SHIM_BODY = eval(src.slice(exprStart, end));
const SHIM_VERSION = crypto.createHash('sha256').update(SHIM_BODY).digest('hex').slice(0, 12);
const MARKER_PREFIX = '/*__crx_storage_sync_shim';
const MARKER = `${MARKER_PREFIX}_${SHIM_VERSION}__*/`;
const SHIM = `${MARKER};${SHIM_BODY}`;
console.log('current SHIM_VERSION:', SHIM_VERSION, 'len:', SHIM_BODY.length);

const SHIM_BLOCK_MARKER_ANYWHERE = /\/\*__crx_storage_sync_shim_[^*]*\*\/\s*;?\s*\(function\s*\(\s*\)\s*\{[\s\S]*?\}\s*\)\s*\(\s*\)\s*;\r?\n/g;
const SHIM_BLOCK_ORPHAN = /^\(function\s*\(\s*\)\s*\{\s*try\s*\{\s*var\s+GB\s*=[\s\S]*?\}\s*\)\s*\(\s*\)\s*;\r?\n/;
function stripLeadingShims(s) {
  s = s.replace(SHIM_BLOCK_MARKER_ANYWHERE, '');
  for (;;) { const m = s.match(SHIM_BLOCK_ORPHAN); if (!m) break; s = s.slice(m[0].length); }
  return s;
}

// Preserve JavaScript directive prologues (especially "use strict") so the
// injected shim does not silently change the bundle's `this` semantics.
function injectShimPreservingDirectives(source) {
  const findLineEnd = (from) => {
    const match = /[\r\n]/u.exec(source.slice(from));
    return match ? from + match.index : -1;
  };
  let offset = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  if (source.slice(offset, offset + 2) === '#!') {
    const lineEnd = findLineEnd(offset + 2);
    if (lineEnd < 0) return source + '\n' + SHIM;
    offset = lineEnd;
    offset += source[offset] === '\r' && source[offset + 1] === '\n' ? 2 : 1;
  }
  let cursor = offset;
  let directiveEnd = -1;
  for (;;) {
    while (cursor < source.length) {
      const ch = source[cursor];
      if (ch === '/' && source[cursor + 1] === '/') {
        const lineEnd = findLineEnd(cursor + 2);
        cursor = lineEnd < 0 ? source.length : lineEnd;
        continue;
      }
      if (ch === '/' && source[cursor + 1] === '*') {
        const end = source.indexOf('*/', cursor + 2);
        if (end < 0) return source.slice(0, offset) + SHIM + source.slice(offset);
        cursor = end + 2;
        continue;
      }
      if (/\s/u.test(ch)) { cursor += 1; continue; }
      break;
    }
    const quote = source[cursor];
    if (quote !== '"' && quote !== "'") break;
    let end = cursor + 1;
    let closed = false;
    for (; end < source.length; end += 1) {
      const ch = source[end];
      if (ch === '\\') { end += 1; continue; }
      if (ch === quote) { end += 1; closed = true; break; }
      if (ch === '\r' || ch === '\n' || ch === '\u2028' || ch === '\u2029') break;
    }
    if (!closed) break;
    let probe = end;
    let statementEnd = -1;
    for (;;) {
      if (probe >= source.length) { statementEnd = source.length; cursor = source.length; break; }
      const ch = source[probe];
      if (ch === ';') { statementEnd = ++probe; cursor = probe; break; }
      if (ch === '\r' || ch === '\n' || ch === '\u2028' || ch === '\u2029') {
        probe += ch === '\r' && source[probe + 1] === '\n' ? 2 : 1;
        statementEnd = probe; cursor = probe; break;
      }
      if (ch === '/' && source[probe + 1] === '/') {
        const lineEnd = findLineEnd(probe + 2);
        if (lineEnd < 0) { statementEnd = source.length; cursor = source.length; break; }
        probe = lineEnd; continue;
      }
      if (ch === '/' && source[probe + 1] === '*') {
        const commentEnd = source.indexOf('*/', probe + 2);
        if (commentEnd < 0) break;
        if (/[\r\n\u2028\u2029]/u.test(source.slice(probe, commentEnd + 2))) {
          statementEnd = commentEnd + 2; cursor = statementEnd; break;
        }
        probe = commentEnd + 2; continue;
      }
      if (ch === ' ' || ch === '\t' || ch === '\v' || ch === '\f') { probe += 1; continue; }
      break;
    }
    if (statementEnd < 0) break;
    directiveEnd = statementEnd;
    if (cursor >= source.length) break;
  }
  const insertionPoint = directiveEnd >= 0 ? directiveEnd : offset;
  return source.slice(0, insertionPoint) + SHIM + source.slice(insertionPoint);
}

// ---- HTML head injection via external crx-shim.js (mirrors the TS source) ----
const SHIM_FILE = 'crx-shim.js';
const LEGACY_SHIM_FILE = '__crx_shim.js';
const HTML_MARKER_PREFIX = '<!--__crx_html_shim';
const HTML_MARKER = `${HTML_MARKER_PREFIX}_${SHIM_VERSION}__-->`;
const HTML_SHIM_BLOCK = `${HTML_MARKER}<script src="/${SHIM_FILE}"></script>\n`;
// Matches both current/legacy external-file forms and
// any prior-version inline form (<script>…body…</script>), so migrating away
// from an older inline block is automatic. Non-greedy [^]*? stops at the first
// </script> (always ours). Eats one leading + one trailing newline for stability.
const HTML_BLOCK_ANYWHERE = /\r?\n?<!--__crx_html_shim_[a-f0-9]*__-->\s*<script\b[^]*?<\/script>\r?\n?/g;
function injectHtmlHeadShim(html) {
  const stripped = html.replace(HTML_BLOCK_ANYWHERE, '');
  const headMatch = stripped.match(/<head\b[^>]*>/i);
  if (headMatch && headMatch.index !== undefined) {
    const idx = headMatch.index + headMatch[0].length;
    return stripped.slice(0, idx) + '\n' + HTML_SHIM_BLOCK + stripped.slice(idx);
  }
  const htmlTagMatch = stripped.match(/<html\b[^>]*>/i);
  if (htmlTagMatch && htmlTagMatch.index !== undefined) {
    const idx = htmlTagMatch.index + htmlTagMatch[0].length;
    return stripped.slice(0, idx) + '\n<head>\n' + HTML_SHIM_BLOCK + '</head>\n' + stripped.slice(idx);
  }
  if (/<(?:!doctype html|body\b)/i.test(stripped)) {
    return HTML_SHIM_BLOCK + stripped;
  }
  return stripped;
}

const extRoot = path.join(__dirname, '..', 'data', 'extensions');
let jsPatched = 0, htmlPatched = 0, shimFilesWritten = 0, skipped = 0, failed = 0;
// Write crx-shim.js = SHIM at the extension root (creates if missing, updates
// if stale, no-ops if current). Same content as a patched JS entry, so the
// standard strip-and-prepend JS path below keeps it current thereafter.
function writeShimFile(extDir) {
  const file = path.join(extDir, SHIM_FILE);
  let orig = null;
  try { orig = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') { failed++; console.error('shim read fail', file, e.message); return; } }
  try {
    if (orig !== SHIM) { fs.writeFileSync(file, SHIM, 'utf8'); shimFilesWritten++; }
    else skipped++;
    fs.rmSync(path.join(extDir, LEGACY_SHIM_FILE), { force: true });
  } catch (e) { failed++; console.error('shim write fail', file, e.message); }
}
function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (ent.name === '_locales' || ent.name === 'node_modules') continue; walk(full); }
    else if (/\.js$/i.test(ent.name)) {
      // crx-shim.js is written per-ext-root by writeShimFile; the generic JS
      // path here would re-process it idempotently (strip→empty→SHIM), but we
      // skip it to avoid double-counting / redundant writes.
      if (ent.name === SHIM_FILE) { skipped++; continue; }
      try {
        const orig = fs.readFileSync(full, 'utf8');
        // Only re-patch JS files the startup patcher would have patched (entry
        // files carry our marker); never prepend to arbitrary non-entry .js.
        if (!orig.includes(MARKER_PREFIX)) { skipped++; continue; }
        const stripped = stripLeadingShims(orig);
        const next = injectShimPreservingDirectives(stripped);
        if (next === orig) { skipped++; continue; }
        fs.writeFileSync(full, next, 'utf8');
        // verify it parses
        try { new Function(SHIM_BODY); } catch (e) { failed++; console.error('SHIM itself broken:', e.message); return; }
        jsPatched++;
      } catch (e) { failed++; console.error('patch fail', full, e.message); }
    }
    else if (/\.html?$/i.test(ent.name)) {
      // HTML injection: process every .html file (the startup patcher walks the
      // whole ext dir for HTML, so no marker gate — first run injects into all).
      try {
        const orig = fs.readFileSync(full, 'utf8');
        const next = injectHtmlHeadShim(orig);
        if (next === orig) { skipped++; continue; }
        fs.writeFileSync(full, next, 'utf8');
        htmlPatched++;
      } catch (e) { failed++; console.error('html patch fail', full, e.message); }
    }
  }
}
// Each immediate child of extRoot with a manifest.json is an extension root:
// write crx-shim.js there, then walk for .js and .html.
if (fs.existsSync(extRoot)) {
  for (const name of fs.readdirSync(extRoot)) {
    const d = path.join(extRoot, name);
    let isDir = false;
    try { isDir = fs.statSync(d).isDirectory(); } catch (e) { continue; }
    if (!isDir) continue;
    if (!fs.existsSync(path.join(d, 'manifest.json'))) continue;
    writeShimFile(d);
    walk(d);
  }
}
console.log(`js patched: ${jsPatched}, html patched: ${htmlPatched}, shim files written: ${shimFilesWritten}, skipped (already current / no marker): ${skipped}, failed: ${failed}`);
