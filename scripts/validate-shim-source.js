// Bulletproof SHIM_BODY validator: extract the `const SHIM_BODY = <expr>;`
// assignment from the TS source by locating its terminating `;` (backtick-aware),
// then eval the expression as plain JS and parse-check the assembled string.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'extension-storage-patch.ts'), 'utf8');

const startKw = 'const SHIM_BODY';
const startIdx = src.indexOf(startKw);
const versionIdx = src.indexOf('const SHIM_VERSION', startIdx);
if (startIdx < 0 || versionIdx < 0) { console.error('could not locate SHIM_BODY'); process.exit(1); }

// Tolerate whitespace between 'const SHIM_BODY' and '=' and after '=' (the TS
// source puts the value on the next line; webpack output joins it onto one).
let p = startIdx + startKw.length;
while (p < versionIdx && /\s/.test(src[p])) p++;
if (src[p] !== '=') { console.error('expected = after SHIM_BODY'); process.exit(1); }
p++;
while (p < versionIdx && /\s/.test(src[p])) p++;
const exprStart = p;
// Scan for the terminating `;` that is NOT inside any string or comment.
// Track: backtick strings, ' strings, " strings, // line comments, /* */ comments.
let end = -1;
for (let i = exprStart; i < versionIdx; i++) {
  const c = src[i], c2 = src[i + 1];
  // line comment
  if (c === '/' && c2 === '/') { while (i < versionIdx && src[i] !== '\n') i++; continue; }
  // block comment
  if (c === '/' && c2 === '*') { i += 2; while (i < versionIdx && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; continue; }
  // backtick / single / double quoted string
  if (c === '`' || c === "'" || c === '"') {
    const q = c; i++;
    while (i < versionIdx) {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === q) break;
      i++;
    }
    continue;
  }
  if (c === ';') { end = i; break; }
}
if (end < 0) { console.error('terminating ; not found'); process.exit(1); }
const expr = src.slice(exprStart, end); // the concatenation expression

let SHIM_BODY;
try {
  SHIM_BODY = eval(expr);
} catch (e) {
  console.error('eval of SHIM_BODY expression FAILED:', e.message);
  console.error('expr length:', expr.length);
  console.error('expr head:', JSON.stringify(expr.slice(0, 60)));
  console.error('expr tail:', JSON.stringify(expr.slice(-80)));
  process.exit(1);
}

console.log('SHIM_BODY length:', SHIM_BODY.length, 'hasNewlines:', SHIM_BODY.indexOf('\n') >= 0);
try {
  new Function(SHIM_BODY);
  console.log('SHIM_BODY: PARSES OK');
} catch (e) {
  console.error('SHIM_BODY: SYNTAX ERROR ->', e.message);
  process.exit(1);
}

// Regression: MV3's native chrome namespace is bootstrapped asynchronously.
// The source shim can run before runtime.id exists, then Chromium can replace
// chrome.tabs with a partial/non-extensible object. The retry must restore the
// IPC-backed tabs.create method and resolve the extension id at call time.
(async () => {
  const scheduled = [];
  const calls = [];
  const event = { addListener() {}, removeListener() {}, hasListener() { return false; } };
  const context = {
    chrome: {
      runtime: {
        id: undefined,
        getManifest: () => ({ manifest_version: 3 }),
        getURL: (p) => `chrome-extension://late-runtime-id/${p || ''}`,
        onMessage: event,
        onConnect: event,
        sendMessage: () => Promise.resolve(undefined),
      },
      tabs: {},
      windows: {},
      storage: { local: {} },
    },
    location: { protocol: 'chrome-extension:', href: 'chrome-extension://late-runtime-id/background.js' },
    electron: {
      invokeExtension(id, method, _opts, details) {
        calls.push({ id, method, details });
        return Promise.resolve({ id: 42, windowId: 1, active: true });
      },
    },
    setTimeout(fn) { scheduled.push(fn); return scheduled.length; },
    clearTimeout() {},
    console: { log() {}, warn() {}, error() {} },
  };
  vm.createContext(context);
  vm.runInContext(SHIM_BODY, context);

  context.chrome.runtime.id = 'late-runtime-id';
  context.chrome.tabs = Object.preventExtensions({});
  for (let i = 0; i < 500 && scheduled.length; i++) scheduled.shift()();

  if (typeof context.chrome.tabs.create !== 'function') {
    throw new Error('MV3 retry did not restore chrome.tabs.create');
  }
  const tab = await context.chrome.tabs.create({ url: 'https://example.com/' });
  const createCall = calls.find((call) => call.method === 'tabs.create');
  if (!createCall || createCall.id !== 'late-runtime-id') {
    throw new Error('tabs.create did not resolve runtime.id lazily');
  }
  if (!tab || tab.id !== 42) {
    throw new Error('tabs.create did not preserve Chrome promise result semantics');
  }
  console.log('SHIM_BODY: DELAYED MV3 tabs.create OK');
})().catch((error) => {
  console.error('SHIM_BODY: DELAYED MV3 TEST FAILED ->', error.message);
  process.exitCode = 1;
});
