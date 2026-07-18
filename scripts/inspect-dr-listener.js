// Extract Dark Reader's Messenger.messageListener body + the onMessage.addListener
// call sites, to see the return / sendResponse / throw pattern.
const fs = require('fs');
const path = require('path');
const f = path.join(__dirname, '..', 'data', 'extensions', 'eimadpbcbfnmbkopoojfekhnkhdbieeh', 'background', 'index.js');
const s = fs.readFileSync(f, 'utf8');

// Strip the leading shim to search only Dark Reader's code.
const afterMarker = s.indexOf('*/');
const code = s.slice(afterMarker);

function bodyAfter(sigStart) {
  const brace = code.indexOf('{', sigStart);
  if (brace < 0) return null;
  let depth = 0, inStr = null, esc = false;
  for (let i = brace; i < code.length; i++) {
    const c = code[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    if (c === '}') { depth--; if (depth === 0) return code.slice(brace, i + 1); }
  }
  return null;
}

const ml = code.indexOf('messageListener(message, sender, sendResponse)');
if (ml >= 0) {
  const body = bodyAfter(ml);
  console.log('=== messageListener body (len ' + (body ? body.length : 0) + ') ===');
  console.log(body ? body.slice(0, 1200) : '(not found)');
}

console.log('\n=== onMessage.addListener call sites ===');
let idx = 0;
let n = 0;
while ((idx = code.indexOf('onMessage.addListener', idx)) >= 0 && n < 6) {
  console.log('•', code.slice(idx, idx + 90).replace(/\s+/g, ' '));
  idx += 10; n++;
}

console.log('\n=== return true occurrences in messageListener region ===');
if (ml >= 0) {
  const body = bodyAfter(ml) || '';
  let m; const re = /return\s+(true|!0|!1|false|null|undefined)/g;
  while ((m = re.exec(body)) !== null) console.log('  return', m[1], '@', m.index);
  // does it call sendResponse?
  console.log('  sendResponse calls:', (body.match(/sendResponse\(/g) || []).length);
  console.log('  async keyword:', /\basync\b/.test(body.slice(0, 80)));
}
