// Background for the CRX framework regression-test extension.
// Identical logic for MV2 (persistent background page) and MV3 (service worker);
// only the manifest differs. Uses only standard chrome.* APIs.
//
// Owns the bg/content-driven tests (A1-A4, B3/B8) and the echo handlers the
// popup needs for popup→bg tests (A5-A8). The popup drives run-all and runs
// the popup-local tests itself; results for bg-driven tests flow back over the
// 'crx-test-harness' Port as {type:'test-result', test, pass, detail, latency}.

(function () {
  'use strict';

  const HANDSHAKE = 'crx-test-harness';
  let dashboardPort = null;

  // Pending resolvers for content→bg receipt tests.
  let pendingCsSend = null; // A1: expects {type:'cs-send-test'} via runtime.onMessage
  let pendingCsConnect = null; // A2: expects first msg on a 'cs-connect-test' Port

  const log = (...a) => console.log('[crx-test bg]', ...a);
  const now = () => Date.now();

  // MV2 page_action is hidden by default. Reveal it per tab using the standard
  // API so this fixture remains valid Chrome MV2 (browser_action and
  // page_action are mutually exclusive).
  if (chrome.pageAction) {
    const show = (tabId) => {
      if (typeof tabId === 'number') chrome.pageAction.show(tabId);
    };
    chrome.tabs.query({}, (tabs) => (tabs || []).forEach((tab) => show(tab.id)));
    chrome.tabs.onUpdated.addListener((tabId) => show(tabId));
  }

  function report(result) {
    log('result', result.test, result.pass ? 'PASS' : 'FAIL', result.detail);
    if (dashboardPort) {
      try {
        dashboardPort.postMessage(Object.assign({ type: 'test-result' }, result));
      } catch (e) {
        /* popup closed */
      }
    }
  }

  // ---------- helpers ----------
  function sendTab(tabId, msg) {
    return new Promise((res, rej) => {
      chrome.tabs.sendMessage(tabId, msg, (resp) => {
        const err = chrome.runtime.lastError;
        if (err) rej(new Error(err.message));
        else res(resp);
      });
    });
  }

  function raceTimeout(promise, ms) {
    return new Promise((resolve) => {
      let done = false;
      const t = setTimeout(() => {
        if (!done) {
          done = true;
          resolve({ ok: false });
        }
      }, ms);
      promise.then((v) => {
        if (!done) {
          done = true;
          clearTimeout(t);
          resolve({ ok: true, value: v });
        }
      });
    });
  }

  async function getActiveTab() {
    const q = (o) => new Promise((res) => chrome.tabs.query(o, (t) => res(t || [])));
    let tabs = await q({ active: true, lastFocusedWindow: true });
    if (!tabs.length) tabs = await q({ active: true });
    return tabs[0] || null;
  }

  // ---------- runtime.onMessage ----------
  // Receives: A1 receipt (cs-send-test) + popup→bg echo handlers (A5/A6/A7).
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || typeof msg !== 'object') return false;
    switch (msg.type) {
      case 'cs-send-test': // A1: content fired runtime.sendMessage at us
        if (pendingCsSend) {
          const p = pendingCsSend;
          pendingCsSend = null;
          p({ n: msg.n });
        }
        return false;
      case 'popup-send-sync': // A5
        sendResponse({ reply: 'sync', echo: msg.payload });
        return false;
      case 'popup-send-async': // A6 — return true + delayed sendResponse
        setTimeout(() => sendResponse({ reply: 'async', echo: msg.payload }), 60);
        return true;
      case 'popup-send-promise': // A7 — return a Promise
        return Promise.resolve({ reply: 'promise', echo: msg.payload });
      default:
        return false;
    }
  });

  // ---------- runtime.onConnect ----------
  chrome.runtime.onConnect.addListener(function (port) {
    if (port.name === HANDSHAKE) {
      dashboardPort = port;
      port.onDisconnect.addListener(() => {
        if (dashboardPort === port) dashboardPort = null;
      });
      port.onMessage.addListener(onHarnessMessage);
      log('dashboard connected');
      return;
    }
    if (port.name === 'cs-connect-test') {
      // A2: content opened a Port and posted once.
      port.onMessage.addListener(function (m) {
        if (pendingCsConnect) {
          const p = pendingCsConnect;
          pendingCsConnect = null;
          p(m);
        }
      });
      return;
    }
    if (port.name === 'popup-to-bg-connect') {
      // A8: echo popup→bg Port traffic back.
      port.onMessage.addListener(function (m) {
        port.postMessage({ reply: 'connect-echo', echo: m });
      });
      return;
    }
  });

  // ---------- harness protocol ----------
  function onHarnessMessage(req) {
    if (!req || typeof req !== 'object') return;
    if (req.type === 'run-test') {
      runBgTest(req.test)
        .then(report)
        .catch((e) =>
          report({ test: req.test, pass: false, detail: 'throw: ' + (e && e.message || e), latency: 0 }),
        );
    } else if (req.type === 'broadcast-test') {
      // A9 relay: broadcast to extension contexts; the popup confirms receipt itself.
      try {
        log('A9 broadcasting bg-push-ping');
        chrome.runtime.sendMessage({ type: 'bg-push-ping' }, () => void chrome.runtime.lastError);
      } catch (e) {
        log('A9 broadcast threw', e && e.message);
      }
    }
  }

  async function runBgTest(test) {
    if (test === 'B3') return runAlarms();
    if (test === 'B8') return runBackgroundTabsCreate();
    // A1-A4 need an active http(s) tab whose content script is injected.
    const tab = await getActiveTab();
    if (!tab || !/^https?:/.test(tab.url || '')) {
      return {
        test,
        pass: false,
        detail: 'no http(s) tab with content script (open a normal page, then re-run)',
        latency: 0,
      };
    }
    if (test === 'A1') return runA1(tab.id);
    if (test === 'A2') return runA2(tab.id);
    if (test === 'A3') return runA3(tab.id);
    if (test === 'A4') return runA4(tab.id);
    return { test, pass: false, detail: 'unknown bg test ' + test, latency: 0 };
  }

  async function runBackgroundTabsCreate() {
    const t0 = now();
    const queryAll = () =>
      new Promise((res, rej) => {
        chrome.tabs.query({}, (tabs) => {
          const err = chrome.runtime.lastError;
          if (err) rej(new Error(err.message));
          else res(tabs || []);
        });
      });
    const create = (details) =>
      new Promise((res, rej) => {
        chrome.tabs.create(details, (tab) => {
          const err = chrome.runtime.lastError;
          if (err) rej(new Error(err.message));
          else res(tab);
        });
      });
    const remove = (tabId) =>
      new Promise((res) => {
        chrome.tabs.remove(tabId, () => {
          void chrome.runtime.lastError;
          res();
        });
      });

    let created = null;
    let fresh = null;
    try {
      const before = await queryAll();
      const beforeIds = new Set(before.map((tab) => tab && tab.id));
      created = await create({
        url: 'about:blank?crxtest=background-create-' + Math.random().toString(36).slice(2),
        active: false,
      });
      for (let i = 0; i < 20; i++) {
        const live = await queryAll();
        fresh = live.find((tab) => tab && typeof tab.id === 'number' && !beforeIds.has(tab.id));
        if (fresh) break;
        await new Promise((res) => setTimeout(res, 150));
      }
      const returnedRealId = created && typeof created.id === 'number' && created.id >= 0;
      const liveRealId = fresh && typeof fresh.id === 'number' && fresh.id >= 0;
      const sameTab = returnedRealId && liveRealId && created.id === fresh.id;
      return {
        test: 'B8',
        pass: !!sameTab,
        detail: sameTab
          ? 'worker created real tab id=' + fresh.id + ' (then removed)'
          : 'fake/missing tab: returned=' + JSON.stringify(created) + ' live=' + JSON.stringify(fresh),
        latency: now() - t0,
      };
    } catch (e) {
      return {
        test: 'B8',
        pass: false,
        detail: 'background tabs.create failed: ' + ((e && e.message) || e),
        latency: now() - t0,
      };
    } finally {
      const cleanupId =
        fresh && typeof fresh.id === 'number' && fresh.id >= 0
          ? fresh.id
          : created && typeof created.id === 'number' && created.id >= 0
            ? created.id
            : null;
      if (cleanupId !== null) await remove(cleanupId);
    }
  }

  async function runA1(tabId) {
    pendingCsSend = null;
    const p = new Promise((res) => {
      pendingCsSend = res;
    });
    const t0 = now();
    try {
      await sendTab(tabId, { type: 'do-cs-to-bg-send' });
    } catch (e) {
      return { test: 'A1', pass: false, detail: 'trigger failed: ' + e.message, latency: now() - t0 };
    }
    const r = await raceTimeout(p, 4000);
    return {
      test: 'A1',
      pass: r.ok,
      detail: r.ok ? 'received cs-send-test n=' + r.value.n : 'no cs-send-test received (timeout)',
      latency: now() - t0,
    };
  }

  async function runA2(tabId) {
    pendingCsConnect = null;
    const p = new Promise((res) => {
      pendingCsConnect = res;
    });
    const t0 = now();
    try {
      await sendTab(tabId, { type: 'do-cs-to-bg-connect' });
    } catch (e) {
      return { test: 'A2', pass: false, detail: 'trigger failed: ' + e.message, latency: now() - t0 };
    }
    const r = await raceTimeout(p, 4000);
    return {
      test: 'A2',
      pass: r.ok,
      detail: r.ok ? 'received cs-connect-msg n=' + r.value.n : 'no cs-connect Port/msg (timeout)',
      latency: now() - t0,
    };
  }

  async function runA3(tabId) {
    const t0 = now();
    const payload = 'p' + Math.random().toString(36).slice(2);
    try {
      const r = await sendTab(tabId, { type: 'echo', payload });
      const ok = r && r.type === 'echo-reply' && r.echoed === payload;
      return {
        test: 'A3',
        pass: ok,
        detail: ok ? 'echo matched' : 'bad response: ' + JSON.stringify(r),
        latency: now() - t0,
      };
    } catch (e) {
      return { test: 'A3', pass: false, detail: 'tabs.sendMessage failed: ' + e.message, latency: now() - t0 };
    }
  }

  function runA4(tabId) {
    const t0 = now();
    return new Promise((res) => {
      let port;
      try {
        port = chrome.tabs.connect(tabId, { name: 'bg-to-cs-connect' });
      } catch (e) {
        res({ test: 'A4', pass: false, detail: 'tabs.connect threw: ' + e.message, latency: now() - t0 });
        return;
      }
      const fail = setTimeout(
        () => res({ test: 'A4', pass: false, detail: 'no echo over Port (timeout)', latency: now() - t0 }),
        4000,
      );
      port.onMessage.addListener(function (m) {
        clearTimeout(fail);
        const ok = m && m.type === 'echo-port';
        res({
          test: 'A4',
          pass: ok,
          detail: ok ? 'port echo received' : 'bad echo: ' + JSON.stringify(m),
          latency: now() - t0,
        });
      });
      try {
        port.postMessage({ type: 'bg-connect-msg', n: Math.random().toString(36).slice(2) });
      } catch (e) {
        clearTimeout(fail);
        res({ test: 'A4', pass: false, detail: 'postMessage threw: ' + e.message, latency: now() - t0 });
      }
    });
  }

  // B3 — runs in bg/SW; verifies alarms.create + onAlarm fire (and SW wake for MV3).
  // Framework honors sub-minute delayInMinutes (alarms.ts uses delay*60000 directly).
  function runAlarms() {
    return new Promise((res) => {
      const t0 = now();
      const name = 'crx-test-' + Math.random().toString(36).slice(2);
      function handler(a) {
        if (!a || a.name !== name) return;
        clearTimeout(fail);
        chrome.alarms.onAlarm.removeListener(handler);
        res({ test: 'B3', pass: true, detail: 'onAlarm fired name=' + a.name, latency: now() - t0 });
      }
      const fail = setTimeout(() => {
        chrome.alarms.onAlarm.removeListener(handler);
        try {
          chrome.alarms.clear(name);
        } catch (e) {
          /* ignore */
        }
        res({ test: 'B3', pass: false, detail: 'onAlarm did not fire (timeout)', latency: now() - t0 });
      }, 8000);
      chrome.alarms.onAlarm.addListener(handler);
      try {
        chrome.alarms.create(name, { delayInMinutes: 0.05 }); // ~3s
      } catch (e) {
        clearTimeout(fail);
        chrome.alarms.onAlarm.removeListener(handler);
        res({ test: 'B3', pass: false, detail: 'alarms.create threw: ' + e.message, latency: now() - t0 });
      }
    });
  }

  log('background ready', chrome.runtime.id);
})();
