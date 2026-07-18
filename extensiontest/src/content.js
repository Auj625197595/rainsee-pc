// Content script for the CRX framework regression-test extension.
// Runs in the page's isolated world via a manifest content_scripts entry
// (the same declarative path Dark Reader uses), bridged by the framework SHIM.
//
// Responsibilities:
//  - Announce injection (visible in the page's DevTools console).
//  - On bg coordination, exercise the content→bg directions:
//      A1 content→bg sendMessage,  A2 content→bg connect
//  - Respond to the bg→content directions:
//      A3 bg→content sendMessage (echo),  A4 bg→content connect (port echo)

(function () {
  'use strict';

  console.log('[crx-test] content injected', chrome.runtime.id);

  function rand() {
    return Math.random().toString(36).slice(2);
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || typeof msg !== 'object') return;
    try {
      if (msg.type === 'do-cs-to-bg-send') {
        // A1: fire a one-shot runtime.sendMessage at the background.
        var n = rand();
        chrome.runtime.sendMessage({ type: 'cs-send-test', n: n }, function () {
          // sendResponse is ack to bg's trigger; the real A1 signal is bg's
          // own onMessage receiving {type:'cs-send-test'}.
          sendResponse({ sent: true, n: n });
        });
        return true; // async sendResponse
      }
      if (msg.type === 'do-cs-to-bg-connect') {
        // A2: open a long-lived Port to the background and post once.
        var n2 = rand();
        var port = chrome.runtime.connect({ name: 'cs-connect-test' });
        port.postMessage({ type: 'cs-connect-msg', n: n2 });
        sendResponse({ connected: true, n: n2 });
        return false;
      }
      if (msg.type === 'echo') {
        // A3: echo the payload back to the background.
        sendResponse({ type: 'echo-reply', echoed: msg.payload });
        return false;
      }
    } catch (e) {
      sendResponse({ error: String(e && e.message || e) });
    }
    return false;
  });

  // A4: bg→content connect — echo any message back over the same port.
  chrome.runtime.onConnect.addListener(function (port) {
    if (port.name !== 'bg-to-cs-connect') return;
    port.onMessage.addListener(function (m) {
      port.postMessage({ type: 'echo-port', echoed: m });
    });
  });
})();
