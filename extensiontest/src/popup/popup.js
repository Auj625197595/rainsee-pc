// Popup = one-click monitoring dashboard for the CRX framework regression test.
// Drives run-all, runs popup-local tests itself (A5-A9, B1/B2/B4/B5/B6), and
// delegates bg/content tests (A1-A4, B3/B8) to the background over a long-lived
// 'crx-test-harness' Port. MV2 and MV3 share this file verbatim.

(function () {
  'use strict';

  const HANDSHAKE = 'crx-test-harness';
  const BG_DRIVEN = new Set(['A1', 'A2', 'A3', 'A4', 'B3', 'B8']);

  const TESTS = [
    { id: 'A1', group: 'msg', label: 'content → bg sendMessage' },
    { id: 'A2', group: 'msg', label: 'content → bg connect (Port)' },
    { id: 'A3', group: 'msg', label: 'bg → content tabs.sendMessage' },
    { id: 'A4', group: 'msg', label: 'bg → content tabs.connect' },
    { id: 'A5', group: 'msg', label: 'popup → bg sendMessage (sync)' },
    { id: 'A6', group: 'msg', label: 'popup → bg sendMessage (async return true)' },
    { id: 'A7', group: 'msg', label: 'popup → bg sendMessage (Promise)' },
    { id: 'A8', group: 'msg', label: 'popup → bg connect (Port)' },
    { id: 'A9', group: 'msg', label: 'bg → popup push' },
    { id: 'B1', group: 'api', label: 'storage.local set/get + onChanged' },
    { id: 'B2', group: 'api', label: 'storage.sync set→get (local remap)' },
    { id: 'B3', group: 'api', label: 'alarms.create + onAlarm' },
    { id: 'B4', group: 'api', label: 'i18n.getMessage + @@extension_id' },
    { id: 'B5', group: 'api', label: 'runtime.getURL' },
    { id: 'B6', group: 'api', label: 'tabs.query active' },
    // B7/B8 (tabs.create) are side-effecting — see MANUAL_TESTS.
    // --- Group C: declarativeNetRequest (MV3; MV2 shows n/a) ---
    { id: 'C1', group: 'dnr', label: 'getDynamicRules returns array' },
    { id: 'C2', group: 'dnr', label: 'updateDynamicRules add→read→remove' },
    { id: 'C3', group: 'dnr', label: 'updateSessionRules add→read→remove' },
    { id: 'C4', group: 'dnr', label: 'getEnabledRulesets returns array' },
    { id: 'C5', group: 'dnr', label: 'getAvailableStaticRuleCount ≥ 0' },
    { id: 'C6', group: 'dnr', label: 'isRegexSupported: plain regex → true' },
    { id: 'C7', group: 'dnr', label: 'unsafe regex rule is atomically rejected' },
    { id: 'C8', group: 'dnr', label: 'DNR spec constants present' },
    { id: 'C9', group: 'dnr', label: 'onRuleMatchedDebug event surface' },
    // --- Group D: identity (OAuth) ---
    { id: 'D1', group: 'identity', label: 'getRedirectURL (chromiumapp.org)' },
    { id: 'D2', group: 'identity', label: 'getAuthToken surfaces error (no hang)' },
    // --- Group E: pageAction (MV2; MV3 shows n/a) ---
    { id: 'E1', group: 'pageaction', label: 'pageAction namespace (show/hide/onClicked)' },
    // --- Group F: permissions API ---
    { id: 'F1', group: 'permissions', label: 'getAll → {permissions, origins}' },
    { id: 'F2', group: 'permissions', label: 'contains(permissions) true' },
    { id: 'F3', group: 'permissions', label: 'contains(origins) — host split + wildcard' },
    { id: 'F4', group: 'permissions', label: 'request undeclared origin rejects' },
    // --- Group G: userScripts (MV3; MV2 shows n/a) ---
    // Runs in the POPUP context on purpose: a sandboxed popup gets no crx-preload,
    // only the HTML-head SHIM. These probes exercise that SHIM→crxreq Port→SW
    // →main UserScriptsAPI route — the exact path whose absence made ScriptCat
    // falsely report "Allow User Scripts is not enabled".
    { id: 'G1', group: 'userscripts', label: 'getScripts returns array (popup probe)' },
    { id: 'G2', group: 'userscripts', label: 'register→getScripts→unregister round-trip' },
    { id: 'G3', group: 'userscripts', label: 'configureWorld + getWorldConfigurations' },
    { id: 'G4', group: 'userscripts', label: 'ExecutionWorld spec enum present' },
  ];

  const GROUP_LABEL = {
    msg: chrome.i18n.getMessage('group_messaging') || 'Messaging',
    api: chrome.i18n.getMessage('group_apis') || 'Core APIs',
    dnr: chrome.i18n.getMessage('group_dnr') || 'declarativeNetRequest',
    identity: chrome.i18n.getMessage('group_identity') || 'Identity',
    pageaction: chrome.i18n.getMessage('group_pageaction') || 'pageAction',
    permissions: chrome.i18n.getMessage('group_permissions') || 'Permissions',
    userscripts: chrome.i18n.getMessage('group_userscripts') || 'userScripts',
    manual: chrome.i18n.getMessage('group_manual') || 'Manual (opens a window/tab/prompt — click to run)',
  };

  // Side-effecting tests that open a host tab / auth window / permission prompt.
  // NOT part of run-all (would be intrusive mid-sweep); rendered as explicit
  // buttons in a separate section so they only fire on a deliberate click.
  // Their runners still live in RUNNERS (or runBgTest) like any other test.
  const MANUAL_TESTS = [
    { id: 'B7', group: 'manual', label: 'popup tabs.create (opens a real tab)' },
    { id: 'B8', group: 'manual', label: 'background/SW tabs.create (must return a real tab)' },
    { id: 'D3', group: 'manual', label: 'identity.launchWebAuthFlow (opens a window)' },
    { id: 'F5', group: 'manual', label: 'permissions.request + contains + remove (prompts)' },
  ];

  // ---------- small promise wrappers ----------
  function cbp(fn) {
    return (...args) =>
      new Promise((res, rej) => {
        fn(...args, (r) => {
          const e = chrome.runtime.lastError;
          if (e) rej(new Error(e.message));
          else res(r);
        });
      });
  }
  const pSend = (msg) =>
    new Promise((res) => {
      chrome.runtime.sendMessage(msg, (r) => {
        void chrome.runtime.lastError; // consume; undefined response is a real failure signal
        res(r);
      });
    });
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  // Storage helpers that keep `this` bound. Passing chrome.storage.local.set
  // detached (as cbp(chrome.storage.local.set)) throws "Illegal invocation:
  // Function must be called on an object of type StorageArea" — StorageArea
  // methods must be invoked on their owning object.
  const sl = chrome.storage.local;
  const ss = chrome.storage.sync;
  const slSet = (o) => new Promise((res, rej) => sl.set(o, () => { const e = chrome.runtime.lastError; e ? rej(new Error(e.message)) : res(undefined); }));
  const slGet = (k) => new Promise((res, rej) => sl.get(k, (r) => { const e = chrome.runtime.lastError; e ? rej(new Error(e.message)) : res(r); }));
  const slRemove = (k) => new Promise((res, rej) => sl.remove(k, () => { const e = chrome.runtime.lastError; e ? rej(new Error(e.message)) : res(undefined); }));
  const ssSet = (o) => new Promise((res, rej) => ss.set(o, () => { const e = chrome.runtime.lastError; e ? rej(new Error(e.message)) : res(undefined); }));
  const ssGet = (k) => new Promise((res, rej) => ss.get(k, (r) => { const e = chrome.runtime.lastError; e ? rej(new Error(e.message)) : res(r); }));

  // ---------- harness Port ----------
  let harness = null;
  const pending = new Map(); // test id -> resolve(result)
  let running = false;

  function connectHarness() {
    try {
      harness = chrome.runtime.connect({ name: HANDSHAKE });
    } catch (e) {
      setTimeout(connectHarness, 500);
      return;
    }
    setConn(true);
    harness.onMessage.addListener((m) => {
      if (m && m.type === 'test-result' && pending.has(m.test)) {
        const res = pending.get(m.test);
        pending.delete(m.test);
        res({ pass: m.pass, detail: m.detail, latency: m.latency });
      }
    });
    harness.onDisconnect.addListener(() => {
      harness = null;
      setConn(false);
      setTimeout(connectHarness, 300); // MV3 SW may have slept
    });
  }

  function runBgDriven(id) {
    return new Promise((resolve) => {
      pending.set(id, resolve);
      if (harness) harness.postMessage({ type: 'run-test', test: id });
      else resolve({ pass: false, detail: 'harness not connected', latency: 0 });
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          resolve({ pass: false, detail: 'no result from bg (timeout)', latency: 0 });
        }
      }, 12000);
    });
  }

  // ---------- popup-local test runners ----------
  const RUNNERS = {
    A5: async () => {
      const payload = 'x' + Math.random().toString(36).slice(2);
      const r = await pSend({ type: 'popup-send-sync', payload });
      const ok = r && r.reply === 'sync' && r.echo === payload;
      return { pass: ok, detail: ok ? 'sync reply matched' : 'bad response: ' + JSON.stringify(r) };
    },
    A6: async () => {
      const payload = 'y' + Math.random().toString(36).slice(2);
      const r = await pSend({ type: 'popup-send-async', payload });
      const ok = r && r.reply === 'async' && r.echo === payload;
      return { pass: ok, detail: ok ? 'async (return true) reply matched' : 'bad response: ' + JSON.stringify(r) };
    },
    A7: async () => {
      const payload = 'z' + Math.random().toString(36).slice(2);
      const r = await pSend({ type: 'popup-send-promise', payload });
      const ok = r && r.reply === 'promise' && r.echo === payload;
      return { pass: ok, detail: ok ? 'Promise reply matched' : 'bad response: ' + JSON.stringify(r) };
    },
    A8: () =>
      new Promise((res) => {
        let port;
        try {
          port = chrome.runtime.connect({ name: 'popup-to-bg-connect' });
        } catch (e) {
          res({ pass: false, detail: 'connect threw: ' + e.message });
          return;
        }
        const payload = { t: Date.now() };
        const fail = setTimeout(() => {
          try {
            port.disconnect();
          } catch (e) {
            /* ignore */
          }
          res({ pass: false, detail: 'no connect echo (timeout)' });
        }, 4000);
        port.onMessage.addListener((m) => {
          clearTimeout(fail);
          const ok =
            m && m.reply === 'connect-echo' && JSON.stringify(m.echo) === JSON.stringify(payload);
          try {
            port.disconnect();
          } catch (e) {
            /* ignore */
          }
          res({ pass: ok, detail: ok ? 'port echo matched' : 'bad echo: ' + JSON.stringify(m) });
        });
        try {
          port.postMessage(payload);
        } catch (e) {
          clearTimeout(fail);
          res({ pass: false, detail: 'postMessage threw: ' + e.message });
        }
      }),
    A9: () =>
      new Promise((res) => {
        const fail = setTimeout(() => {
          chrome.runtime.onMessage.removeListener(h);
          res({ pass: false, detail: 'no bg-push-ping (timeout)' });
        }, 4000);
        function h(m) {
          try { console.warn('[crx-test] A9 popup onMessage type=' + (m && m.type)); } catch (e) { /* diag */ }
          if (m && m.type === 'bg-push-ping') {
            clearTimeout(fail);
            chrome.runtime.onMessage.removeListener(h);
            res({ pass: true, detail: 'bg push received' });
          }
          return false;
        }
        chrome.runtime.onMessage.addListener(h);
        if (harness) harness.postMessage({ type: 'broadcast-test' });
        else {
          clearTimeout(fail);
          chrome.runtime.onMessage.removeListener(h);
          res({ pass: false, detail: 'harness not connected' });
        }
      }),
    B1: async () => {
      const key = 'crxtest_' + Math.random().toString(36).slice(2);
      const val = { n: Math.random() };
      let changed = false;
      const h = (changes, area) => {
        if (area === 'local' && changes[key]) changed = true;
      };
      chrome.storage.onChanged.addListener(h);
      try {
        await slSet({ [key]: val });
        const got = await slGet(key);
        await slRemove(key);
        await delay(60);
        const ok = got && got[key] && got[key].n === val.n && changed;
        return {
          pass: ok,
          detail: ok ? 'set/get round-trip ok, onChanged fired' : 'get=' + JSON.stringify(got) + ' changed=' + changed,
        };
      } finally {
        chrome.storage.onChanged.removeListener(h);
      }
    },
    B2: async () => {
      const key = 'crxtest_sync_' + Math.random().toString(36).slice(2);
      const val = 'v' + Math.random();
      try {
        await ssSet({ [key]: val });
        const got = await ssGet(key);
        await slRemove(key);
        const ok = got && got[key] === val;
        return {
          pass: ok,
          detail: ok ? 'sync.set→sync.get ok (remapped to local)' : 'sync.get=' + JSON.stringify(got),
        };
      } catch (e) {
        return { pass: false, detail: 'storage.sync threw: ' + e.message };
      }
    },
    B4: () => {
      const m1 = chrome.i18n.getMessage('test_placeholder', 'World');
      const eid = chrome.i18n.getMessage('@@extension_id');
      const ok1 = typeof m1 === 'string' && m1.length > 0 && m1.indexOf('World') >= 0;
      const ok2 = typeof eid === 'string' && /^[a-p]{32}$/.test(eid);
      return { pass: ok1 && ok2, detail: 'getMessage="' + m1 + '" @@extension_id="' + eid + '"' };
    },
    B5: () => {
      const u = chrome.runtime.getURL('popup/popup.html');
      const id = chrome.runtime.id;
      const ok =
        typeof u === 'string' &&
        u.indexOf('chrome-extension://') === 0 &&
        u.indexOf('/popup/popup.html') > 0 &&
        (!id || u.indexOf(id) >= 0);
      return { pass: ok, detail: ok ? u : 'bad url: ' + u };
    },
    B6: async () => {
      let t = await cbp(chrome.tabs.query)({ active: true, lastFocusedWindow: true });
      if (!t || !t.length) t = await cbp(chrome.tabs.query)({ active: true });
      const ok = Array.isArray(t) && t.length > 0 && typeof t[0].id === 'number';
      return { pass: ok, detail: ok ? 'active tab id=' + t[0].id + ' url=' + (t[0].url || '') : 'no active tab' };
    },
    B7: async () => {
      // tabs.create must land a REAL host tab in the live list — not a stub
      // that replies `true`/a fake Tab and opens nothing. Guards the regression
      // where the popup IPC bridge is down (sandboxed co-site) or the main
      // handler rejects: chrome.tabs.create used to resolve silently and nothing
      // opened. Authoritative signal = a NEW id appearing in tabs.query that did
      // not exist before the call.
      const before = await cbp(chrome.tabs.query)({});
      const beforeIds = new Set((before || []).map((t) => t && t.id));
      let created = null;
      try {
        created = await cbp(chrome.tabs.create)({ url: 'about:blank?crxtest=create', active: false });
      } catch (e) {
        return { pass: false, detail: 'create threw: ' + (e && e.message) };
      }
      let fresh = null;
      for (let i = 0; i < 20; i++) {
        const live = await cbp(chrome.tabs.query)({});
        fresh = (live || []).find((t) => t && !beforeIds.has(t.id));
        if (fresh) break;
        await delay(150);
      }
      const cleanupId = created && typeof created.id === 'number' ? created.id : fresh && fresh.id;
      if (cleanupId != null) {
        try {
          await cbp(chrome.tabs.remove)(cleanupId);
        } catch (_) {
          /* best-effort cleanup */
        }
      }
      const pass = !!fresh;
      return {
        pass,
        detail: pass ? 'new tab id=' + fresh.id + ' (then removed)' : 'no new tab appeared in tabs.query',
      };
    },

    // ---------- Group C: declarativeNetRequest (MV3; n/a on MV2) ----------
    C1: async () => {
      const DNR = chrome.declarativeNetRequest;
      if (!DNR) return { pass: true, detail: 'n/a (MV2 has no DNR namespace)' };
      try {
        const r = await DNR.getDynamicRules();
        return { pass: Array.isArray(r), detail: Array.isArray(r) ? 'dynamic rules=' + r.length : 'not array: ' + typeof r };
      } catch (e) {
        return { pass: false, detail: 'threw: ' + (e && (e.message || e)) };
      }
    },
    C2: async () => {
      const DNR = chrome.declarativeNetRequest;
      if (!DNR) return { pass: true, detail: 'n/a (MV2 has no DNR namespace)' };
      const id = Math.floor(Math.random() * 9e5) + 1e5;
      try {
        await DNR.updateDynamicRules({
          addRules: [{ id, priority: 1, action: { type: 'block' }, condition: { urlFilter: '||crxtest.invalid', resourceTypes: ['xmlhttprequest'] } }],
        });
        const after = await DNR.getDynamicRules();
        const found = Array.isArray(after) && after.some((r) => r.id === id);
        await DNR.updateDynamicRules({ removeRuleIds: [id] });
        return { pass: found, detail: found ? 'add→read→remove ok (id=' + id + ')' : 'rule not readable after add' };
      } catch (e) {
        return { pass: false, detail: 'threw: ' + (e && (e.message || e)) };
      }
    },
    C3: async () => {
      const DNR = chrome.declarativeNetRequest;
      if (!DNR) return { pass: true, detail: 'n/a (MV2 has no DNR namespace)' };
      const id = Math.floor(Math.random() * 9e5) + 1e5;
      try {
        await DNR.updateSessionRules({
          addRules: [{ id, priority: 1, action: { type: 'allow' }, condition: { urlFilter: '||crxtest.invalid', resourceTypes: ['xmlhttprequest'] } }],
        });
        const after = await DNR.getSessionRules();
        const found = Array.isArray(after) && after.some((r) => r.id === id);
        await DNR.updateSessionRules({ removeRuleIds: [id] });
        return { pass: found, detail: found ? 'session add→read→remove ok (id=' + id + ')' : 'rule not readable after add' };
      } catch (e) {
        return { pass: false, detail: 'threw: ' + (e && (e.message || e)) };
      }
    },
    C4: async () => {
      const DNR = chrome.declarativeNetRequest;
      if (!DNR) return { pass: true, detail: 'n/a (MV2 has no DNR namespace)' };
      try {
        const r = await DNR.getEnabledRulesets();
        return { pass: Array.isArray(r), detail: Array.isArray(r) ? 'enabled rulesets=' + r.length + (r.length ? ' [' + r.join(',') + ']' : '') : 'not array' };
      } catch (e) {
        return { pass: false, detail: 'threw: ' + (e && (e.message || e)) };
      }
    },
    C5: async () => {
      const DNR = chrome.declarativeNetRequest;
      if (!DNR) return { pass: true, detail: 'n/a (MV2 has no DNR namespace)' };
      try {
        const n = await DNR.getAvailableStaticRuleCount();
        const ok = typeof n === 'number' && n >= 0;
        return { pass: ok, detail: ok ? 'available=' + n : 'bad count: ' + n };
      } catch (e) {
        return { pass: false, detail: 'threw: ' + (e && (e.message || e)) };
      }
    },
    C6: async () => {
      const DNR = chrome.declarativeNetRequest;
      if (!DNR) return { pass: true, detail: 'n/a (MV2 has no DNR namespace)' };
      try {
        const r = await DNR.isRegexSupported({ regex: '^https://example\\.com/[a-z]+$' });
        return { pass: r && r.isSupported === true, detail: r && r.isSupported ? 'supported' : 'unexpected: ' + JSON.stringify(r) };
      } catch (e) {
        return { pass: false, detail: 'threw: ' + (e && (e.message || e)) };
      }
    },
    C7: async () => {
      const DNR = chrome.declarativeNetRequest;
      if (!DNR) return { pass: true, detail: 'n/a (MV2 has no DNR namespace)' };
      const id = Math.floor(Math.random() * 9e5) + 1e5;
      try {
        await DNR.updateSessionRules({
          addRules: [{ id, priority: 1, action: { type: 'block' }, condition: { regexFilter: '(a+)+' } }],
        });
        const rules = await DNR.getSessionRules();
        await DNR.updateSessionRules({ removeRuleIds: [id] });
        return { pass: false, detail: 'unsafe rule was accepted; present=' + rules.some((r) => r.id === id) };
      } catch (e) {
        const rules = await DNR.getSessionRules();
        const leaked = rules.some((r) => r.id === id);
        return { pass: !leaked, detail: leaked ? 'rejected but rule leaked into active set' : 'rejected atomically: ' + (e && (e.message || e)) };
      }
    },
    C8: async () => {
      const DNR = chrome.declarativeNetRequest;
      if (!DNR) return { pass: true, detail: 'n/a (MV2 has no DNR namespace)' };
      const need = ['MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES', 'MAX_NUMBER_OF_STATIC_RULESETS', 'MAX_NUMBER_OF_REGEX_RULES', 'DYNAMIC_RULESET_ID', 'SESSION_RULESET_ID'];
      const missing = need.filter((k) => typeof DNR[k] === 'undefined');
      return { pass: missing.length === 0, detail: missing.length ? 'missing: ' + missing.join(',') : 'all ' + need.length + ' constants present' };
    },
    C9: async () => {
      const DNR = chrome.declarativeNetRequest;
      if (!DNR) return { pass: true, detail: 'n/a (MV2 has no DNR namespace)' };
      const ev = DNR.onRuleMatchedDebug;
      const ok = ev && typeof ev.addListener === 'function' && typeof ev.hasListener === 'function';
      return { pass: !!ok, detail: ok ? 'onRuleMatchedDebug event surface ok' : 'event missing/incomplete' };
    },

    // ---------- Group D: identity ----------
    D1: () => {
      if (!chrome.identity) return { pass: false, detail: 'chrome.identity undefined' };
      const u = chrome.identity.getRedirectURL('crxtest');
      const ok = typeof u === 'string' && u.indexOf('.chromiumapp.org/crxtest') >= 0 && u.indexOf('chrome-extension://') < 0;
      return { pass: ok, detail: ok ? u : 'bad redirect url: ' + u };
    },
    D2: () =>
      new Promise((res) => {
        if (!chrome.identity) return res({ pass: false, detail: 'chrome.identity undefined' });
        const fail = setTimeout(() => res({ pass: false, detail: 'getAuthToken hung (timeout)' }), 6000);
        try {
          // Non-interactive: this host has no Google OAuth, so getAuthToken must
          // SURFACE a failure (lastError / no token) rather than hang or fake one.
          chrome.identity.getAuthToken({ interactive: false }, (token) => {
            clearTimeout(fail);
            const err = chrome.runtime.lastError;
            const pass = !token || !!err;
            res({ pass, detail: pass ? 'surfaced failure: ' + ((err && err.message) || 'no token') : 'unexpected token: ' + token });
          });
        } catch (e) {
          clearTimeout(fail);
          res({ pass: true, detail: 'threw as expected: ' + (e && e.message) });
        }
      }),

    // ---------- Group E: pageAction (MV2; n/a on MV3) ----------
    E1: () => {
      const pa = chrome.pageAction;
      if (!pa) return { pass: true, detail: 'n/a (MV3 uses chrome.action, not pageAction)' };
      const missing = ['show', 'hide'].filter((k) => typeof pa[k] !== 'function');
      const evOk = pa.onClicked && typeof pa.onClicked.addListener === 'function';
      const ok = missing.length === 0 && evOk;
      return { pass: ok, detail: ok ? 'pageAction.show/hide/onClicked present' : 'missing: ' + missing.join(',') + (evOk ? '' : ' +onClicked') };
    },

    // ---------- Group F: permissions API ----------
    F1: async () => {
      try {
        const all = await cbp(chrome.permissions.getAll)();
        const ok = all && Array.isArray(all.permissions) && Array.isArray(all.origins);
        return { pass: ok, detail: ok ? 'permissions=' + all.permissions.length + ' origins=' + all.origins.length + (all.origins.length ? ' [' + all.origins.slice(0, 3).join(',') + ']' : '') : 'bad shape: ' + JSON.stringify(all) };
      } catch (e) {
        return { pass: false, detail: 'threw: ' + (e && (e.message || e)) };
      }
    },
    F2: async () => {
      try {
        const r = await cbp(chrome.permissions.contains)({ permissions: ['storage'] });
        return { pass: r === true, detail: 'contains([storage])=' + r };
      } catch (e) {
        return { pass: false, detail: 'threw: ' + (e && (e.message || e)) };
      }
    },
    F3: async () => {
      // https://*/* is declared (MV2 in permissions, MV3 in host_permissions),
      // so this concrete HTTPS origin must be contained.
      try {
        const r = await cbp(chrome.permissions.contains)({ origins: ['https://example.com/*'] });
        return { pass: r === true, detail: 'contains([https://example.com/*])=' + r };
      } catch (e) {
        return { pass: false, detail: 'threw: ' + (e && (e.message || e)) };
      }
    },
    F4: () =>
      new Promise((res) => {
        // Undeclared origin → must NOT be granted. Two valid Chrome-compliant
        // outcomes: the framework rejects (throws "undeclared origin") OR
        // request() resolves to `false` (denied). Pass = not granted (reject OR
        // resolve(falsy)); fail only if it resolves truthy or hangs.
        const fail = setTimeout(() => res({ pass: false, detail: 'request hung (timeout)' }), 6000);
        // Use HTTP so the request is outside the required `https://*/*` grant;
        // the random host also cannot match optional `*://*.example.com/*`.
        cbp(chrome.permissions.request)({ origins: ['http://crxtest-' + Math.random().toString(36).slice(2) + '.invalid/*'] })
          .then(
            (granted) => {
              clearTimeout(fail);
              const ok = !granted;
              res({ pass: ok, detail: ok ? 'resolved false (not granted) — correct' : 'undeclared origin was GRANTED: ' + granted });
            },
            (e) => { clearTimeout(fail); res({ pass: true, detail: 'rejected as expected: ' + ((e && e.message) || e) }); },
          );
      }),

    // ---------- Group G: userScripts (MV3; n/a on MV2) ----------
    // G1 is the direct regression for the ScriptCat false "Allow User Scripts
    // not enabled" guide: getScripts() called from the (sandboxed) popup must
    // resolve to an array, not throw. Before the SHIM userScripts block it threw
    // (native Electron userScripts is gated with no toggle) → false guide.
    G1: async () => {
      const US = chrome.userScripts;
      if (!US) return { pass: true, detail: 'n/a (MV2 has no userScripts namespace)' };
      try {
        const r = await US.getScripts();
        return { pass: Array.isArray(r), detail: Array.isArray(r) ? 'registered userscripts=' + r.length : 'not an array: ' + typeof r };
      } catch (e) {
        return { pass: false, detail: 'threw (native gated?): ' + (e && (e.message || e)) };
      }
    },
    G2: async () => {
      const US = chrome.userScripts;
      if (!US) return { pass: true, detail: 'n/a (MV2 has no userScripts namespace)' };
      const id = 'crxtest-us-' + Math.floor(Math.random() * 9e5 + 1e5);
      try {
        await US.register([{
          id,
          matches: ['https://crxtest.invalid/*'],
          js: [{ code: 'void 0;' }],
          world: 'USER_SCRIPT',
        }]);
        const after = await US.getScripts({ ids: [id] });
        const found = Array.isArray(after) && after.some((s) => s.id === id);
        await US.unregister({ ids: [id] });
        const gone = (await US.getScripts({ ids: [id] })).length === 0;
        const ok = found && gone;
        return { pass: ok, detail: ok ? 'register→read→unregister ok (id=' + id + ')' : ('found=' + found + ' goneAfterUnregister=' + gone) };
      } catch (e) {
        try { await US.unregister({ ids: [id] }); } catch (_) {}
        return { pass: false, detail: 'threw: ' + (e && (e.message || e)) };
      }
    },
    G3: async () => {
      const US = chrome.userScripts;
      if (!US) return { pass: true, detail: 'n/a (MV2 has no userScripts namespace)' };
      try {
        await US.configureWorld({ messaging: true });
        const worlds = await US.getWorldConfigurations();
        const ok = Array.isArray(worlds);
        return { pass: ok, detail: ok ? 'configureWorld ok; worlds=' + worlds.length : 'getWorldConfigurations not array: ' + typeof worlds };
      } catch (e) {
        return { pass: false, detail: 'threw: ' + (e && (e.message || e)) };
      }
    },
    G4: () => {
      const US = chrome.userScripts;
      if (!US) return { pass: true, detail: 'n/a (MV2 has no userScripts namespace)' };
      const ew = US.ExecutionWorld;
      const ok = ew && ew.MAIN === 'MAIN' && ew.USER_SCRIPT === 'USER_SCRIPT';
      return { pass: !!ok, detail: ok ? 'ExecutionWorld {MAIN,USER_SCRIPT} present' : 'missing/incomplete ExecutionWorld: ' + JSON.stringify(ew) };
    },

    // ---------- Manual (side-effecting) runners — buttons only, not in run-all ----------
    D3: () =>
      new Promise((res) => {
        // Opens an auth window (interactive). User closes it → launchWebAuthFlow
        // rejects with "did not approve". Pass = the call settled (window opened
        // + resolved/rejected), proving the API is wired — not that auth worked.
        if (!chrome.identity || !chrome.identity.launchWebAuthFlow) return res({ pass: false, detail: 'chrome.identity.launchWebAuthFlow undefined' });
        const fail = setTimeout(() => res({ pass: false, detail: 'launchWebAuthFlow hung (timeout — close the auth window)' }), 45000);
        try {
          chrome.identity.launchWebAuthFlow({ url: 'https://example.com/', interactive: true }, (redirectUrl) => {
            clearTimeout(fail);
            const err = chrome.runtime.lastError;
            const pass = typeof redirectUrl === 'string' || !!err;
            res({ pass, detail: pass ? 'settled: ' + (redirectUrl || (err && err.message) || 'closed') : 'no result' });
          });
        } catch (e) {
          clearTimeout(fail);
          res({ pass: false, detail: 'threw: ' + ((e && e.message) || e) });
        }
      }),
    F5: () =>
      new Promise((res) => {
        const requested = {
          permissions: ['cookies'],
          origins: ['*://*.example.com/*'],
        };
        const fail = setTimeout(() => res({ pass: false, detail: 'request hung (timeout — answer the prompt)' }), 45000);
        cbp(chrome.permissions.request)(requested).then(async (granted) => {
          if (!granted) throw new Error('permission request was denied');
          const contained = await cbp(chrome.permissions.contains)(requested);
          const removed = await cbp(chrome.permissions.remove)(requested);
          const after = await cbp(chrome.permissions.contains)(requested);
          clearTimeout(fail);
          const pass = contained === true && removed === true && after === false;
          res({ pass, detail: 'granted=' + granted + ' contained=' + contained + ' removed=' + removed + ' after=' + after });
        }).catch((e) => {
          clearTimeout(fail);
          res({ pass: false, detail: 'threw: ' + ((e && e.message) || e) });
        });
      }),
  };

  async function runTest(t) {
    if (BG_DRIVEN.has(t.id)) return runBgDriven(t.id);
    const t0 = performance.now();
    let r;
    try {
      r = await RUNNERS[t.id]();
    } catch (e) {
      r = { pass: false, detail: 'throw: ' + (e && e.message || e) };
    }
    r.latency = Math.round(performance.now() - t0);
    return r;
  }

  // ---------- rendering ----------
  const testsEl = document.getElementById('tests');
  const summaryEl = document.getElementById('summary');
  const runAllBtn = document.getElementById('run-all');
  const connEl = document.getElementById('conn');
  const rowEls = new Map();

  function buildUI() {
    let lastGroup = null;
    for (const t of TESTS) {
      if (t.group !== lastGroup) {
        const g = document.createElement('div');
        g.className = 'group';
        g.textContent = GROUP_LABEL[t.group] || t.group;
        testsEl.appendChild(g);
        lastGroup = t.group;
      }
      const row = document.createElement('div');
      row.className = 'row';
      row.dataset.id = t.id;
      row.innerHTML =
        '<span class="label"><span class="id">' +
        t.id +
        '</span><span class="text"></span></span>' +
        '<span class="right"><span class="lat"></span><span class="dot"></span></span>';
      row.querySelector('.text').textContent = t.label;
      row.addEventListener('click', () => onRowClick(t));
      testsEl.appendChild(row);
      rowEls.set(t.id, { row, dot: row.querySelector('.dot'), lat: row.querySelector('.lat') });
      // detail line below
      const det = document.createElement('div');
      det.className = 'detail';
      det.dataset.id = t.id;
      testsEl.appendChild(det);
      rowEls.get(t.id).detail = det;
    }
  }

  // ---------- manual (side-effecting) section: buttons, not in run-all ----------
  function buildManualUI() {
    const g = document.createElement('div');
    g.className = 'group manual-group';
    g.textContent = GROUP_LABEL.manual;
    testsEl.appendChild(g);
    for (const t of MANUAL_TESTS) {
      const row = document.createElement('div');
      row.className = 'row manual-row';
      row.innerHTML =
        '<button class="manual-btn" type="button"></button>' +
        '<span class="right"><span class="lat"></span><span class="dot"></span></span>';
      const btn = row.querySelector('.manual-btn');
      btn.textContent = t.label;
      const dot = row.querySelector('.dot');
      const lat = row.querySelector('.lat');
      const det = document.createElement('div');
      det.className = 'detail';
      testsEl.appendChild(row);
      testsEl.appendChild(det);
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        btn.disabled = true;
        dot.className = 'dot';
        lat.textContent = '';
        det.textContent = '…running';
        det.classList.remove('fail');
        let r;
        try {
          r = await runTest(t);
        } catch (e) {
          r = { pass: false, detail: 'throw: ' + ((e && e.message) || e) };
        }
        dot.className = 'dot ' + (r.pass ? 'pass' : 'fail');
        lat.textContent = r.latency != null ? r.latency + 'ms' : '';
        det.textContent = r.detail || '';
        det.classList.toggle('fail', !r.pass);
        btn.disabled = false;
      });
    }
  }

  function setStatus(id, status, latency, detail) {
    const e = rowEls.get(id);
    if (!e) return;
    e.dot.className = 'dot ' + (status === 'pass' ? 'pass' : status === 'fail' ? 'fail' : '');
    e.lat.textContent = latency != null ? latency + 'ms' : '';
    e.row.classList.toggle('busy', status === 'busy');
    if (detail != null) {
      e.detail.textContent = detail || '';
      e.detail.classList.toggle('fail', status === 'fail');
    }
  }

  function setConn(live) {
    connEl.textContent = live ? 'bg connected' : 'reconnecting…';
    connEl.className = 'conn ' + (live ? 'live' : '');
  }

  function updateSummary() {
    let pass = 0,
      fail = 0,
      total = TESTS.length;
    for (const t of TESTS) {
      const e = rowEls.get(t.id);
      if (e.dot.classList.contains('pass')) pass++;
      else if (e.dot.classList.contains('fail')) fail++;
    }
    summaryEl.textContent = pass + '/' + total + (fail ? '  (' + fail + ' failed)' : '');
    summaryEl.style.color = fail ? 'var(--fail)' : pass === total ? 'var(--pass)' : 'var(--muted)';
  }

  async function onRowClick(t) {
    if (running) return;
    setStatus(t.id, 'busy', null, '');
    const r = await runTest(t);
    setStatus(t.id, r.pass ? 'pass' : 'fail', r.latency, r.detail);
    updateSummary();
  }

  async function runAll() {
    if (running) return;
    running = true;
    runAllBtn.disabled = true;
    for (const t of TESTS) setStatus(t.id, 'busy', null, '');
    updateSummary();
    for (const t of TESTS) {
      const r = await runTest(t);
      setStatus(t.id, r.pass ? 'pass' : 'fail', r.latency, r.detail);
      updateSummary();
    }
    running = false;
    runAllBtn.disabled = false;
  }

  // ---------- init ----------
  document.getElementById('ext-name').textContent = chrome.i18n.getMessage('ext_name') || 'CRX Test';
  const mv = (chrome.runtime.getManifest && chrome.runtime.getManifest().manifest_version) || '?';
  document.getElementById('mv-badge').textContent = 'MV' + mv;
  document.getElementById('run-all').textContent = chrome.i18n.getMessage('run_all') || 'Run all';
  runAllBtn.addEventListener('click', runAll);

  buildUI();
  buildManualUI();
  connectHarness();
  // Auto-run once on open so a single click (toolbar icon) gives a full health check.
  setTimeout(runAll, 350);
})();
