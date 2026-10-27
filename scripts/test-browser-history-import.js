const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');

const CHROMIUM_EPOCH_OFFSET_MS = 11644473600000;

const loadBrowserImport = () => {
  const filename = path.resolve(
    __dirname,
    '../src/main/services/browser-import.ts',
  );
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} };
  new Function(
    'require',
    'module',
    'exports',
    '__dirname',
    '__filename',
    output,
  )(require, loaded, loaded.exports, path.dirname(filename), filename);
  return loaded.exports;
};

const createChromiumHistory = (databasePath, visits) => {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE urls (
      id INTEGER PRIMARY KEY,
      url TEXT,
      title TEXT,
      hidden INTEGER DEFAULT 0
    );
    CREATE TABLE visits (
      id INTEGER PRIMARY KEY,
      url INTEGER,
      visit_time INTEGER
    );
  `);
  const insertUrl = db.prepare(
    'INSERT INTO urls (id, url, title, hidden) VALUES (?, ?, ?, ?)',
  );
  const insertVisit = db.prepare(
    'INSERT INTO visits (id, url, visit_time) VALUES (?, ?, ?)',
  );
  visits.forEach((visit, index) => {
    const id = index + 1;
    insertUrl.run(id, visit.url, visit.title || '', visit.hidden ? 1 : 0);
    insertVisit.run(
      id,
      id,
      BigInt(visit.date + CHROMIUM_EPOCH_OFFSET_MS) * 1000n,
    );
  });
  db.close();
};

const createFirefoxHistory = (databasePath, visits) => {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE moz_places (
      id INTEGER PRIMARY KEY,
      url TEXT,
      title TEXT,
      hidden INTEGER DEFAULT 0
    );
    CREATE TABLE moz_historyvisits (
      id INTEGER PRIMARY KEY,
      place_id INTEGER,
      visit_date INTEGER
    );
  `);
  const insertPlace = db.prepare(
    'INSERT INTO moz_places (id, url, title, hidden) VALUES (?, ?, ?, ?)',
  );
  const insertVisit = db.prepare(
    'INSERT INTO moz_historyvisits (id, place_id, visit_date) VALUES (?, ?, ?)',
  );
  visits.forEach((visit, index) => {
    const id = index + 1;
    insertPlace.run(id, visit.url, visit.title || '', visit.hidden ? 1 : 0);
    insertVisit.run(id, id, BigInt(visit.date) * 1000n);
  });
  db.close();
};

(async () => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), 'rainsee-browser-history-'),
  );
  const previousLocalAppData = process.env.LOCALAPPDATA;
  const previousAppData = process.env.APPDATA;

  try {
    process.env.LOCALAPPDATA = path.join(temp, 'local');
    process.env.APPDATA = path.join(temp, 'roaming');

    const firstDate = Date.UTC(2025, 0, 2, 3, 4, 5);
    const secondDate = Date.UTC(2025, 5, 6, 7, 8, 9);
    const chromeRoot = path.join(
      process.env.LOCALAPPDATA,
      'Google/Chrome/User Data',
    );
    fs.mkdirSync(chromeRoot, { recursive: true });
    fs.writeFileSync(
      path.join(chromeRoot, 'Local State'),
      JSON.stringify({ profile: { last_used: 'Profile 2' } }),
    );
    createChromiumHistory(path.join(chromeRoot, 'Profile 2/History'), [
      { url: 'https://example.com/one', title: 'One', date: firstDate },
      { url: 'file:///C:/example.html', title: '', date: secondDate },
      { url: 'chrome://settings/', title: 'Settings', date: secondDate },
      {
        url: 'https://hidden.example/',
        title: 'Hidden',
        date: secondDate,
        hidden: true,
      },
    ]);

    const edgeDatabase = path.join(
      process.env.LOCALAPPDATA,
      'Microsoft/Edge/User Data/Default/History',
    );
    createChromiumHistory(edgeDatabase, [
      { url: 'https://edge.example/', title: 'Edge', date: secondDate },
    ]);

    const firefoxRoot = path.join(process.env.APPDATA, 'Mozilla/Firefox');
    const firefoxProfile = path.join(firefoxRoot, 'Profiles/test.default');
    fs.mkdirSync(firefoxRoot, { recursive: true });
    fs.writeFileSync(
      path.join(firefoxRoot, 'profiles.ini'),
      '[Profile0]\nName=Test\nIsRelative=1\nPath=Profiles/test.default\n',
    );
    createFirefoxHistory(path.join(firefoxProfile, 'places.sqlite'), [
      { url: 'https://firefox.example/', title: 'Firefox', date: firstDate },
      { url: 'about:config', title: 'Config', date: secondDate },
    ]);

    const browserImport = loadBrowserImport();
    assert.deepStrictEqual(await browserImport.detectHistoryBrowsers(), {
      chrome: true,
      edge: true,
      firefox: true,
    });

    const chrome = await browserImport.readBrowserHistory('chrome');
    assert.strictEqual(chrome.profileName, 'Profile 2');
    assert.strictEqual(chrome.count, 2);
    assert.deepStrictEqual(
      chrome.items.map(({ title, url, date }) => ({ title, url, date })),
      [
        { title: 'One', url: 'https://example.com/one', date: firstDate },
        {
          title: 'file:///C:/example.html',
          url: 'file:///C:/example.html',
          date: secondDate,
        },
      ],
    );

    const edgePreview = await browserImport.previewBrowserHistory('edge');
    assert.strictEqual(edgePreview.count, 1);
    assert.strictEqual(edgePreview.oldestDate, secondDate);

    const firefox = await browserImport.readBrowserHistory('firefox');
    assert.strictEqual(firefox.count, 1);
    assert.deepStrictEqual(firefox.items[0], {
      title: 'Firefox',
      url: 'https://firefox.example/',
      date: firstDate,
    });

    console.log('browser history import tests passed');
  } finally {
    if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocalAppData;
    if (previousAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = previousAppData;
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
