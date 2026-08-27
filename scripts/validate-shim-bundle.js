// Extract the assembled SHIM_BODY string literal from the built main bundle and
// verify it parses. This is the ground truth (webpack already evaluated the
// backtick concatenation, so no comment/backtick ambiguity).
const fs = require('fs');
const path = require('path');
const { extractBundleShim } = require('./check-bundle-shim-hash');

const bundle = fs.readFileSync(path.join(__dirname, '..', 'build', 'main.bundle.js'), 'utf8');
const out = extractBundleShim(bundle);

console.log('recovered shim length:', out.length, 'ends with })();:', out.trimEnd().endsWith('})();'));
try {
  new Function(out);
  console.log('SHIM from bundle: PARSES OK');
} catch (e) {
  console.error('SHIM from bundle: SYNTAX ERROR ->', e.message);
  process.exit(1);
}
