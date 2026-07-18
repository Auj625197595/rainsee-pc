// One-time setup for the MV2/MV3 regression-test extensions.
//
// Generates two RSA keypairs whose base64 SPKI DER becomes a stable
// manifest.key (→ stable extension ID via getCrxIdByKey, mirroring
// src/utils/crx.ts). Also writes a simple icon.png into extensiontest/src/.
//
// Run once:  node scripts/gen-test-extension-keys.js
// Then paste the printed MV2/MV3 keys into the two manifest.json files.
// Re-running regenerates everything (new IDs) — only run again if you want
// fresh identities.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Mirror src/utils/crx.ts getCrxIdByKey so the printed IDs match what the
// loader computes at install time.
function getCrxIdByKey(key) {
  const decoded = Buffer.from(key, 'base64');
  return crypto
    .createHash('sha256')
    .update(decoded)
    .digest('hex')
    .split('')
    .map((x) => (parseInt(x, 16) + 0x0a).toString(26))
    .join('')
    .slice(0, 32);
}

function genKey() {
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
}

// --- minimal solid-color RGBA PNG writer (no native deps) ---
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function makePng(size, r, g, b) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const rowLen = 1 + size * 4;
  const raw = Buffer.alloc(rowLen * size);
  for (let y = 0; y < size; y++) {
    const off = y * rowLen;
    raw[off] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const p = off + 1 + x * 4;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
      raw[p + 3] = 255;
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'extensiontest', 'src');
fs.mkdirSync(srcDir, { recursive: true });

// Shared icon (teal). The two extensions share src/, so they share the icon;
// default_title ("CRX Test (MV2|MV3)") distinguishes them in the toolbar.
fs.writeFileSync(path.join(srcDir, 'icon.png'), makePng(128, 64, 160, 170));

const keyA = genKey();
const keyB = genKey();

console.log('=== Paste these into extensiontest/{mv2,mv3}/manifest.json ===');
console.log('MV2 key:\n' + keyA);
console.log('MV2 id: ' + getCrxIdByKey(keyA));
console.log('');
console.log('MV3 key:\n' + keyB);
console.log('MV3 id: ' + getCrxIdByKey(keyB));
console.log('');
console.log('Wrote extensiontest/src/icon.png');
