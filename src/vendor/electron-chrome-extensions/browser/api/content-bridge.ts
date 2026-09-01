/**
 * Builds the page-side `chrome` bridge that is prepended before an extension's
 * dynamically-registered content scripts (e.g. Tampermonkey's `content.js`).
 *
 * Why this exists: content scripts registered via
 * `chrome.scripting.registerContentScripts` are injected into normal web pages
 * (the `persist:view` session) whose frames run with `contextIsolation: false`
 * and do NOT load the extension preload (`crx-preload`). So the page world has
 * no `chrome` object bound to the extension. We synthesize a minimal one here,
 * tunnelling over `window.electron.ipcRenderer` (exposed by `view-preload.ts`)
 * to the main-process messaging hub (`browser/api/messaging.ts`).
 *
 * Only the surface Tampermonkey's content.js relies on is implemented:
 *   chrome.runtime.id / getManifest() / getURL() / connect() / sendMessage() /
 *   onMessage, and chrome.i18n.getMessage (no-op-ish).
 *
 * IPC channels (must match messaging.ts):
 *   invoke 'crx-port-connect'   (extensionId, {name})        -> portId
 *   send   'crx-port-post'      (portId, message)
 *   send   'crx-port-disconnect'(portId)
 *   recv   'crx-port-post:<portId>'       (message)
 *   recv   'crx-port-disconnect:<portId>' ()
 *   invoke 'crx-runtime-message'(extensionId, message)        -> response
 *   recv   'crx-dynamic-cs-message' (messageId, message, sender) [tabs.sendMessage -> dynamic CS]
 *   send   'crx-cs-message-response' (messageId, response)
 */
/**
 * Cache of the serialized bridge per extension. The bridge depends only on the
 * extension id + manifest, so it can be reused across every frame/navigation
 * and only needs rebuilding when the extension reloads (see
 * `clearContentScriptBridge`). Avoids re-serializing on each injection.
 */
type BridgeSurface = 'content-script' | 'user-script-messaging';

const bridgeCache = new Map<string, string>();

/** Drop the cached bridge for an extension. Call on `extension-unloaded`. */
export function clearContentScriptBridge(extensionId: string) {
  bridgeCache.delete(`content-script:${extensionId}`);
  bridgeCache.delete(`user-script-messaging:${extensionId}`);
}

export function buildContentScriptBridge(
  extensionId: string,
  manifest: any,
  surface: BridgeSurface = 'content-script',
): string {
  const cacheKey = `${surface}:${extensionId}`;
  const cached = bridgeCache.get(cacheKey);
  if (cached) return cached;

  const manifestJson = JSON.stringify(manifest || {});
  const extId = JSON.stringify(extensionId);

  // IMPORTANT: this function body is serialized and runs in the PAGE main world.
  // It must be fully self-contained (no closure variables, no TS-only syntax).
  function bridge(EXT_ID: string, MANIFEST: any, SURFACE: BridgeSurface) {
    const w: any = window as any;
    const g: any = globalThis as any;

    // Reuse an existing bridge if a prior script already installed it.
    if (
      g.chrome &&
      g.chrome.runtime &&
      g.chrome.runtime.__crxBridge === EXT_ID &&
      g.chrome.runtime.__crxBridgeSurface === SURFACE
    ) return;

    const directIpc = w.electron && w.electron.ipcRenderer;

    // Arbitrary Electron isolated worlds do not inherit the preload world's
    // `window.electron`. view-preload exposes the same messaging routes over a
    // window.postMessage protocol, so adapt that protocol to the small subset
    // of ipcRenderer used below. Keeping one Port/runtime implementation avoids
    // subtle MV2/MV3 differences between direct and isolated-world injection.
    const ipc = (() => {
      if (directIpc) return directIpc;

      let sequence = 0;
      const listeners: Record<string, Function[]> = Object.create(null);
      const pendingMessages: Record<
        string,
        { resolve: Function; timer: any; retryTimer: any }
      > =
        Object.create(null);
      const outboundPorts: Record<string, { retryTimer: any; stopTimer: any }> =
        Object.create(null);

      const stopPortRetry = (connId: string) => {
        const port = outboundPorts[connId];
        if (!port || !port.retryTimer) return;
        clearInterval(port.retryTimer);
        clearTimeout(port.stopTimer);
        port.retryTimer = null;
        port.stopTimer = null;
      };

      const emit = (channel: string, ...args: any[]) => {
        const callbacks = (listeners[channel] || []).slice();
        for (const callback of callbacks) {
          try {
            callback({}, ...args);
          } catch (err) {
            console.error(err);
          }
        }
      };

      w.addEventListener('message', (event: any) => {
        const data = event && event.data;
        if (!data) return;

        if (data.__crxCsSendResp && data.mid) {
          const pending = pendingMessages[data.mid];
          if (!pending) return;
          delete pendingMessages[data.mid];
          clearTimeout(pending.timer);
          clearInterval(pending.retryTimer);
          pending.resolve(data.response);
          return;
        }
        if (data.__crxCSPortAck && data.connId) {
          if (data.extId && data.extId !== EXT_ID) return;
          stopPortRetry(data.connId);
          return;
        }
        if (data.__crxCSPortIn && data.connId) {
          emit('crx-port-post:' + data.connId, data.message);
          return;
        }
        if (data.__crxCSPortDisIn && data.connId) {
          stopPortRetry(data.connId);
          delete outboundPorts[data.connId];
          emit('crx-port-disconnect:' + data.connId);
          return;
        }
        if (data.__crxCsFwd && data.messageId) {
          if (data.extensionId && data.extensionId !== EXT_ID) return;
          emit(
            'crx-dynamic-cs-message',
            data.messageId,
            data.message,
            data.sender || {},
          );
          return;
        }
        if (data.__crxSwConnect && data.portId) {
          if (data.sender && data.sender.id && data.sender.id !== EXT_ID)
            return;
          emit('crx-runtime.onConnect', {
            portId: data.portId,
            name: data.name || '',
            sender: data.sender || { id: EXT_ID },
          });
          return;
        }
        if (data.__crxSwPortPost && data.portId) {
          emit('crx-port-post:' + data.portId, data.message);
          return;
        }
        if (data.__crxSwPortDisconnect && data.portId) {
          emit('crx-port-disconnect:' + data.portId);
        }
      });

      return {
        invoke(channel: string, ...args: any[]) {
          if (channel === 'crx-runtime-message') {
            const mid = EXT_ID + '-message-' + ++sequence;
            return new Promise((resolve) => {
              const timer = setTimeout(() => {
                const pending = pendingMessages[mid];
                if (!pending) return;
                delete pendingMessages[mid];
                clearInterval(pending.retryTimer);
                resolve(undefined);
              }, 30000);
              const post = () => {
                if (!pendingMessages[mid]) return;
                try {
                  w.postMessage(
                    {
                      __crxCsSend: true,
                      mid,
                      extId: args[0] || EXT_ID,
                      message: args[1],
                    },
                    '*',
                  );
                } catch {
                  // The preload relay may not exist yet. Keep retrying until
                  // it responds or the normal runtime timeout expires.
                }
              };
              const retryTimer = setInterval(post, 100);
              pendingMessages[mid] = { resolve, timer, retryTimer };
              post();
            });
          }
          if (channel === 'crx-port-connect') {
            const connId = EXT_ID + '-port-' + ++sequence;
            const message = {
              __crxCSConnect: true,
              connId,
              extId: args[0] || EXT_ID,
              name: (args[1] && args[1].name) || '',
            };
            const post = () => {
              if (!outboundPorts[connId]) return;
              try {
                w.postMessage(message, '*');
              } catch {
                // The receiving preload can be installed after document_start.
              }
            };
            outboundPorts[connId] = {
              retryTimer: setInterval(post, 100),
              stopTimer: setTimeout(() => stopPortRetry(connId), 30000),
            };
            post();
            return Promise.resolve(connId);
          }
          return Promise.resolve(undefined);
        },
        send(channel: string, ...args: any[]) {
          if (channel === 'crx-port-post') {
            const portId = args[0];
            w.postMessage(
              outboundPorts[portId]
                ? { __crxCSPortOut: true, connId: portId, message: args[1] }
                : { __crxSwPortPostBack: true, portId, message: args[1] },
              '*',
            );
          } else if (channel === 'crx-port-disconnect') {
            const portId = args[0];
            stopPortRetry(portId);
            w.postMessage(
              outboundPorts[portId]
                ? { __crxCSPortDisOut: true, connId: portId }
                : { __crxSwPortDisconnectBack: true, portId },
              '*',
            );
            delete outboundPorts[portId];
          } else if (channel === 'crx-cs-message-response') {
            w.postMessage(
              { __crxCsFwdResp: true, messageId: args[0], response: args[1] },
              '*',
            );
          }
        },
        on(channel: string, callback: Function) {
          const callbacks = listeners[channel] || (listeners[channel] = []);
          if (callbacks.indexOf(callback) < 0) callbacks.push(callback);
          return this;
        },
        removeListener(channel: string, callback: Function) {
          const callbacks = listeners[channel];
          if (!callbacks) return this;
          const index = callbacks.indexOf(callback);
          if (index >= 0) callbacks.splice(index, 1);
          return this;
        },
        sendSync(): any {
          // Synchronous i18n lookup cannot cross window.postMessage. The i18n
          // implementation below falls back to navigator.language and an empty
          // catalog; runtime messaging and Ports remain fully functional.
          return undefined;
        },
      };
    })();

    let portCounter = 0;
    const baseUrl = 'chrome-extension://' + EXT_ID + '/';

    class Evt {
      _ls: Function[] = [];
      addListener(cb: Function) {
        this._ls.push(cb);
      }
      removeListener(cb: Function) {
        const i = this._ls.indexOf(cb);
        if (i > -1) this._ls.splice(i, 1);
      }
      hasListener(cb: Function) {
        return this._ls.indexOf(cb) > -1;
      }
      hasListeners() {
        return this._ls.length > 0;
      }
      _emit(...args: any[]) {
        const results: any[] = [];
        for (const l of this._ls.slice()) {
          try {
            results.push(l(...args));
          } catch (e) {
            console.error(e);
            results.push(undefined);
          }
        }
        return results;
      }
    }

    class Port {
      name: string;
      onMessage = new Evt();
      onDisconnect = new Evt();
      private _id: string | null = null;
      private _pending: any[] = [];
      private _closed = false;
      private _msgChan = '';
      private _disChan = '';
      private _onMsg: any;
      private _onDis: any;

      constructor(name: string, inboundId?: string) {
        this.name = name || '';
        if (inboundId) {
          // Inbound port: the main process already assigned the id and delivered
          // it via crx-runtime.onConnect (chrome.tabs.connect from the
          // background). Bind directly without opening a new connection.
          this._bind(inboundId);
        } else {
          // Outbound port (chrome.runtime.connect from the content script to
          // the background): open a connection and bind once we have an id.
          ipc
            .invoke('crx-port-connect', EXT_ID, { name: this.name })
            .then((portId: string) => {
              if (this._closed) {
                ipc.send('crx-port-disconnect', portId);
                return;
              }
              this._bind(portId);
            })
            .catch((err: any) => {
              console.error('crx port connect failed', err);
              this._handleDisconnect();
            });
        }
      }

      private _bind(portId: string) {
        this._id = portId;
        this._msgChan = 'crx-port-post:' + portId;
        this._disChan = 'crx-port-disconnect:' + portId;
        this._onMsg = (_e: any, message: any) =>
          this.onMessage._emit(message, this);
        this._onDis = () => this._handleDisconnect();
        ipc.on(this._msgChan, this._onMsg);
        ipc.on(this._disChan, this._onDis);
        const pend = this._pending;
        this._pending = [];
        for (const m of pend) ipc.send('crx-port-post', portId, m);
      }

      postMessage(message: any) {
        if (this._closed) return;
        const serialized = serializeMessage(message);
        if (this._id) ipc.send('crx-port-post', this._id, serialized);
        else this._pending.push(serialized);
      }

      disconnect() {
        if (this._closed) return;
        this._closed = true;
        if (this._id) ipc.send('crx-port-disconnect', this._id);
        this._cleanup();
      }

      private _handleDisconnect() {
        if (this._closed) return;
        this._closed = true;
        this._cleanup();
        this.onDisconnect._emit(this);
      }

      private _cleanup() {
        if (this._id) {
          ipc.removeListener(this._msgChan, this._onMsg);
          ipc.removeListener(this._disChan, this._onDis);
        }
      }
    }

    const onMessage = new Evt();
    const onConnect = new Evt();

    const serializeMessage = (value: any) => {
      const serialized = JSON.stringify(value);
      return serialized === undefined ? undefined : JSON.parse(serialized);
    };

    // chrome.runtime.lastError: Chrome exposes this as a getter that is set
    // during the callback following a failed message/disconnect, then cleared.
    // Backed by a mutable slot; sendMessage sets it on a no-response and clears
    // it on the next microtask.
    let _lastError: any = undefined;

    // Deliver one-shot messages sent to this dynamic content script (tabs.sendMessage).
    ipc.on(
      'crx-dynamic-cs-message',
      (_e: any, messageId: string, message: any, sender: any) => {
        let responded = false;
        const sendResponse = (response: any) => {
          if (responded) return;
          responded = true;
          let serialized = response;
          try {
            if (response !== undefined) serialized = serializeMessage(response);
          } catch {
            serialized = undefined;
          }
          ipc.send('crx-cs-message-response', messageId, serialized);
        };
        const results = onMessage._emit(message, sender || {}, sendResponse);
        let asyncPending = false;
        for (const result of results) {
          if (result === true) {
            asyncPending = true;
            continue;
          }
          if (result && typeof result.then === 'function') {
            asyncPending = true;
            Promise.resolve(result).then(
              (value) => {
                if (!responded) sendResponse(value);
              },
              () => {
                if (!responded) sendResponse(undefined);
              },
            );
          } else if (result !== undefined && result !== false && !responded) {
            sendResponse(result);
          }
        }
        if (!asyncPending && !responded) sendResponse(undefined);
        if (asyncPending) {
          setTimeout(() => {
            if (!responded) sendResponse(undefined);
          }, 30000);
        }
      },
    );

    // Accept inbound long-lived ports opened from the background via
    // chrome.tabs.connect (the main process delivers crx-runtime.onConnect to
    // this frame — see messaging.connectToTab). Build an inbound Port bound to
    // the assigned id and fire runtime.onConnect. Previously onConnect was
    // declared here but never fed, so background->content-script ports silently
    // never fired.
    ipc.on('crx-runtime.onConnect', (_e: any, payload: any) => {
      if (!payload || !payload.portId) return;
      const port = new Port(payload.name || '', payload.portId);
      try {
        (port as any).sender = payload.sender || { id: EXT_ID };
      } catch {
        /* sender assignment is best-effort */
      }
      onConnect._emit(port);
    });

    const runtime: any = {
      __crxBridge: EXT_ID,
      __crxBridgeSurface: SURFACE,
      id: EXT_ID,
      getManifest: () => MANIFEST,
      getURL: (p: string) => baseUrl + String(p || '').replace(/^\/+/, ''),
      getPlatformInfo: (cb?: any) => {
        // Minimal static info; content scripts only branch on os/arch loosely.
        const info = { os: 'win', arch: 'x86-64', nacl_arch: 'x86-64' };
        if (cb) {
          cb(info);
          return undefined;
        }
        return Promise.resolve(info);
      },
      connect: (arg?: any) => {
        const name = typeof arg === 'string' ? arg : arg && arg.name;
        return new Port(name);
      },
      sendMessage: (...args: any[]) => {
        // Chrome signatures also allow an options object before the callback.
        // runtime.sendMessage currently has no routing options in this bridge;
        // preserve the argument for signature compatibility and intentionally
        // ignore it (tabs.sendMessage handles frameId separately).
        const cb =
          typeof args[args.length - 1] === 'function' ? args.pop() : undefined;
        let message = args[0];
        if (
          typeof args[0] === 'string' &&
          args.length >= 2 &&
          typeof args[1] !== 'function'
        ) {
          message = args[1];
        }
        let serialized: any;
        try {
          serialized = serializeMessage(message);
        } catch {
          serialized = undefined;
        }
        const p = ipc.invoke('crx-runtime-message', EXT_ID, serialized);
        if (cb) {
          const noReceiver = () => {
            _lastError = {
              message:
                'The message port closed before a response was received.',
            };
            queueMicrotask(() => {
              _lastError = undefined;
            });
          };
          p.then((r: any) => {
            if (r === undefined) noReceiver();
            cb(r);
          }).catch(() => {
            noReceiver();
            cb(undefined);
          });
          return;
        }
        return p;
      },
      onMessage,
      onConnect,
      get lastError() {
        return _lastError;
      },
    };

    // A child-frame preload world is shared by the host. Replace a bridge that
    // belongs to another extension; injected script bodies capture this chrome
    // object lexically, so later injections cannot change their identity.
    g.chrome = {};
    // Note: USER_SCRIPT worlds (Tampermonkey's content.js bridge) reach for the
    // full chrome surface — chrome.runtime.onMessage/getURL/getPlatformInfo/id,
    // chrome.offscreen, chrome.extension.inIncognitoContext — not just the two
    // outbound methods Chrome strictly exposes after configureWorld({messaging:
    // true}). Restricting the surface to connect/sendMessage made TM's bridge
    // throw on the first missing API and never send its "prepare" message,
    // leaving the toolbar icon stuck on icon_forbidden. Expose the full surface
    // for both 'content-script' and 'user-script-messaging'.
    g.chrome.runtime = runtime;
    // Legacy chrome.extension surface that legacy content scripts reach for.
    // getBackgroundPage returns null (a content script can't touch the bg page
    // object); sendMessage/connect alias runtime's; onMessage/onConnect share
    // the runtime events. Previously this was a single-field stub, so any
    // content script calling extension.getURL/sendMessage/connect threw.
    if (!g.chrome.extension) {
      g.chrome.extension = {
        inIncognitoContext: false,
        getURL: (p: string): string =>
          baseUrl + String(p || '').replace(/^\/+/, ''),
        getBackgroundPage: (): any => null,
        getExtensionTabs: (): any[] => [],
        sendMessage: (...args: any[]): any => runtime.sendMessage(...args),
        connect: (arg?: any): any => runtime.connect(arg),
        onMessage,
        onConnect,
      };
    }
    if (!g.chrome.i18n) {
      // chrome.i18n.getMessage is synchronous, so fetch the extension's resolved
      // _locales catalog once over the same sync IPC the bridge already tunnels
      // through view-preload, then resolve locally. The main process answers
      // 'crx-i18n' with { uiLocale, messageLocale, messages } for the browser UI
      // language (see browser/api/i18n.ts). Fetched lazily so pages that never
      // localize pay nothing.
      //
      // NOTE: this MUST stay synchronous (sendSync). getMessage is called during
      // the extension's first synchronous render, so an async prime would return
      // an empty placeholder and the UI would fall back to English. The
      // renderer preload uses sendSync for frames for the same reason.
      let _cat: any = null;
      const _getCat = () => {
        if (_cat) return _cat;
        try {
          _cat = ipc.sendSync('crx-i18n', EXT_ID) || {};
        } catch (e) {
          _cat = {};
        }
        // navigator.language reflects the app UI language selected with --lang;
        // use it instead of hard-coding en-US when the catalog is unavailable.
        const navLang =
          (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
        _cat.messages = _cat.messages || {};
        _cat.uiLocale = _cat.uiLocale || navLang;
        _cat.messageLocale =
          _cat.messageLocale || String(navLang).replace('-', '_');
        return _cat;
      };
      const _isRtl = () =>
        /^(ar|he|fa|ur|ps|sd|ug|yi)(?:[-_]|$)/i.test(_getCat().messageLocale);
      const i18nSubstitute = (entry: any, subs: any) => {
        let msg = String(entry && entry.message != null ? entry.message : '');
        const placeholders = (entry && entry.placeholders) || {};
        msg = msg.replace(
          /\$([a-zA-Z0-9_@]+)\$/g,
          (m: string, name: string) => {
            const ph = placeholders[String(name).toLowerCase()];
            return ph && ph.content != null ? ph.content : m;
          },
        );
        const args = subs == null ? [] : Array.isArray(subs) ? subs : [subs];
        msg = msg.replace(/\$(\$|[1-9])/g, (_m: string, p: string) => {
          if (p === '$') return '$';
          const v = args[parseInt(p, 10) - 1];
          return v == null ? '' : String(v);
        });
        return msg;
      };
      g.chrome.i18n = {
        getMessage: (name: string, subs: any) => {
          name = String(name || '');
          switch (name) {
            case '@@extension_id':
              return EXT_ID;
            case '@@ui_locale':
              return _getCat().messageLocale;
            case '@@bidi_dir':
              return _isRtl() ? 'rtl' : 'ltr';
            case '@@bidi_reversed_dir':
              return _isRtl() ? 'ltr' : 'rtl';
            case '@@bidi_start_edge':
              return _isRtl() ? 'right' : 'left';
            case '@@bidi_end_edge':
              return _isRtl() ? 'left' : 'right';
          }
          const entry = _getCat().messages[name.toLowerCase()];
          return entry ? i18nSubstitute(entry, subs) : '';
        },
        getUILanguage: () => _getCat().uiLocale,
        getAcceptLanguages: (cb: any) => {
          const r = [_getCat().uiLocale];
          if (cb) cb(r);
          return Promise.resolve(r);
        },
      };
    }

    // chrome.storage: real Chrome grants content scripts (with the "storage"
    // permission) the SAME store the background/service worker owns. A normal
    // page world has no native chrome.storage, so tunnel every op over the
    // runtime-message IPC to the extension context that owns the real store —
    // see renderer/index.ts (__crxStorageOp interceptor). Gated on the manifest
    // permission so extensions without it don't see chrome.storage (matches
    // Chrome, where accessing it would otherwise be undefined).
    let _perms: any[] = [];
    try {
      _perms = ((MANIFEST && MANIFEST.permissions) || []).concat(
        (MANIFEST && MANIFEST.optional_permissions) || [],
      );
    } catch (e) {
      _perms = [];
    }
    if (!g.chrome.storage && _perms.indexOf('storage') >= 0) {
      const storageOp = (area: string, method: string) =>
        function (this: any) {
          const a: any[] = [];
          for (let i = 0; i < arguments.length; i++) a.push(arguments[i]);
          const cb = typeof a[a.length - 1] === 'function' ? a.pop() : undefined;
          const p = Promise.resolve(
            ipc.invoke('crx-runtime-message', EXT_ID, {
              __crxStorageOp: true,
              area,
              method,
              arg: a.length ? a[0] : undefined,
            }),
          ).then((r: any) => {
            if (r && r.__crxStorageErr) throw new Error(r.__crxStorageErr);
            return r ? r.value : undefined;
          });
          if (cb) {
            p.then(
              (v: any) => {
                _lastError = undefined;
                try { cb(v); } catch (e) { console.error(e); }
              },
              (err: any) => {
                _lastError = { message: String((err && err.message) || err) };
                try { cb(undefined); } catch (e) { console.error(e); }
                queueMicrotask(() => { _lastError = undefined; });
              },
            );
            return undefined;
          }
          return p;
        };

      const areas: any = {};
      const globalOnChanged = new Evt();
      const makeArea = (area: string) => {
        const areaChanged = new Evt();
        const a: any = {
          get: storageOp(area, 'get'),
          getBytesInUse: storageOp(area, 'getBytesInUse'),
          set: storageOp(area, 'set'),
          remove: storageOp(area, 'remove'),
          clear: storageOp(area, 'clear'),
          onChanged: areaChanged,
        };
        if (area === 'sync') {
          a.QUOTA_BYTES = 102400;
          a.QUOTA_BYTES_PER_ITEM = 8192;
          a.MAX_ITEMS = 512;
          a.MAX_WRITE_OPERATIONS_PER_HOUR = 1800;
          a.MAX_WRITE_OPERATIONS_PER_MINUTE = 120;
        } else if (area === 'local') {
          a.QUOTA_BYTES = 10485760;
        }
        areas['__evt_' + area] = areaChanged;
        return a;
      };
      const storage: any = {
        local: makeArea('local'),
        sync: makeArea('sync'),
        session: makeArea('session'),
        managed: makeArea('managed'),
        onChanged: globalOnChanged,
      };

      // Change propagation: the owning context (SW/background) relays native
      // storage.onChanged to the main process, which broadcasts 'crx-storage-
      // changed' to every frame. Fire the global + matching per-area sink so
      // content scripts observe writes from ANY context, exactly like Chrome.
      ipc.on('crx-storage-changed', (_e: any, payload: any) => {
        if (!payload || payload.extensionId !== EXT_ID) return;
        const changes = payload.changes || {};
        const areaName = payload.area || 'local';
        try {
          globalOnChanged._emit(changes, areaName);
        } catch (e) {
          console.error(e);
        }
        const areaEvt = areas['__evt_' + areaName];
        if (areaEvt) {
          try {
            areaEvt._emit(changes);
          } catch (e) {
            console.error(e);
          }
        }
      });

      g.chrome.storage = storage;
    }
  }

  const serialized = `;(${bridge.toString()})(${extId}, ${manifestJson}, ${JSON.stringify(surface)});`;
  bridgeCache.set(cacheKey, serialized);
  return serialized;
}

/** Restricted bridge for chrome.userScripts USER_SCRIPT worlds with messaging enabled. */
export function buildUserScriptMessagingBridge(extensionId: string, manifest: any): string {
  return buildContentScriptBridge(extensionId, manifest, 'user-script-messaging');
}
