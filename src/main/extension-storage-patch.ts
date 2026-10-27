import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import { dirname, resolve, sep } from 'path';
import { RUNTIME_CONTEXT_TYPE } from '../vendor/electron-chrome-extensions/runtime-context-type';

// Marker proving a file already carries the shim. The version suffix is a HASH
// of the shim body (see SHIM_VERSION below), so ANY edit to the body changes the
// marker and forces already-patched files to be re-patched — no manual version
// bump, and watch-mode intermediate builds can never leave a file stuck with a
// stale body under a current marker. Keep the prefix stable so any prior
// version's line can be detected and stripped.
const MARKER_PREFIX = '/*__crx_storage_sync_shim';

// Directory-level success record. patchExtensionStorage writes the current
// patch-state version here only when EVERY entry file was patched successfully;
// on any failure it removes the marker so the next startup scan retries. The
// startup scan reads this single file (see isExtensionStoragePatched) instead
// of re-reading every entry file each boot. Not JS / not in the manifest, so it
// is never itself an entry and never gets patched.
const PATCH_STATE_FILE = '.crx_storage_patch';

// In development the browser's internal UI is served from this origin. Chrome
// never injects extension content scripts into chrome:// pages, but Electron
// otherwise treats this origin as a normal <all_urls> target.
const INTERNAL_CONTENT_SCRIPT_EXCLUDES = ['http://localhost:4444/*'];

function hasInternalContentScriptExcludes(manifest: any): boolean {
  if (!Array.isArray(manifest?.content_scripts)) return true;
  return manifest.content_scripts.every((contentScript: any) => {
    if (!contentScript || typeof contentScript !== 'object') return true;
    const excludes = Array.isArray(contentScript?.exclude_matches)
      ? contentScript.exclude_matches
      : [];
    return INTERNAL_CONTENT_SCRIPT_EXCLUDES.every((pattern) =>
      excludes.includes(pattern),
    );
  });
}

async function patchInternalContentScriptExcludes(
  extDir: string,
): Promise<boolean> {
  const manifestPath = resolve(extDir, 'manifest.json');
  try {
    const original = await fs.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(original);
    if (!Array.isArray(manifest?.content_scripts)) return true;

    let changed = false;
    for (const contentScript of manifest.content_scripts) {
      if (!contentScript || typeof contentScript !== 'object') continue;
      const excludes = Array.isArray(contentScript.exclude_matches)
        ? contentScript.exclude_matches
        : [];
      for (const pattern of INTERNAL_CONTENT_SCRIPT_EXCLUDES) {
        if (excludes.includes(pattern)) continue;
        excludes.push(pattern);
        changed = true;
      }
      contentScript.exclude_matches = excludes;
    }
    if (changed) {
      await fs.writeFile(
        manifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
        'utf8',
      );
    }
    return true;
  } catch {
    return false;
  }
}

// Self-contained shim prepended to each extension JS entry. Runs in the SAME
// world/context as the extension code, on the SAME native `chrome`, BEFORE any
// business logic.
//
// Keep this layer deliberately narrow. The vendor preload/runtime bridge owns
// extension API compatibility; this source-level shim only handles fixes that
// must run before any bundled extension code can choose the wrong branch:
//   1. consume the popup's transient tab snapshot before hash routers start;
//   2. install Chrome's guarded `browser = chrome` fallback only for MV3 when
//      Electron does not deliver the extension-page preload;
//   3. provide early chrome.permissions when the popup preload lands late;
//   4. bridge declarative content-script message listeners when crx-preload is
//      not present in that isolated world;
//   5. route popup tabs.sendMessage through the current tab when the preload
//      bridge is missing;
//   6. map unsupported chrome.storage.sync/managed onto local.
//   7. keep animation frames progressing when Electron leaves an active
//      BrowserView in the hidden page lifecycle state.
//   8. normalize an explicitly undefined runtime.connect extensionId exactly
//      like Chromium does for the omitted optional argument.
//
// Electron's native chrome.storage exposes `sync`/`managed` as OBJECTS that
// READ FINE (so `!!st.sync` is true) but whose METHODS (.get/.set/...) throw
// '"sync" is not available in this instance of Chrome'. So we must NOT skip on
// "property exists" — we overwrite sync/managed with `local` UNLESS they are
// already === local. Descriptors are configurable on Electron 42, so
// defineProperty on the live storage object succeeds; a wholesale
// chrome.storage replacement is the fallback if any redefine throws.
const SHIM_BODY = (
  `(function(){` +
  // The popup URL carries its real tab snapshot in `#crxbridge=...` because
  // the fragment is available even when Electron skips both crx-preload and
  // executeJavaScript. Treat it as a bootstrap transport, not as extension
  // navigation state: synchronously cache a valid array, then remove only the
  // bridge segment with replaceState before Vue/React/hash routers initialize.
  // This MUST run before the idempotency return below: another injection path
  // may already have installed the shim while this page still needs to consume
  // its own popup URL. Invalid/user-owned fragments are left untouched.
  `try{(function(){if(typeof window==='undefined'||typeof location==='undefined'||location.protocol!=='chrome-extension:')return;var h=location.hash||'';if(!h)return;var p=h.slice(1).split('&'),k='crxbridge=',i=-1,a=null;for(var n=0;n<p.length;n++){if(p[n].slice(0,k.length)!==k)continue;try{var v=JSON.parse(decodeURIComponent(p[n].slice(k.length)));if(Array.isArray(v)){i=n;a=v;break}}catch(_){}}if(i<0)return;var g=(typeof globalThis!=='undefined'&&globalThis)||window;try{g.__crxTabs=a}catch(_){}try{localStorage.setItem('__crxTabs_lsinjected',JSON.stringify(a));localStorage.setItem('__crxTabs_lsinjected_at',String(Date.now()))}catch(_){}p.splice(i,1);var r=p.length?'#'+p.join('&'):'';try{history.replaceState(history.state,'',location.pathname+location.search+r)}catch(_){}})()}catch(e){}` +
  // Top-level idempotency: this whole shim runs AT MOST ONCE per context
  // (globalThis). Two injection paths can land in the same context — the HTML
  // <head> inline script (injectHtmlHeadShim, runs first) AND the per-JS-file
  // prepend (still present because service workers and content scripts have no
  // HTML page). Whichever fires first sets __crxShimInstalled; the other(s)
  // return immediately. Per-section guards (__crxIpcRoute /
  // __crxDeclCsBridgeInstalled / ...) remain as defense-in-depth, but this
  // top-level check is the primary dedup and skips re-parsing the whole body on
  // every JS file load. Note: this retires the per-file "defensive re-install"
  // (a later JS file re-installing chrome.* an earlier file overwrote) —
  // acceptable because extensions capture references rather than overwrite, so
  // the first install persists (verified: the uBlock url-filter fix holds).
  `try{var ZG=(typeof globalThis!=='undefined'&&globalThis)||(typeof self!=='undefined'&&self)||this;if(ZG&&ZG.__crxShimInstalled){return}try{Object.defineProperty(ZG,'__crxShimInstalled',{value:1,configurable:true,writable:true})}catch(_){ZG.__crxShimInstalled=1}}catch(e){}` +
  // runtime.connect(extensionId?, connectInfo?) follows the same optional-ID
  // overload rule as sendMessage: an explicit undefined is omission, while
  // null and every other value must reach Chromium unchanged. Keep the native
  // Port and event machinery; only normalize its argument vector.
  `try{var ZC=ZG&&ZG.chrome,ZR=ZC&&ZC.runtime,ZO=ZR&&ZR.connect;if(typeof ZO==='function'&&!ZO.__crxUndefinedExtensionIdNormalized){var ZN=function(){var A=Array.prototype.slice.call(arguments);if(A.length&&A[0]===undefined)A.shift();return ZO.apply(ZR,A)};try{Object.defineProperty(ZN,'__crxUndefinedExtensionIdNormalized',{value:true,configurable:true});Object.defineProperty(ZR,'connect',{value:ZN,configurable:true,writable:true})}catch(_){try{ZR.connect=ZN}catch(_){}}}}catch(e){}` +
  // Chrome extension messages use JSON serialization, not the structured-clone
  // algorithm used by window.postMessage/Electron IPC. Normalize at every shim
  // message boundary so host objects (for example an HTMLInputElement) follow
  // Chrome's `{}` coercion instead of aborting delivery with DataCloneError.
  `var __crxAutoVerbose=false;try{__crxAutoVerbose=!!((typeof globalThis!=='undefined'&&globalThis.__CRX_VERBOSE)||(typeof process!=='undefined'&&process&&process.env&&process.env.CRX_VERBOSE==='1'))}catch(_){}var __crxWarn=function(){if(!__crxAutoVerbose)return;try{var c=typeof globalThis!=='undefined'&&globalThis.console;if(c&&typeof c['warn']==='function')c['warn'].apply(c,arguments)}catch(_){}},__crxJsonClone=function(v){var s=JSON.stringify(v);return s===undefined?undefined:JSON.parse(s)},__crxPostTop=function(w,m){var t=w;try{if(w&&w.top&&w.top!==w)t=w.top}catch(_){}try{t.postMessage(m,'*');return true}catch(_){return false}};` +
  // Preserve Chrome 148+/Electron's native browser namespace in extension
  // pages. In a service worker, Electron may expose a partial browser root;
  // align it with the hosted chrome APIs so WebExtension polyfills register
  // against the same event objects that the bridge dispatches.
  `try{var GB=(typeof globalThis!=='undefined'&&globalThis)||(typeof self!=='undefined'&&self)||this;` +
  `var GC=(typeof chrome!=='undefined'&&chrome)||(GB&&GB.chrome),GM=null,BR,GV=0;try{GM=GC&&GC.runtime&&typeof GC.runtime.getManifest==='function'?GC.runtime.getManifest():null}catch(e){}try{BR=GB&&GB.browser}catch(e){BR=undefined}try{var GVM=String(GB&&GB.navigator&&GB.navigator.userAgent||'').match(/(?:Chrome|Chromium)\\/(\\d+)/);GV=GVM?Number(GVM[1]):0}catch(e){}` +
  `if(GB&&GC&&GM&&GM.manifest_version===3&&!(GM.devtools_page&&GV>=148&&GV<152)&&!BR){try{GB.browser=GC}catch(e){}` +
  `try{if(!GB.browser)Object.defineProperty(GB,'browser',{value:GC,configurable:true,writable:true})}catch(e){}}}catch(e){}` +
  `try{var BSY=GB&&GB.browser;` +
  `if(BSY&&BSY!==GC&&BSY.runtime&&BSY.runtime.id&&GM&&GM.manifest_version===3&&typeof window==='undefined'){` +
  `var BES={onMessage:[],onConnect:[]},BSW=function(rt,k){try{var ev=rt&&rt[k];if(!ev||typeof ev.addListener!=='function'||ev.__crxHosted===true)return;var all=BES[k],i;for(i=0;i<all.length;i++)if(all[i].api===ev||all[i].delegate===ev)return;var st={delegate:ev,listeners:[]},api={addListener:function(fn){if(typeof fn==='function'&&st.listeners.indexOf(fn)<0){st.listeners.push(fn);try{var cap=k==='onMessage'?'__crxPortBrokerOnMsg':'__crxPortBrokerOnConnect',bag=ZG&&ZG[cap];if(Array.isArray(bag)&&bag.indexOf(fn)<0)bag.push(fn)}catch(_){}}try{return st.delegate.addListener(fn)}catch(_){}},removeListener:function(fn){var i=st.listeners.indexOf(fn);if(i>=0)st.listeners.splice(i,1);try{var cap=k==='onMessage'?'__crxPortBrokerOnMsg':'__crxPortBrokerOnConnect',bag=ZG&&ZG[cap],bi=Array.isArray(bag)?bag.indexOf(fn):-1;if(bi>=0)bag.splice(bi,1)}catch(_){}try{return st.delegate.removeListener(fn)}catch(_){}},hasListener:function(fn){if(st.listeners.indexOf(fn)>=0)return true;try{return !!st.delegate.hasListener(fn)}catch(_){return false}},hasListeners:function(){if(st.listeners.length)return true;try{return !!st.delegate.hasListeners()}catch(_){return false}}};st.api=api;all.push(st);try{Object.defineProperty(rt,k,{value:api,configurable:true,writable:true})}catch(_){try{rt[k]=api}catch(__){}}}catch(_){}};` +
  `var BEVM=function(k,ev){var all=BES[k]||[];for(var i=0;i<all.length;i++){var st=all[i],old=st.delegate;if(old===ev)continue;for(var j=0;j<st.listeners.length;j++)try{old.removeListener(st.listeners[j])}catch(_){}st.delegate=ev;for(var n=0;n<st.listeners.length;n++)try{ev.addListener(st.listeners[n])}catch(_){}}};` +
  `var BCP=function(dst,src){try{if(!dst||!src)return;var ns=Object.getOwnPropertyNames(src);for(var ni=0;ni<ns.length;ni++){var nk=ns[ni];if(nk==='caller'||nk==='callee'||nk==='arguments')continue;var nv;try{nv=src[nk]}catch(_){}var ov;try{ov=dst[nk]}catch(_){}if(ov===undefined&&nv!==undefined){try{Object.defineProperty(dst,nk,{value:nv,configurable:true,writable:true})}catch(_){try{dst[nk]=nv}catch(__){}}}}}catch(_){}};` +
  `var BSA=function(){try{var BSC=GC&&GC.runtime,BSR=BSY&&BSY.runtime;if(!BSC||!BSR)return;BCP(BSR,BSC);var ks=['sendMessage','connect'];for(var bi=0;bi<ks.length;bi++){var bk=ks[bi],bf=BSC[bk];if(typeof bf!=='function'||BSR[bk]===bf)continue;var cur=BSR[bk],alias;try{alias=cur.__crxChromeAlias}catch(_){}if(alias===bf)continue;var bound=(function(key){return function(){var fn;try{fn=BSC[key]}catch(_){}if(typeof fn!=='function')return Promise.resolve(undefined);try{return fn.apply(BSC,arguments)}catch(e){return Promise.reject(e)}}})(bk);try{Object.defineProperty(bound,'__crxChromeAlias',{value:bf,configurable:true})}catch(_){}try{Object.defineProperty(BSR,bk,{value:bound,configurable:true,writable:true})}catch(_){try{BSR[bk]=bound}catch(__){}}}var es=['onMessage','onConnect'];for(var ei=0;ei<es.length;ei++){var ek=es[ei],ev=BSC[ek];if(ev&&ev.__crxHosted===true){BEVM(ek,ev);if(BSR[ek]!==ev)try{Object.defineProperty(BSR,ek,{value:ev,configurable:true,writable:true})}catch(_){try{BSR[ek]=ev}catch(__){}}}else{BSW(BSC,ek);var hostedEv=BSC[ek];var browserEv=BSR[ek];if((!browserEv||typeof browserEv.addListener!=='function')&&hostedEv){try{Object.defineProperty(BSR,ek,{value:hostedEv,configurable:true,writable:true})}catch(_){try{BSR[ek]=hostedEv}catch(__){}}}if(BSR!==BSC)BSW(BSR,ek)}}var mods=['tabs','permissions','alarms','commands','contextMenus','cookies','bookmarks','history','downloads','notifications','topSites','idle','power','management','sessions','search','tabGroups','browsingData','webNavigation','action','browserAction','proxy','system','sidePanel','declarativeNetRequest','identity','userScripts'];for(var mi=0;mi<mods.length;mi++){var mn=mods[mi],cs=GC&&GC[mn],bs=BSY&&BSY[mn];if(cs&&bs)BCP(bs,cs);else if(cs&&bs===undefined){try{Object.defineProperty(BSY,mn,{value:cs,configurable:true,writable:true})}catch(_){try{BSY[mn]=cs}catch(__){}}}}}catch(_){}};` +
  // The hosted APIs may appear after this early shim, but scanning every
  // 100ms for eight seconds needlessly wakes a cold worker. Retry with a
  // bounded backoff over the same startup window instead.
  `BSA();if(typeof setTimeout==='function'){var BSI=0,BSRtry=function(){if(++BSI>7)return;setTimeout(function(){BSA();BSRtry()},Math.min(100*Math.pow(2,BSI-1),2400))};BSRtry()}}}catch(_){} ` +
  // Early permissions fallback for popup/options pages. crx-preload normally
  // installs this namespace by proxying browser/api/permissions.ts; if Electron
  // skips/delays the preload for a popup renderer, extension code can run first
  // and crash on chrome/browser.permissions.contains. Install only when the
  // namespace is absent, and prefer the same IPC route when the bridge exists.
  `try{var PG=(typeof globalThis!=='undefined'&&globalThis)||(typeof self!=='undefined'&&self)||this;var PC=(typeof chrome!=='undefined'&&chrome)||(PG&&PG.chrome);` +
  `if(PC&&PC.runtime&&PC.runtime.id&&!PC.permissions){var PID=PC.runtime.id,PM={};try{PM=PC.runtime.getManifest?PC.runtime.getManifest()||{}:{}}catch(_){PM={}}` +
  `var PA=function(v,cb){if(typeof cb==='function'){try{Promise.resolve(v).then(function(r){cb(r)},function(){cb(false)})}catch(_){cb(false)}return undefined}return Promise.resolve(v)};` +
  `var PI=function(name,arg){try{var e=PG.electron;if(e&&typeof e.invokeExtension==='function')return e.invokeExtension(PID,'permissions.'+name,{},arg);var ip=e&&e.ipcRenderer;if(ip&&typeof ip.invoke==='function')return ip.invoke('crx-msg',PID,'permissions.'+name,arg)}catch(_){}try{if(typeof PG.ipcInvoke==='function')return PG.ipcInvoke('crx-msg',PID,'permissions.'+name,arg)}catch(_){}return null};` +
  `var PP=function(){var p=Array.isArray(PM.permissions)?PM.permissions.slice():[],o=Array.isArray(PM.host_permissions)?PM.host_permissions.slice():[];return{permissions:p,origins:o}};` +
  `var PMatch=function(p,o){if(p==='<all_urls>'||p===o)return true;try{var u=new URL(o),pu=o.endsWith('/')?o+'*':o+'/*';if(p===pu||p===u.origin+'/*')return true;if(p.indexOf('*')<0)return false;var a=p.split('*'),pos=0;for(var i=0;i<a.length;i++){var s=a[i];if(!s)continue;var n=pu.indexOf(s,pos);if(n<0)return false;if(i===0&&n!==0)return false;pos=n+s.length}var last=a[a.length-1];return !last||pu.slice(-last.length)===last}catch(_){return false}};` +
  `var PContains=function(q){var cur=PP(),ps=q&&q.permissions,os=q&&q.origins;return(!ps||ps.every(function(x){return cur.permissions.indexOf(x)>=0}))&&(!os||os.every(function(x){return cur.origins.some(function(p){return PMatch(p,x)})}))};` +
  `PC.permissions={contains:function(q,cb){var p=PI('contains',q);return PA(p&&typeof p.then==='function'?p:PContains(q),cb)},getAll:function(cb){var p=PI('getAll');return PA(p&&typeof p.then==='function'?p:PP(),cb)},request:function(q,cb){var p=PI('request',q);return PA(p&&typeof p.then==='function'?p:false,cb)},remove:function(q,cb){var p=PI('remove',q);return PA(p&&typeof p.then==='function'?p:true,cb)},onAdded:{__crxNoop:true,addListener:function(){},removeListener:function(){},hasListener:function(){return false},hasListeners:function(){return false}},onRemoved:{__crxNoop:true,addListener:function(){},removeListener:function(){},hasListener:function(){return false},hasListeners:function(){return false}}};` +
  `try{if(PG.browser===PC&&!PG.browser.permissions)PG.browser.permissions=PC.permissions}catch(_){}}}catch(e){}` +
  // Declarative content-script receive bridge. Main process sends one
  // 'crx-cs-message' to the page preload; view-preload rebroadcasts it as a
  // window message so the isolated content-script world can fire runtime.onMessage.
  `try{var CG=(typeof globalThis!=='undefined'&&globalThis)||(typeof self!=='undefined'&&self)||this;var CC=(typeof chrome!=='undefined'&&chrome)||(CG&&CG.chrome);` +
  `var CP=(typeof location!=='undefined'&&location&&location.protocol)||'';var CW=(typeof window!=='undefined'&&window)||null;` +
  `try{if(CW&&CC&&CC.runtime&&CC.runtime.id&&CP!=='chrome-extension:'&&CP!=='devtools:'){console.warn('[crx-decl] probe ext='+CC.runtime.id+' url='+((location&&location.href)||'')+' bridge='+(!!CC.runtime.__crxBridge)+' installed='+(!!CG.__crxDeclCsBridgeInstalled)+' onMsg='+(!!CC.runtime.onMessage))}}catch(_){}` +
  `if(CW&&CC&&CC.runtime&&CC.runtime.id&&CC.runtime.onMessage&&!CC.runtime.__crxBridge&&CP!=='chrome-extension:'&&CP!=='devtools:'&&!CG.__crxDeclCsBridgeInstalled){` +
  `CG.__crxDeclCsBridgeInstalled=1;var CEID=CC.runtime.id,CE=CC.runtime.onMessage,CLS=[];` +
  `try{console.warn('[crx-decl] install ext='+CEID+' url='+((location&&location.href)||''))}catch(_){}` +
  `var CA=CE.addListener&&CE.addListener.bind?CE.addListener.bind(CE):CE.addListener;var CR=CE.removeListener&&CE.removeListener.bind?CE.removeListener.bind(CE):CE.removeListener;var CH=CE.hasListener&&CE.hasListener.bind?CE.hasListener.bind(CE):CE.hasListener;` +
  `if(typeof CA==='function'){CE.addListener=function(fn){try{if(typeof fn==='function'&&CLS.indexOf(fn)<0)CLS.push(fn)}catch(_){}` +
  `try{console.warn('[crx-decl] addListener ext='+CEID+' n='+CLS.length+' fn='+((fn&&fn.name)||''))}catch(_){}` +
  `try{return CA(fn)}catch(_){return undefined}}}` +
  `if(typeof CR==='function'){CE.removeListener=function(fn){try{var i=CLS.indexOf(fn);if(i>=0)CLS.splice(i,1)}catch(_){}` +
  `try{return CR(fn)}catch(_){return undefined}}}` +
  `CE.hasListener=function(fn){try{if(CLS.indexOf(fn)>=0)return true}catch(_){}try{return typeof CH==='function'?!!CH(fn):false}catch(_){return false}};` +
  `CW.addEventListener('message',function(ev){var d=ev&&ev.data;if(!d||!d.__crxCsFwd||!d.messageId)return;if(d.extensionId&&d.extensionId!==CEID)return;` +
  `var mb='';try{mb=d.message&&typeof d.message==='object'?(d.message.command||d.message.id||d.message.method||d.message.type||Object.keys(d.message).slice(0,6).join(',')):String(d.message)}catch(_){mb=typeof d.message}` +
  `try{console.warn('[crx-decl] recv id='+d.messageId+' ext='+CEID+' n='+CLS.length+' msg='+mb)}catch(_){}` +
  `var done=false,async=false;var respond=function(v){if(done)return;done=true;var rv=v;try{if(v!==undefined)rv=__crxJsonClone(v)}catch(_){rv=undefined}var rb;try{rb=(rv===undefined?'undefined':(rv===null?'null':(typeof rv==='object'?'object:'+Object.keys(rv).slice(0,6).join(','):typeof rv+':'+String(rv).slice(0,80))))}catch(_){rb=typeof rv}` +
  `try{console.warn('[crx-decl] respond id='+d.messageId+' response='+rb)}catch(_){}` +
  `try{__crxPostTop(CW,{__crxCsFwdResp:true,messageId:d.messageId,response:rv})}catch(_){}};` +
  `var reject=function(e){if(done)return;done=true;try{__crxPostTop(CW,{__crxCsFwdResp:true,messageId:d.messageId,error:String(e&&e.message||e||'An extension message listener rejected its Promise.')})}catch(_){}};` +
  `var arr;try{arr=CLS.slice()}catch(_){arr=[]}for(var i=0;i<arr.length;i++){var r;try{r=arr[i](d.message,d.sender||{id:CEID},respond)}catch(_){r=undefined}` +
  `if(r===true){async=true;continue}if(r&&typeof r.then==='function'){async=true;try{Promise.resolve(r).then(function(v){respond(v)},reject)}catch(e){reject(e)}}else if(r!==undefined&&r!==false&&!done){respond(r)}}` +
  `if(!async&&!done)respond(undefined);if(async){setTimeout(function(){respond(undefined)},30000)}},false);}}catch(_){}` +
  // Declarative content-script runtime.onConnect bridge. view-preload relays
  // main's crx-runtime.onConnect as __crxSwConnect into this isolated world;
  // synthesize a Chrome-like Port and route messages back through the preload.
  `try{var OG=(typeof globalThis!=='undefined'&&globalThis)||(typeof self!=='undefined'&&self)||this;var OC=(typeof chrome!=='undefined'&&chrome)||(OG&&OG.chrome);` +
  `var OP=(typeof location!=='undefined'&&location&&location.protocol)||'';var OW=(typeof window!=='undefined'&&window)||null;` +
  `if(OW&&OC&&OC.runtime&&OC.runtime.id&&OC.runtime.onConnect&&!OC.runtime.__crxBridge&&OP!=='chrome-extension:'&&OP!=='devtools:'&&!OG.__crxDeclPortBridgeInstalled){` +
  `OG.__crxDeclPortBridgeInstalled=1;var OEID=OC.runtime.id,OE=OC.runtime.onConnect,OLS=[];` +
  `try{console.warn('[crx-decl-port] install ext='+OEID+' url='+((location&&location.href)||''))}catch(_){}` +
  `var OA=OE.addListener&&OE.addListener.bind?OE.addListener.bind(OE):OE.addListener;var OR=OE.removeListener&&OE.removeListener.bind?OE.removeListener.bind(OE):OE.removeListener;var OH=OE.hasListener&&OE.hasListener.bind?OE.hasListener.bind(OE):OE.hasListener;` +
  `if(typeof OA==='function'){OE.addListener=function(fn){try{if(typeof fn==='function'&&OLS.indexOf(fn)<0)OLS.push(fn)}catch(_){}` +
  `try{console.warn('[crx-decl-port] addListener ext='+OEID+' n='+OLS.length+' fn='+((fn&&fn.name)||''))}catch(_){}` +
  `try{return OA(fn)}catch(_){return undefined}}}` +
  `if(typeof OR==='function'){OE.removeListener=function(fn){try{var i=OLS.indexOf(fn);if(i>=0)OLS.splice(i,1)}catch(_){}` +
  `try{return OR(fn)}catch(_){return undefined}}}` +
  `OE.hasListener=function(fn){try{if(OLS.indexOf(fn)>=0)return true}catch(_){}try{return typeof OH==='function'?!!OH(fn):false}catch(_){return false}};` +
  `var OS;try{OS=OG.__crxDeclPortState||(OG.__crxDeclPortState={ports:{},pending:{},done:{},seq:0})}catch(_){OS={ports:{},pending:{},done:{},seq:0}}var OPorts=OS.ports||(OS.ports={}),OPending=OS.pending||(OS.pending={}),ODone=OS.done||(OS.done={}),OIID=++OS.seq;try{console.warn('[crx-transfer] port state inst='+OIID+' ports='+Object.keys(OPorts).length)}catch(_){}var OEmit=function(a,arg,p){var cp=[];try{cp=a.slice()}catch(_){}for(var i=0;i<cp.length;i++){try{cp[i](arg,p)}catch(_){}}};` +
  `var OFinish=function(m){try{var tr=m&&m.transfer;if(!tr||tr.type!=='response'||!tr.id)return;var k=String(tr.id),q=OPending[k];try{console.warn('[crx-transfer] port response id='+tr.id+' hasWait='+(!!q)+' dataKeys='+(tr.data&&typeof tr.data==='object'?Object.keys(tr.data).slice(0,8).join(','):'')+' imageLen='+(tr.data&&typeof tr.data.imageDataUrl==='string'?tr.data.imageDataUrl.length:''))}catch(_){}if(!q){ODone[k]=tr.data;setTimeout(function(){try{delete ODone[k]}catch(_){}},30000);return}delete OPending[k];clearTimeout(q.t);setTimeout(function(){try{console.warn('[crx-transfer] resolve wait id='+tr.id)}catch(_){}try{q.r(tr.data)}catch(_){}},0)}catch(_){}};` +
  `var OWrapSend=function(rt,label){try{if(!rt||typeof rt.sendMessage!=='function'||rt.sendMessage.__crxTransferWait)return;var OSM=rt.sendMessage.bind(rt);rt.sendMessage=function(){var a=[],i;for(i=0;i<arguments.length;i++)a.push(arguments[i]);var cb=typeof a[a.length-1]==='function'?a.pop():undefined,msg=a.length>1&&typeof a[0]==='string'?a[1]:a[0],tr=msg&&msg.transfer,wid=tr&&(tr.id||tr.transferId),wait=tr&&tr.transferResponse&&wid,p;try{if(tr)console.warn('[crx-transfer] sendMessage seen label='+label+' id='+(tr.id||'')+' transferId='+(tr.transferId||'')+' wait='+(!!wait)+' cb='+(!!cb)+' msgKeys='+(msg&&typeof msg==='object'?Object.keys(msg).slice(0,8).join(','):''))}catch(_){}try{p=OSM.apply(null,cb&&!wait?a.concat([cb]):a)}catch(e){try{console.warn('[crx-transfer] native send throw id='+(tr&&tr.id)+' err='+(e&&e.message))}catch(_){}if(cb)try{cb(undefined)}catch(_){};return cb?undefined:Promise.reject(e)}if(!wait){if(cb)return undefined;return p}var wp=new Promise(function(resolve){var k=String(wid),old=OPending[k];if(old){clearTimeout(old.t);delete OPending[k]}if(Object.prototype.hasOwnProperty.call(ODone,k)){var done=ODone[k];delete ODone[k];try{console.warn('[crx-transfer] use cached response id='+k)}catch(_){}resolve(done);return}OPending[k]={r:resolve,t:setTimeout(function(){try{console.warn('[crx-transfer] wait timeout id='+k)}catch(_){}delete OPending[k];resolve(undefined)},30000)}});var out=Promise.resolve(p).then(function(v){try{console.warn('[crx-transfer] native result id='+wid+' type='+(v===undefined?'undefined':v===null?'null':typeof v)+' keys='+(v&&typeof v==='object'?Object.keys(v).slice(0,8).join(','):''))}catch(_){}return v},function(e){try{console.warn('[crx-transfer] native reject id='+wid+' err='+(e&&e.message))}catch(_){}return undefined}).then(function(v){return v===undefined||v===null?wp:v});if(cb){out.then(function(v){try{console.warn('[crx-transfer] callback result id='+wid+' type='+(v===undefined?'undefined':v===null?'null':typeof v)+' keys='+(v&&typeof v==='object'?Object.keys(v).slice(0,8).join(','):''))}catch(_){}try{cb(v)}catch(_){}});return undefined}return out};try{Object.defineProperty(rt.sendMessage,'__crxTransferWait',{value:true,configurable:true})}catch(_){}try{console.warn('[crx-transfer] wrap sendMessage label='+label)}catch(_){}}catch(_){}};var OWrapAll=function(){try{OWrapSend(OC.runtime,'chrome');if(OG.browser&&OG.browser.runtime)OWrapSend(OG.browser.runtime,'browser')}catch(_){}};try{OWrapAll();var OWrapTries=0,OWrapTimer=setInterval(function(){OWrapAll();if(++OWrapTries>120)clearInterval(OWrapTimer)},250)}catch(_){}` +
  `var OMakePort=function(id,name,sender){var old=OPorts[id];try{if(old&&old.cancel)old.cancel('replace')}catch(_){}var ml=[],dl=[],closed=false,cleanup=0,disconnectTimer=0,drop=function(reason){if(cleanup)return;try{if(__crxAutoVerbose)console.warn('[crx-transfer] port schedule cleanup inst='+OIID+' port='+id+' name='+name+' reason='+reason+' listeners='+ml.length)}catch(_){}cleanup=setTimeout(function(){try{if(__crxAutoVerbose)console.warn('[crx-transfer] port cleanup inst='+OIID+' port='+id+' name='+name)}catch(_){}if(OPorts[id]&&OPorts[id].port===p)delete OPorts[id]},30000)},sendDisconnect=function(reason,delay){if(disconnectTimer)return;try{if(__crxAutoVerbose)console.warn('[crx-transfer] port schedule main disconnect inst='+OIID+' port='+id+' reason='+reason+' delay='+delay)}catch(_){}disconnectTimer=setTimeout(function(){try{if(__crxAutoVerbose)console.warn('[crx-transfer] port main disconnect inst='+OIID+' port='+id+' reason='+reason)}catch(_){}try{__crxPostTop(OW,{__crxSwPortDisconnectBack:true,portId:id})}catch(_){}},delay||0)},p={name:name||'',sender:sender||{id:OEID},onMessage:{addListener:function(f){if(typeof f==='function'&&ml.indexOf(f)<0)ml.push(f);try{if(__crxAutoVerbose)console.warn('[crx-transfer] port addListener inst='+OIID+' port='+id+' name='+name+' n='+ml.length)}catch(_){}} ,removeListener:function(f){var i=ml.indexOf(f);if(i>=0)ml.splice(i,1)},hasListener:function(f){return ml.indexOf(f)>=0}},onDisconnect:{addListener:function(f){if(typeof f==='function'&&dl.indexOf(f)<0)dl.push(f)},removeListener:function(f){var i=dl.indexOf(f);if(i>=0)dl.splice(i,1)},hasListener:function(f){return dl.indexOf(f)>=0}},postMessage:function(m){try{if(__crxAutoVerbose)console.warn('[crx-transfer] port postMessage back inst='+OIID+' port='+id+' name='+name+' closed='+closed+' msg='+(m&&m.id||m&&m.transfer&&m.transfer.type||typeof m))}catch(_){}try{__crxPostTop(OW,{__crxSwPortPostBack:true,portId:id,message:m})}catch(_){}} ,disconnect:function(){if(closed)return;closed=true;try{if(__crxAutoVerbose)console.warn('[crx-transfer] port disconnect local inst='+OIID+' port='+id+' name='+name)}catch(_){}OEmit(dl,p,p);sendDisconnect('local-disconnect',30000);drop('local-disconnect')}};OPorts[id]={port:p,msg:ml,dis:dl,cancel:function(reason){if(cleanup){try{clearTimeout(cleanup)}catch(_){}cleanup=0}if(disconnectTimer){try{clearTimeout(disconnectTimer)}catch(_){}disconnectTimer=0}try{if(__crxAutoVerbose)console.warn('[crx-transfer] port cancel cleanup inst='+OIID+' port='+id+' reason='+reason)}catch(_){}},close:function(){if(closed)return;closed=true;if(disconnectTimer){try{clearTimeout(disconnectTimer)}catch(_){}disconnectTimer=0}try{if(__crxAutoVerbose)console.warn('[crx-transfer] port remote close inst='+OIID+' port='+id+' name='+name)}catch(_){}OEmit(dl,p,p);drop('remote-close')}};return p};` +
  `OW.addEventListener('message',function(ev){var d=ev&&ev.data;if(!d)return;if(d.__crxSwConnect&&d.portId){if(d.sender&&d.sender.id&&d.sender.id!==OEID)return;var p=OMakePort(d.portId,d.name,d.sender);try{console.warn('[crx-decl-port] recv connect ext='+OEID+' port='+d.portId+' name='+(d.name||'')+' n='+OLS.length)}catch(_){}var arr;try{arr=OLS.slice()}catch(_){arr=[]}for(var i=0;i<arr.length;i++){try{arr[i](p)}catch(_){}}return}` +
  `if(d.__crxSwPortPost&&d.portId){var e=OPorts[d.portId];try{if(__crxAutoVerbose)console.warn('[crx-transfer] port recv inst='+OIID+' port='+d.portId+' found='+(!!e)+' listeners='+(e&&e.msg&&e.msg.length)+' ports='+Object.keys(OPorts).join(',').slice(0,120)+' msg='+(d.message&&d.message.transfer&&d.message.transfer.type||d.message&&d.message.id||typeof d.message))}catch(_){}if(e){OEmit(e.msg,d.message,e.port);OFinish(d.message)}return}` +
  `if(d.__crxSwPortDisconnect&&d.portId){var x=OPorts[d.portId];if(x)x.close();return}},false);}}catch(_){}` +
  // Content->background send bridge for declarative content scripts (isolated
  // world). crx-preload runs only in service-worker / chrome-extension:// contexts,
  // so a declarative content script (manifest content_scripts) — which Electron
  // injects natively into an ISOLATED world — only has Electron's native
  // chrome.runtime. Native content->SW delivery is unreliable here (messages
  // dropped, Promise/async responses lost), so runtime.sendMessage resolves
  // undefined and callers reading the response throw (BewlyBewly routes every
  // API call through runtime.sendMessage({contentScriptQuery}) and reads
  // result.data). The receive bridge above already relays SW->content over
  // window.postMessage; this block completes the symmetric send direction.
  //
  // window.postMessage is shared between the content-script isolated world and
  // the main-world preload, which already relays __crxCsSend -> 'crx-runtime-
  // message' and __crxCSConnect -> 'crx-port-connect' (messaging.ts) — the SAME
  // vendor handlers content-bridge.ts calls directly for dynamically-registered
  // scripts. We mirror that surface (sendMessage, connect, Port, chrome.extension)
  // so declarative content scripts get the standard Chrome runtime messaging API.
  // Generic: gated identically to the receive bridge (only when __crxBridge is
  // absent and we are on a web page), not scoped to any extension.
  `try{var XG=(typeof globalThis!=='undefined'&&globalThis)||(typeof self!=='undefined'&&self)||this;var XC=(typeof chrome!=='undefined'&&chrome)||(XG&&XG.chrome);var XP=(typeof location!=='undefined'&&location&&location.protocol)||'';var XW=(typeof window!=='undefined'&&window)||null;` +
  `if(XW&&XC&&XC.runtime&&XC.runtime.id&&!XC.runtime.__crxBridge&&XP!=='chrome-extension:'&&XP!=='devtools:'&&!XG.__crxCsSendBridgeInstalled){` +
  `XG.__crxCsSendBridgeInstalled=1;var XEID=XC.runtime.id,XSeq=0,XPending={},XPorts={};` +
  `try{console.warn('[crx-decl-send] install ext='+XEID+' tabsTy='+(typeof XC.tabs)+' extTy='+(typeof XC.extension))}catch(_){}` +
  // sendMessage -> __crxCsSend -> view-preload -> crx-runtime-message -> SW onMessage
  `var XSend=function(){var A=[],i;for(i=0;i<arguments.length;i++)A.push(arguments[i]);var cb=typeof A[A.length-1]==='function'?A.pop():undefined;var msg=(typeof A[0]==='string'&&A.length>=2)?A[1]:A[0],wire;` +
  `try{wire=__crxJsonClone(msg)}catch(e){var bad=Promise.reject(e);if(cb){bad.catch(function(){try{cb(undefined)}catch(_){}});return undefined}return bad}` +
  `var mid='cssend-'+(++XSeq);try{if(__crxAutoVerbose&&msg&&typeof msg==='object'&&msg.command)console.warn('[crx-autofill] cs.send mid='+mid+' command='+msg.command+' keys='+Object.keys(msg).slice(0,10).join(','))}catch(_){}var p=new Promise(function(resolve,reject){XPending[mid]={r:resolve,j:reject};` +
  `try{if(!__crxPostTop(XW,{__crxCsSend:true,mid:mid,extId:XEID,message:wire}))throw new Error('postMessage failed')}catch(e){try{console.warn('[crx-decl-send] post FAIL mid='+mid+' err='+(e&&e.message))}catch(_){}try{delete XPending[mid]}catch(_){}resolve(undefined)}` +
  `try{setTimeout(function(){var q=XPending[mid];if(q){try{delete XPending[mid]}catch(_){}q.r(undefined)}},30000)}catch(_){}});` +
  `if(cb){p.then(function(v){try{cb(v)}catch(_){}},function(e){try{Object.defineProperty(XC.runtime,'lastError',{value:{message:String(e&&e.message||e)},configurable:true})}catch(_){}try{cb(undefined)}catch(_){}Promise.resolve().then(function(){try{delete XC.runtime.lastError}catch(_){}})});return undefined}return p};` +
  `var XApply=function(rt,prop,fn){var ok=false;try{rt[prop]=fn;ok=(rt[prop]===fn)}catch(_){ok=false}if(!ok){try{Object.defineProperty(rt,prop,{value:fn,configurable:true,writable:true});ok=(rt[prop]===fn)}catch(_){}}try{console.warn('[crx-decl-send] apply '+prop+' ok='+ok+' finalTy='+(typeof rt[prop]))}catch(_){}return ok};` +
  `var XMsgOk=XApply(XC.runtime,'sendMessage',XSend);` +
  // connect -> __crxCSConnect -> view-preload -> crx-port-connect -> SW onConnect (synth Port)
  `var XMakePort=function(connId,name){var mls=[],dls=[],closed=false;var emitD=function(){var cp=dls.slice();for(var i=0;i<cp.length;i++){try{cp[i](port)}catch(_){}}};` +
  `var port={name:name||'',sender:{id:XEID},` +
  `onMessage:{addListener:function(f){if(typeof f==='function'&&mls.indexOf(f)<0)mls.push(f)},removeListener:function(f){var i=mls.indexOf(f);if(i>=0)mls.splice(i,1)},hasListener:function(f){return mls.indexOf(f)>=0}},` +
  `onDisconnect:{addListener:function(f){if(typeof f==='function'&&dls.indexOf(f)<0)dls.push(f)},removeListener:function(f){var i=dls.indexOf(f);if(i>=0)dls.splice(i,1)},hasListener:function(f){return dls.indexOf(f)>=0}},` +
  `postMessage:function(m){if(closed)throw new Error('Attempting to use a disconnected port object');var wire=__crxJsonClone(m);__crxPostTop(XW,{__crxCSPortOut:true,connId:connId,message:wire})},` +
  `disconnect:function(){if(closed)return;closed=true;try{__crxPostTop(XW,{__crxCSPortDisOut:true,connId:connId})}catch(_){}emitD()}};` +
  `XPorts[connId]={fire:function(m){if(closed)return;var cp=mls.slice();for(var i=0;i<cp.length;i++){try{cp[i](m,port)}catch(_){}}},close:function(err){if(closed)return;closed=true;if(err){try{Object.defineProperty(XC.runtime,'lastError',{value:{message:String(err)},configurable:true})}catch(_){}}try{emitD()}finally{if(err){try{delete XC.runtime.lastError}catch(_){}}}}};return port};` +
  `var XConnect=function(){var A=[],i;for(i=0;i<arguments.length;i++)A.push(arguments[i]);var info=null;for(i=0;i<A.length;i++){if(A[i]&&typeof A[i]==='object')info=A[i]}var name=(info&&info.name)||'';var connId='csconn-'+(++XSeq);var port=XMakePort(connId,name);try{console.warn('[crx-decl-send] connect ext='+XEID+' connId='+connId+' name='+name)}catch(_){}try{__crxPostTop(XW,{__crxCSConnect:true,connId:connId,extId:XEID,name:name})}catch(e){try{console.warn('[crx-decl-send] connect post FAIL connId='+connId+' err='+(e&&e.message))}catch(_){}}return port};` +
  `var XConnOk=XApply(XC.runtime,'connect',XConnect);` +
  // single inbound dispatcher: sendMessage responses + port messages/disconnect
  `XW.addEventListener('message',function(ev){var d=ev&&ev.data;if(!d)return;` +
  `if(d.__crxCsSendResp){var q=XPending[d.mid];if(q){try{delete XPending[d.mid]}catch(_){}if(d.error!==undefined)q.j(new Error(String(d.error)));else q.r(d.response)}return}` +
  `if(d.__crxCSPortIn&&d.connId){var pe=XPorts[d.connId];if(pe)pe.fire(d.message);return}` +
  `if(d.__crxCSPortDisIn&&d.connId){var pe=XPorts[d.connId];if(pe){try{delete XPorts[d.connId]}catch(_){}pe.close(d.error)}return}},false);` +
  // chrome.extension legacy surface — real Chrome content scripts have it, and
  // content-bridge.ts provides it for dynamic scripts; mirror here (getURL,
  // sendMessage/connect alias runtime, onMessage/onConnect share runtime's).
  `try{if(!XC.extension){XC.extension={inIncognitoContext:false,` +
  `getURL:function(p){if(XC.runtime&&typeof XC.runtime.getURL==='function'){try{return XC.runtime.getURL(p)}catch(_){}}var s=String(p||'');while(s.charAt(0)==='/')s=s.slice(1);return 'chrome-extension://'+XEID+'/'+s},` +
  `getBackgroundPage:function(){return null},getExtensionTabs:function(){return[]},` +
  `sendMessage:function(){return XSend.apply(null,arguments)},connect:function(){return XConnect.apply(null,arguments)},` +
  `onMessage:XC.runtime&&XC.runtime.onMessage,onConnect:XC.runtime&&XC.runtime.onConnect}}` +
  `else{if(!XC.extension.getURL&&XC.runtime&&XC.runtime.getURL)XC.extension.getURL=XC.runtime.getURL;if(typeof XC.extension.sendMessage!=='function')XC.extension.sendMessage=function(){return XSend.apply(null,arguments)};if(typeof XC.extension.connect!=='function')XC.extension.connect=function(){return XConnect.apply(null,arguments)}}}catch(_){}` +
  `}}catch(_){}` +
  // Popup/options fallback for tabs.sendMessage. Prefer the same IPC router as
  // crx-preload; if the popup preload was skipped, ask the background worker to
  // relay over runtime.sendMessage. The background listener is installed by this
  // same shim in worker contexts and never uses the relay path recursively.
  `try{var TG=(typeof globalThis!=='undefined'&&globalThis)||(typeof self!=='undefined'&&self)||this;var TC=(typeof chrome!=='undefined'&&chrome)||(TG&&TG.chrome);` +
  `var TP=(typeof location!=='undefined'&&location&&location.protocol)||'';if(TC&&TC.runtime&&(TP==='chrome-extension:'||typeof document==='undefined')){` +
  `var TID=function(){try{return(TC&&TC.runtime&&TC.runtime.id)||null}catch(_){return null}};var TTabs=function(){try{if(!TC.tabs)TC.tabs={};return TC.tabs}catch(_){return null}};var TWin=function(){try{if(!TC.windows)TC.windows={};return TC.windows}catch(_){return null}};var TReplace=function(ns){try{var old=TC[ns],next=Object.create(old||null);try{Object.defineProperty(TC,ns,{value:next,configurable:true,enumerable:true,writable:true})}catch(_){try{TC[ns]=next}catch(__){}}return TC[ns]===next?next:null}catch(_){return null}};` +
  `var TList=function(){var HP=false;try{HP=typeof window!=='undefined'&&window.parent&&window.parent!==window}catch(_){HP=false}var read=function(w){var a=null;if(!w)return null;try{var h=(w.location&&w.location.hash)||'',m=h.match(/[?#&]crxbridge=([^&]+)/);a=m?JSON.parse(decodeURIComponent(m[1])):null}catch(_){a=null}if(Array.isArray(a))return a;try{a=w.__crxTabs}catch(_){}if(Array.isArray(a))return a;if(HP){try{var s=w.localStorage;a=s?JSON.parse(s.getItem('__crxTabs_lsinjected')||'[]'):null}catch(_){a=null}if(Array.isArray(a))return a}return null};var ws=[TG],w;try{if(typeof window!=='undefined'){if(window.parent&&window.parent!==window)ws.push(window.parent);if(window.top&&ws.indexOf(window.top)<0)ws.push(window.top)}}catch(_){}for(var i=0;i<ws.length;i++){w=read(ws[i]);if(Array.isArray(w))return w}return[]};` +
  `var TQuery=function(q){q=q||{};var a=TList(),out=[],is=function(v){return typeof v!=='undefined'};var gm=function(pat,val){if(pat==='<all_urls>')return true;if(typeof pat!=='string')return false;var re='^'+pat.split('*').map(function(s){return s.replace(/[\\\\^$+?.()|[\\]{}]/g,'\\\\$&')}).join('.*')+'$';try{return new RegExp(re).test(val||'')}catch(_){return false}};var ma=function(iv,val){var ps=Array.isArray(iv)?iv:[iv];var v=typeof val==='string'?val.split('#')[0]:'';for(var i=0;i<ps.length;i++){if(gm(ps[i],v))return true}return false};for(var i=0;i<a.length;i++){var t=a[i];if(!t||typeof t.id!=='number')continue;var gid=typeof t.groupId==='number'?t.groupId:-1;if(is(q.active)&&!!q.active!==!!t.active)continue;if(is(q.pinned)&&!!q.pinned!==!!t.pinned)continue;if(is(q.highlighted)&&!!q.highlighted!==!!t.highlighted)continue;if(is(q.discarded)&&!!q.discarded!==!!t.discarded)continue;if(is(q.muted)&&!!q.muted!==!!(t.mutedInfo&&t.mutedInfo.muted))continue;if(is(q.status)&&q.status!==t.status)continue;if(is(q.windowId)&&q.windowId>=0&&q.windowId!==t.windowId)continue;if(is(q.groupId)&&q.groupId!==gid)continue;if(is(q.url)&&!ma(q.url,t.url))continue;if(is(q.title)&&!ma(q.title,t.title))continue;var c={};for(var k in t)c[k]=t[k];c.groupId=gid;c.index=out.length;out.push(c)}return out};` +
  `var TCurTab=function(){var a=TList();for(var i=0;i<a.length;i++){if(a[i]&&(a[i].active||a[i].selected||a[i].highlighted)&&typeof a[i].id==='number')return a[i]}for(var j=0;j<a.length;j++){if(a[j]&&typeof a[j].id==='number')return a[j]}return undefined};` +
  `var TCur=function(){var t=TCurTab();return t&&typeof t.id==='number'?t.id:undefined};` +
  `var TNorm=function(id){if(typeof id!=='number')return TCur();var a=TList();if(!a.length)return id;for(var i=0;i<a.length;i++){if(a[i]&&a[i].id===id)return id}var c=TCur();try{if(typeof c==='number')console.warn('[crx-shim] normalize stale popup tabId '+id+' -> '+c)}catch(_){}return typeof c==='number'?c:id};` +
  `var TIPC0=function(name){var args=[],i,id=TID();for(i=1;i<arguments.length;i++)args.push(arguments[i]);try{var e=TG.electron;if(e&&typeof e.invokeExtensionRaw==='function')return e.invokeExtensionRaw.apply(e,[id,'tabs.'+name,{}].concat(args));if(e&&typeof e.invokeExtension==='function')return e.invokeExtension.apply(e,[id,'tabs.'+name,{}].concat(args));` +
  `var ip=e&&e.ipcRenderer;if(ip&&typeof ip.invoke==='function')return ip.invoke.apply(ip,['crx-msg',id,'tabs.'+name].concat(args))}catch(_){}try{if(typeof TG.ipcInvoke==='function')return TG.ipcInvoke.apply(TG,['crx-msg',id,'tabs.'+name].concat(args))}catch(_){}try{if(TC.runtime&&typeof TC.runtime.sendMessage==='function'){var q=TC.runtime.sendMessage({__crxApiRequest:true,method:'tabs.'+name,args:args});return Promise.resolve(q).then(function(v){if(v&&v.__crxApiResponse){if(v.ok)return v.value;throw new Error(v.error||('Extension API failed: tabs.'+name))}return v})}}catch(_){}return null};` +
  `var TIPC=function(){var p=TIPC0.apply(null,arguments);return p&&typeof p.then==='function'?p.then(function(v){if(v&&typeof v==='object'&&typeof v.__crxApiError==='string')throw new Error(v.__crxApiError);return v}):p};` +
  `var TSend=function(tabId,msg,opt,relay){tabId=TNorm(tabId);var wire;try{wire=__crxJsonClone(msg)}catch(e){return Promise.reject(e)}var p=TIPC('sendMessage',tabId,wire,opt);if(p&&typeof p.then==='function')return p;if(p!==null)return Promise.resolve(p);` +
  `if(relay&&TC.runtime&&typeof TC.runtime.sendMessage==='function'){return new Promise(function(resolve){var dn=false,fin=function(v){if(dn)return;dn=true;resolve(v)};try{var rq={__crxTabsSendMessage:true,tabId:tabId,message:wire,options:opt};var rp=TC.runtime.sendMessage(rq,function(v){fin(v)});if(rp&&typeof rp.then==='function')rp.then(fin,function(){fin(undefined)})}catch(_){fin(undefined)}try{setTimeout(function(){fin(undefined)},5500)}catch(_){}})}` +
  `var TT=TTabs(),TN=TT&&typeof TT.sendMessage==='function'?TT.sendMessage.bind(TT):null;` +
  `if(TN){try{var r=TN(tabId,wire,opt);return r&&typeof r.then==='function'?r.catch(function(){return undefined}):Promise.resolve(r)}catch(_){}}return Promise.resolve(undefined)};` +
  `var TInstall=function(){var TT=TTabs();if(!TT)return false;` +
  `if(!TT.getCurrent||!TT.getCurrent.__crxIpcRoute){TT.getCurrent=function(cb){var p=TIPC('getCurrent');if(!p||typeof p.then!=='function')p=Promise.resolve(p===null?undefined:p);p=Promise.resolve(p).catch(function(){return undefined});if(typeof cb==='function'){p.then(function(v){try{cb(v)}catch(_){}});return undefined}return p};try{Object.defineProperty(TT.getCurrent,'__crxIpcRoute',{value:true,configurable:true})}catch(_){}}` +
  `if(!TT.query||!TT.query.__crxIpcRoute){TT.query=function(q,cb){q=q||{};var live=typeof q==='object'&&(typeof q.url!=='undefined'||typeof q.title!=='undefined');var fb=function(){return live?[]:TQuery(q)};var p=TIPC('query',q);if(!p||typeof p.then!=='function')p=Promise.resolve(fb());else p=p.then(function(v){return Array.isArray(v)&&v.length?v:fb()}).catch(function(){return fb()});if(typeof cb==='function'){p.then(function(v){try{cb(v)}catch(_){}});return undefined}return p};try{Object.defineProperty(TT.query,'__crxIpcRoute',{value:true,configurable:true})}catch(_){}}` +
  `if(!TT.connect||!TT.connect.__crxIpcRoute){TT.connect=function(a,b){var has=typeof a==='number',tabId=TNorm(has?a:undefined),ci=has?b:a,nm=(ci&&ci.name)||(typeof ci==='string'?ci:''),fid=ci&&typeof ci.frameId==='number'?ci.frameId:undefined,ls=[],ds=[],buf=[],closed=false,bound=false,cid='shimtab-'+Date.now()+'-'+Math.random(),hasParent=false;try{hasParent=typeof window!=='undefined'&&window.parent&&window.parent!==window}catch(_){hasParent=false}var emit=function(arr,arg){var cp=arr.slice();for(var i=0;i<cp.length;i++){try{cp[i](arg,port)}catch(_){}}},post=function(m){if(closed)return;if(hasParent){if(bound){try{window.parent.postMessage({__crxTabsPortOut:true,connId:cid,message:m},'*')}catch(_){}}else buf.push(m)}else if(!bound){buf.push(m)}},disc=function(){if(closed)return;closed=true;if(hasParent){try{window.parent.postMessage({__crxTabsPortDisOut:true,connId:cid},'*')}catch(_){}}emit(ds,port)},bindReal=function(send,close){bound=true;post=function(m){if(closed)return;try{send(m)}catch(_){}};disc=function(){if(closed)return;closed=true;try{close&&close()}catch(_){}emit(ds,port)};var q=buf.splice(0);for(var i=0;i<q.length;i++)post(q[i])},port={name:nm,onMessage:{addListener:function(f){if(typeof f==='function'&&ls.indexOf(f)<0)ls.push(f)},removeListener:function(f){var i=ls.indexOf(f);if(i>=0)ls.splice(i,1)},hasListener:function(f){return ls.indexOf(f)>=0}},onDisconnect:{addListener:function(f){if(typeof f==='function'&&ds.indexOf(f)<0)ds.push(f)},removeListener:function(f){var i=ds.indexOf(f);if(i>=0)ds.splice(i,1)},hasListener:function(f){return ds.indexOf(f)>=0}},postMessage:function(m){return post(m)},disconnect:function(){return disc()}};try{console.warn('[crx-shim] tabs.connect ext='+TID()+' tab='+(tabId===undefined?'current':tabId)+' name='+nm+' frameId='+(fid===undefined?'':fid)+' iframe='+hasParent)}catch(_){}if(hasParent){try{var on=function(ev){var d=ev&&ev.data;if(!d||d.connId!==cid)return;if(d.__crxTabsPortIn){bound=true;emit(ls,d.message)}else if(d.__crxTabsPortDisIn){try{window.removeEventListener('message',on,false)}catch(_){}disc()}};window.addEventListener('message',on,false);window.parent.postMessage({__crxTabsConnect:true,connId:cid,extId:TID(),tabId:tabId,info:{name:nm,frameId:fid}},'*');setTimeout(function(){bound=true;var q=buf.splice(0);for(var i=0;i<q.length;i++)post(q[i])},0);return port}catch(_){}}try{var ee=TG.electron;if(ee&&typeof ee.tabsPortConnect==='function'){ee.tabsPortConnect(TID(),tabId,{name:nm,frameId:fid},function(m){emit(ls,m)},function(){disc()},function(send,close){bindReal(send,close)});return port}}catch(_){}try{var p=TIPC('connect',tabId,{name:nm,frameId:fid});if(p&&typeof p.then==='function'){p.then(function(pid){if(!pid){disc();return}try{var e=TG.electron;if(e&&typeof e.portAccept==='function'){e.portAccept(pid,function(m){emit(ls,m)},function(){disc()},function(send,close){bindReal(send,close)});return}}catch(_){}bound=true},function(){disc()});return port}}catch(_){}setTimeout(function(){disc()},0);return port};try{Object.defineProperty(TT.connect,'__crxIpcRoute',{value:true,configurable:true})}catch(_){}}` +
  `if(!TT.sendMessage||!TT.sendMessage.__crxIpcRoute){TT.sendMessage=function(){var A=[],i;for(i=0;i<arguments.length;i++)A.push(arguments[i]);var cb=typeof A[A.length-1]==='function'?A.pop():undefined;var has=typeof A[0]==='number';var tabId=has?A[0]:TCur();var msg=has?A[1]:A[0];var opt=has?(typeof A[2]==='object'?A[2]:undefined):(typeof A[1]==='object'?A[1]:undefined);` +
  `var p=TSend(tabId,msg,opt,true);if(cb){p.then(function(v){try{cb(v)}catch(_){}},function(err){var rt=TC.runtime,old;try{old=Object.getOwnPropertyDescriptor(rt,'lastError');Object.defineProperty(rt,'lastError',{value:{message:String((err&&err.message)||err||'Unknown error')},configurable:true})}catch(_){}try{cb(undefined)}catch(_){}try{if(old)Object.defineProperty(rt,'lastError',old);else delete rt.lastError}catch(_){}});return undefined}return p};` +
  `try{Object.defineProperty(TT.sendMessage,'__crxIpcRoute',{value:true,configurable:true})}catch(_){}}` +
  // tabs.create must return the real main-process Tab. A degraded popup may
  // have no crx-preload, but it can still reach the SW through the crxreq API
  // proxy above. Never call window.open or return a fabricated id: both violate
  // Chrome's tabs.create contract and steal focus from the popup.
  `if(!TT.create||!TT.create.__crxIpcRoute){var TCreate=function(){var A=[],i;for(i=0;i<arguments.length;i++)A.push(arguments[i]);var cb=typeof A[A.length-1]==='function'?A.pop():undefined;var P=(typeof A[0]==='object'&&A[0])||{};var fail=function(){return Promise.reject(new Error('Extension API transport unavailable: tabs.create'))};var p=TIPC('create',P),v;if(p&&typeof p.then==='function')v=p.then(function(tab){if(tab&&typeof tab==='object'&&typeof tab.id==='number'&&tab.id>=0)return tab;throw new Error('tabs.create returned an invalid Tab')});else{v=p!==null&&p!==undefined?Promise.resolve(p):fail()}if(typeof cb==='function'){v.then(function(r){try{cb(r)}catch(_){}},function(err){var rt=TC.runtime,old;try{old=Object.getOwnPropertyDescriptor(rt,'lastError');Object.defineProperty(rt,'lastError',{value:{message:String(err&&err.message||err||'Unknown error')},configurable:true})}catch(_){}try{cb(undefined)}catch(_){}try{if(old)Object.defineProperty(rt,'lastError',old);else delete rt.lastError}catch(_){}});return undefined}return v},TCOK=false;try{Object.defineProperty(TT,'create',{value:TCreate,configurable:true,enumerable:true,writable:true});TCOK=TT.create===TCreate}catch(_){}if(!TCOK){try{TT.create=TCreate;TCOK=TT.create===TCreate}catch(_){}}if(TCOK){try{Object.defineProperty(TCreate,'__crxIpcRoute',{value:true,configurable:true})}catch(_){}}}` +
  // chrome.tabs 的变更类方法(update/get/reload/remove/goBack/goForward/duplicate)
  // 也必须强制走我们的 crx-msg 路由。crx-preload 在某些扩展页(典型:chrome_url_overrides
  // 的 newtab 页)因 runtime.id 未就绪而提前 return,且页面侧无重投机制 → __crxPatched 永远
  // 为假 → Chromium 原生 chrome.tabs.update 等留存。原生 tab 模型不认我们的标签(标签在
  // vendor store,不在 Chromium 原生 tab 列表),故 newtab 上点图标走 chrome.tabs.update({url})
  // 导航当前标签时,原生抛 "No such tab" → 点击无反应。这里把这些方法像 query/create 一样
  // 强制覆写到 TIPC(经 ipcRenderer 'crx-msg' → vendor handler,后者认得我们的标签,且省略
  // tabId 时回落到当前活动标签)。仅覆写 vendor 已实现的方法,避免转发到不存在的 handler。
  `var TFwd=function(name){return function(){var A=[],i;for(i=0;i<arguments.length;i++)A.push(arguments[i]);var cb=typeof A[A.length-1]==='function'?A.pop():undefined;var p=TIPC.apply(null,[name].concat(A));if(!p||typeof p.then!=='function')p=p===null?Promise.reject(new Error('Extension API transport unavailable: tabs.'+name)):Promise.resolve(p);if(typeof cb!=='function')return p;p.then(function(v){try{cb(v)}catch(_){}},function(err){var rt=TC.runtime,old;try{old=Object.getOwnPropertyDescriptor(rt,'lastError');Object.defineProperty(rt,'lastError',{value:{message:String((err&&err.message)||err||'Unknown error')},configurable:true})}catch(_){}try{cb(undefined)}catch(_){}try{if(old)Object.defineProperty(rt,'lastError',old);else delete rt.lastError}catch(_){}});return undefined}};var TMOK=true;['update','get','reload','remove','goForward','goBack','duplicate'].forEach(function(m){if(TT[m]&&TT[m].__crxIpcRoute)return;var fn=TFwd(m),ok=false;try{Object.defineProperty(TT,m,{value:fn,configurable:true,enumerable:true,writable:true});ok=TT[m]===fn}catch(_){}if(!ok){try{TT[m]=fn;ok=TT[m]===fn}catch(_){}}if(ok){try{Object.defineProperty(fn,'__crxIpcRoute',{value:true,configurable:true})}catch(_){}}else TMOK=false});` +
  // windows.create 同上,但放进 TInstall 内联(绝不能写成独立 (function(){...})();
  // IIFE —— strip 正则 [\s\S]*?}\)()(); 非贪婪到第一个 })(); 会把它误当 SHIM 终止
  // 符,留下 SHIM 后半段成 orphan 破坏宿主 JS。用 TWin() helper 取 windows 对象即可。
  `var WIN=TWin();if(WIN&&(!WIN.create||!WIN.create.__crxIpcRoute)){WIN.create=function(){var A=[],i;for(i=0;i<arguments.length;i++)A.push(arguments[i]);var cb=typeof A[A.length-1]==='function'?A.pop():undefined;var P=(typeof A[0]==='object'&&A[0])||{};var urls=Array.isArray(P.url)?P.url:(typeof P.url==='string'?[P.url]:[]);var e=TG.electron;var ip=e&&e.ipcRenderer;var ipc=function(){var id=TID();try{if(e&&typeof e.invokeExtension==='function')return e.invokeExtension(id,'windows.create',{},P);if(ip&&typeof ip.invoke==='function')return ip.invoke('crx-msg',id,'windows.create',P)}catch(_){}try{if(typeof TG.ipcInvoke==='function')return TG.ipcInvoke('crx-msg',id,'windows.create',P)}catch(_){}return null};var p=ipc();var fin=function(win){if(win&&typeof win==='object'&&(typeof win.id==='number'||typeof win.id==='string'))return win;if(urls.length){try{console.warn('[crx-popup] windows.create IPC fallback -> window.open n='+urls.length)}catch(_){}for(var j=0;j<urls.length;j++){try{window.open(urls[j],'_blank')}catch(_){}}}return win};var v=(p&&typeof p.then==='function')?p.then(fin).catch(function(){return fin(null)}):Promise.resolve(fin(p));if(typeof cb==='function'){v.then(function(r){try{cb(r)}catch(_){}});return undefined}return v};try{Object.defineProperty(WIN.create,'__crxIpcRoute',{value:true,configurable:true})}catch(_){}}var OK=!!(TT&&typeof TT.create==='function'&&TT.create.__crxIpcRoute&&TMOK);if(!OK&&!TInstall.__facade){TInstall.__facade=1;var NT=TReplace('tabs');TInstall.__facade=0;if(NT&&NT!==TT)return TInstall()}return OK};TInstall();if(typeof setTimeout==='function'){var TRI=0,TRUN=function(){TInstall();if(++TRI<=160)setTimeout(TRUN,25)};setTimeout(TRUN,0)}` +
  `if(typeof document==='undefined'&&TC.runtime&&TC.runtime.onMessage&&typeof TC.runtime.onMessage.addListener==='function'&&!TG.__crxTabsRelayInstalled){TG.__crxTabsRelayInstalled=1;` +
  `TC.runtime.onMessage.addListener(function(req,sender,sendResponse){if(!req||!req.__crxTabsSendMessage)return;TSend(req.tabId,req.message,req.options,false).then(function(v){try{sendResponse(v)}catch(_){}}).catch(function(){try{sendResponse(undefined)}catch(_){}});return true})}` +
  `}}catch(_){}` +
  // Generic early API surface. This is not an alternate implementation: it only
  // fills missing functions during degraded startup, and every call first tries
  // the same crx-msg IPC handlers used by the normal renderer preload.
  `try{var AG=(typeof globalThis!=='undefined'&&globalThis)||(typeof self!=='undefined'&&self)||this;var AC=(typeof chrome!=='undefined'&&chrome)||(AG&&AG.chrome);` +
  `if(AC&&AC.runtime&&(AC.runtime.id||typeof window==='undefined')){var AIDFN=function(){try{return(AC&&AC.runtime&&AC.runtime.id)||null}catch(_){return null}};var AE=function(){return{addListener:function(){},removeListener:function(){},hasListener:function(){return false},hasListeners:function(){return false}}};var AX=function(n){var L=[];var B=function(x){if(x.b||L.indexOf(x)<0)return true;try{var e=AG.electron;if(e&&typeof e.addExtensionListener==='function'){e.addExtensionListener(AIDFN(),n,x.f,x.fl,x.ex);x.b=true;return true}}catch(_){}return false};return{addListener:function(f,fl,ex){if(typeof f!=='function'||L.some(function(x){return x.f===f}))return;var x={f:f,fl:fl,ex:ex,b:false};L.push(x);if(!B(x)&&typeof setTimeout==='function'){var k=0,q=function(){if(B(x)||L.indexOf(x)<0||++k>400)return;setTimeout(q,25)};setTimeout(q,0)}},removeListener:function(f){for(var i=L.length-1;i>=0;i--){var x=L[i];if(x.f!==f)continue;L.splice(i,1);if(x.b)try{var e=AG.electron;if(e&&typeof e.removeExtensionListener==='function')e.removeExtensionListener(AIDFN(),n,f)}catch(_){}}},hasListener:function(f){return L.some(function(x){return x.f===f})},hasListeners:function(){return L.length>0}}};` +
  // A waking service worker evaluates the extension's top level before the
  // preload exposes globalThis.electron. runtime.sendMessage cannot serve as a
  // fallback there: a worker has no receiver for its own messages, so calls
  // like declarativeNetRequest.updateDynamicRules at startup would reject with
  // "Receiving end does not exist". Wait for the bridge instead (~10s).
  `var AWB=function(){var e=AG.electron;return !!(e&&(typeof e.invokeExtensionRaw==='function'||typeof e.invokeExtension==='function'||(e.ipcRenderer&&typeof e.ipcRenderer.invoke==='function')))||typeof AG.ipcInvoke==='function'};` +
  `var AI=function(n,args){args=args||[];if(typeof window==='undefined'&&!AWB()&&typeof setTimeout==='function'){return new Promise(function(res,rej){var k=0,t=function(){if(AWB()){var r=AI(n,args);if(r&&typeof r.then==='function')r.then(res,rej);else if(r===null)rej(new Error('Extension API transport unavailable: '+n));else res(r);return}if(++k>400){rej(new Error('Extension API transport unavailable: '+n));return}setTimeout(t,25)};setTimeout(t,0)})}var aid=AIDFN();try{var e=AG.electron;if(e&&typeof e.invokeExtensionRaw==='function')return e.invokeExtensionRaw.apply(e,[aid,n,{}].concat(args));if(e&&typeof e.invokeExtension==='function')return e.invokeExtension.apply(e,[aid,n,{}].concat(args));var ip=e&&e.ipcRenderer;if(ip&&typeof ip.invoke==='function')return ip.invoke.apply(ip,['crx-msg',aid,n].concat(args))}catch(_){}try{if(typeof AG.ipcInvoke==='function')return AG.ipcInvoke.apply(AG,['crx-msg',aid,n].concat(args))}catch(_){}try{if(AC.runtime&&typeof AC.runtime.sendMessage==='function'){var q=AC.runtime.sendMessage({__crxApiRequest:true,method:n,args:args});return Promise.resolve(q).then(function(v){if(v&&v.__crxApiResponse){if(v.ok)return v.value;throw new Error(v.error||('Extension API failed: '+n))}return v})}}catch(_){}return null};` +
  `var AD=function(n){if(n.indexOf('.query')>=0||n.indexOf('.getAll')>=0||n.indexOf('.getRecentlyClosed')>=0||n.indexOf('.getDevices')>=0||n.indexOf('.getVoices')>=0||n.indexOf('.getFontList')>=0)return[];if(n.indexOf('.clear')>=0||n.indexOf('.remove')>=0||n.indexOf('.set')>=0||n.indexOf('.update')>=0||n.indexOf('.create')>=0||n.indexOf('.reload')>=0)return true;return undefined};` +
  `var AF=function(n){return function(){var a=[],i;for(i=0;i<arguments.length;i++)a.push(arguments[i]);var cb=typeof a[a.length-1]==='function'?a.pop():undefined;var p=AI(n,a),v=p&&typeof p.then==='function'?p.catch(function(){return AD(n)}):Promise.resolve(p!==null?p:AD(n));if(cb){v.then(function(r){try{cb(r)}catch(_){}});return undefined}return v}};` +
  `var AR=function(n){return function(){var a=[],i;for(i=0;i<arguments.length;i++)a.push(arguments[i]);var cb=typeof a[a.length-1]==='function'?a.pop():undefined;var p=AI(n,a);if(!p||typeof p.then!=='function')p=p===null?Promise.reject(new Error('Extension API transport unavailable: '+n)):Promise.resolve(p);if(!cb)return p;p.then(function(v){try{cb(v)}catch(_){}},function(err){var rt=AC.runtime,old;try{old=Object.getOwnPropertyDescriptor(rt,'lastError');Object.defineProperty(rt,'lastError',{value:{message:String(err&&err.message||err||'Unknown error')},configurable:true})}catch(_){}try{cb(undefined)}catch(_){}try{if(old)Object.defineProperty(rt,'lastError',old);else delete rt.lastError}catch(_){}});return undefined}};` +
  `var AN=function(ns){try{if(!AC[ns]){var v={};try{Object.defineProperty(AC,ns,{value:v,configurable:true,enumerable:true,writable:true})}catch(_){}if(!AC[ns])try{AC[ns]=v}catch(_){}}return AC[ns]||null}catch(_){return null}};var AM=function(ns,ms){var o=AN(ns);if(!o)return;for(var i=0;i<ms.length;i++){var m=ms[i];if(typeof o[m]!=='function')o[m]=AF(ns+'.'+m)}};var AV=function(ns,es){var o=AN(ns);if(!o)return;for(var i=0;i<es.length;i++){var e=es[i];if(!o[e])o[e]=AE()}};` +
  `var AP=function(o,k,v){if(!o)return false;try{Object.defineProperty(o,k,{value:v,configurable:true,enumerable:true,writable:true});if(o[k]===v)return true}catch(_){}try{o[k]=v;return o[k]===v}catch(_){return false}};` +
  // Install capture-only runtime events before an extension's entry script
  // executes. This prevents synchronous WXT listener registration from seeing
  // an incomplete native runtime object during cold worker startup.
  `var ART=AC.runtime,AER=function(slot){var L=[];try{if(Array.isArray(AG[slot]))L=AG[slot]}catch(_){}try{AG[slot]=L}catch(_){}return{__crxHosted:true,addListener:function(f){if(typeof f==='function'&&L.indexOf(f)<0)L.push(f)},removeListener:function(f){var i=L.indexOf(f);if(i>=0)L.splice(i,1)},hasListener:function(f){return L.indexOf(f)>=0},hasListeners:function(){return L.length>0}}},ARE=function(k,v){var e;try{e=ART&&ART[k]}catch(_){}if(!e||typeof e.addListener!=='function')AP(ART,k,v)};ARE('onMessage',AER('__crxPortBrokerOnMsg'));ARE('onConnect',AER('__crxPortBrokerOnConnect'));ARE('onInstalled',AX('runtime.onInstalled'));ARE('onStartup',AX('runtime.onStartup'));` +
  // Popup/options 页在 preload 丢失时会退回 Electron/Chromium 自带的
  // runtime.openOptionsPage，实现上会直接报 “Could not create an options page”。
  // 这里对扩展页强制覆写到宿主的 crx-msg 路由，而不是仅在缺失时补齐。
  `var AICP=(typeof location!=='undefined'&&location&&location.protocol)==='chrome-extension:';if(AICP&&AC.runtime){var AROP=function(){var cb=typeof arguments[arguments.length-1]==='function'?arguments[arguments.length-1]:undefined;var p=AI('runtime.openOptionsPage',[]);if(p&&typeof p.then==='function'){var vp=p.catch(function(){return undefined});if(cb){vp.then(function(r){try{cb(r)}catch(_){}});return undefined}return vp}var out;try{var AMF=AC.runtime.getManifest?AC.runtime.getManifest()||{}:{};var AOP=(AMF.options_ui&&AMF.options_ui.page)||AMF.options_page||'';if(AOP){var AURL=AC.runtime.getURL?AC.runtime.getURL(AOP):('chrome-extension://'+(AIDFN()||'')+'/'+String(AOP).replace(/^\\/+/,''));out=window&&typeof window.open==='function'?window.open(AURL,'_blank'):undefined}}catch(_){out=undefined}if(cb){try{cb(out)}catch(_){ } return undefined}return Promise.resolve(out)};try{AC.runtime.openOptionsPage=AROP}catch(_){}try{var ABR=AG.browser&&AG.browser.runtime;if(ABR&&ABR!==AC.runtime)ABR.openOptionsPage=AROP}catch(_){} }` +
  // Real Chrome content scripts have NO chrome.tabs/windows (only runtime/storage/
  // i18n/extension). Exposing them makes webext-bridge's context detector take the
  // Rd("tabs") branch (=> "background") instead of Rd("extension") (=> "content-
  // script"), so the content script never calls runtime.connect() and the SW's
  // onConnect->handleMessage dispatcher is never registered => every content->SW
  // sendMessage resolves undefined (BewlyBewly). So in a web-page context, drop
  // any tabs/windows (native or from a prior block) and skip installing them.
  `var AISCS=(typeof location!=='undefined'&&location&&/^(https?|file|about):/.test(location.protocol||''));if(AISCS){try{AC.tabs=undefined}catch(_){}try{delete AC.tabs}catch(_){}try{Object.defineProperty(AC,'tabs',{value:undefined,configurable:true})}catch(_){}try{AC.windows=undefined}catch(_){}try{delete AC.windows}catch(_){}}` +
  // Chrome 150 binds a namespace only when its feature dependencies hold:
  // permission-gated APIs need the permission (we also accept optional ones so
  // a later permissions.request works without a reload), manifest-key APIs
  // (action/browser_action/commands) need the key, and MV2-only tabs methods
  // are absent in MV3. Content scripts get none of these. A partial namespace
  // is worse than none: feature detection (`ns && ns.x.addListener`) then
  // crashes. Unreadable manifest → keep the old install-everything fallback.
  `var ASMF=null;try{ASMF=AC.runtime&&AC.runtime.getManifest?AC.runtime.getManifest()||null:null}catch(_){ASMF=null}var ASPM=ASMF?(ASMF.permissions||[]).concat(ASMF.optional_permissions||[]):null;var ASHP=function(p){return !ASPM||ASPM.indexOf(p)>=0};var ASHK=function(k){return !ASMF||!!ASMF[k]};var ASMV=(ASMF&&ASMF.manifest_version)||0;` +
  `if(!AISCS){AM('tabs',['get','getCurrent','query','create','update','remove','reload','duplicate','move','highlight','discard','captureVisibleTab','detectLanguage','getZoom','setZoom','getZoomSettings','setZoomSettings','goBack','goForward','group','ungroup'].concat(ASMV===3?[]:['getAllInWindow','insertCSS','removeCSS']));AV('tabs',['onCreated','onUpdated','onRemoved','onActivated','onMoved','onAttached','onDetached','onReplaced','onHighlighted','onZoomChange']);var AT=AN('tabs'),AQ=function(q,cb){q=q||{};var fb=function(){try{return typeof TQuery==='function'?TQuery(q):[]}catch(_){return[]}},p=AI('tabs.query',[q]);if(!p||typeof p.then!=='function')p=p===null?Promise.resolve(fb()):Promise.resolve(p);p=p.then(function(v){if(q&&typeof q==='object'&&typeof q.groupId==='number')return Array.isArray(v)?v:[];return Array.isArray(v)&&v.length?v:fb()},function(){return q&&typeof q==='object'&&typeof q.groupId==='number'?[]:fb()});if(typeof cb==='function'){p.then(function(v){try{cb(v)}catch(_){}});return undefined}return p};AP(AT,'query',AQ);if(AT){if(AT.TAB_ID_NONE===undefined)AP(AT,'TAB_ID_NONE',-1);if(AT.TAB_INDEX_NONE===undefined)AP(AT,'TAB_INDEX_NONE',-1);if(AT.MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND===undefined)AP(AT,'MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND',2)}` +
  `AM('windows',['get','getCurrent','getLastFocused','getAll','create','update','remove']);try{AC.windows.WINDOW_ID_NONE=-1;AC.windows.WINDOW_ID_CURRENT=-2}catch(_){}AV('windows',['onCreated','onRemoved','onFocusChanged','onBoundsChanged']);` +
  // permissions events stay IPC-bridged: never overwrite a working event with
  // a no-op (that silently dropped every onAdded/onRemoved after a grant).
  `AM('permissions',['contains','getAll','request','remove']);var PN=AN('permissions'),PME=['contains','getAll','request','remove'];for(var pi=0;pi<PME.length;pi++)AP(PN,PME[pi],AR('permissions.'+PME[pi]));['onAdded','onRemoved'].forEach(function(k){var e=PN&&PN[k];if(!e||typeof e.addListener!=='function'||e.__crxNoop)AP(PN,k,AX('permissions.'+k))});if(ASHP('alarms')){AM('alarms',['create','get','getAll','clear','clearAll']);AV('alarms',['onAlarm'])}if(ASHK('commands')){AM('commands',['getAll']);AV('commands',['onCommand'])}` +
  `if(ASHP('contextMenus')){AM('contextMenus',['create','update','remove','removeAll']);AV('contextMenus',['onClicked'])}if(ASHP('cookies')){AM('cookies',['get','getAll','set','remove','getAllCookieStores']);AV('cookies',['onChanged'])}` +
  `if(ASHP('bookmarks')){AM('bookmarks',['get','getChildren','getRecent','getTree','getSubTree','search','create','move','update','remove','removeTree']);AV('bookmarks',['onCreated','onRemoved','onChanged','onMoved','onChildrenReordered','onImportBegan','onImportEnded'])}` +
  `if(ASHP('history')){AM('history',['search','getVisits','addUrl','deleteUrl','deleteRange','deleteAll']);AV('history',['onVisited','onVisitRemoved'])}if(ASHP('downloads')){AM('downloads',['download','search','pause','resume','cancel','erase','getFileIcon','open','show','showDefaultFolder','removeFile','acceptDanger','setUiOptions','setShelfEnabled','drag']);AV('downloads',['onChanged','onCreated','onDeterminingFilename','onErased'])}` +
  `if(ASHP('notifications')){AM('notifications',['clear','create','getAll','getPermissionLevel','update']);AV('notifications',['onClicked','onButtonClicked','onClosed'])}` +
  // Electron drops persistent (Service Worker) notifications outright:
  // registration.showNotification resolves but nothing is shown, and on macOS
  // the app never even reaches System Settings → Notifications. MV3 extensions
  // push messages this way, so route it to the host's native Notification
  // (notifications.showPersistent) and dispatch notificationclick/close back
  // into the worker. The snapshot rides along with each event so a worker that
  // was stopped and re-woken can still build event.notification.
  `if(typeof window==='undefined'&&typeof ServiceWorkerRegistration!=='undefined'&&ASHP('notifications')){try{var NSP=ServiceWorkerRegistration.prototype;if(!NSP.__crxNotif){var NSM={},NSC=function(v){if(v===undefined)return null;try{return typeof structuredClone==='function'?structuredClone(v):JSON.parse(JSON.stringify(v))}catch(_){return null}},NSA=function(a){return Array.isArray(a)?a.slice(0,2).map(function(x){return{action:String(x&&x.action||''),title:String(x&&x.title||'')}}):[]},NSN=function(id,p){p=p||{};return{title:String(p.title||''),body:String(p.body||''),tag:String(p.tag||''),icon:String(p.icon||''),badge:'',image:'',lang:'',dir:'auto',data:p.data===undefined?null:p.data,actions:NSA(p.actions),requireInteraction:!!p.requireInteraction,silent:!!p.silent,renotify:false,timestamp:p.timestamp||Date.now(),vibrate:[],close:function(){delete NSM[id];AI('notifications.closePersistent',[id])}}};` +
  `AP(NSP,'showNotification',function(t,o){o=o||{};var tag=o.tag!=null&&o.tag!==''?String(o.tag):'',id=tag?('t:'+tag):('n:'+Date.now().toString(36)+Math.random().toString(36).slice(2,8)),p={title:String(t==null?'':t),body:o.body==null?'':String(o.body),tag:tag,icon:typeof o.icon==='string'?o.icon:'',data:NSC(o.data),actions:NSA(o.actions),requireInteraction:!!o.requireInteraction,silent:!!o.silent,timestamp:typeof o.timestamp==='number'?o.timestamp:Date.now()};NSM[id]=NSN(id,p);var r=AI('notifications.showPersistent',[id,{title:p.title,body:p.body,icon:p.icon,silent:p.silent,requireInteraction:p.requireInteraction,actions:p.actions},p]);if(r===null)r=Promise.reject(new Error('notification transport unavailable'));return Promise.resolve(r).then(function(){return undefined},function(e){delete NSM[id];throw new TypeError(String(e&&e.message||e))})});` +
  `AP(NSP,'getNotifications',function(f){var tg=f&&f.tag!=null?String(f.tag):'';return Promise.resolve(Object.keys(NSM).map(function(k){return NSM[k]}).filter(function(n){return !tg||n.tag===tg}))});AP(NSP,'__crxNotif',true);` +
  `var NSD=function(type,id,act,p){var n=NSM[id]||(NSM[id]=NSN(id,p));if(type==='notificationclose')delete NSM[id];var ev=new Event(type),W=[];try{Object.defineProperty(ev,'notification',{value:n});Object.defineProperty(ev,'action',{value:act||''});Object.defineProperty(ev,'reply',{value:null});Object.defineProperty(ev,'waitUntil',{value:function(q){W.push(q)}})}catch(_){}try{AG.dispatchEvent(ev)}catch(_){}};` +
  `AX('notifications.onPersistentClicked').addListener(function(id,idx,p){var n=NSM[id]||NSN(id,p),a='';if(typeof idx==='number'&&idx>=0&&n.actions[idx])a=n.actions[idx].action;NSD('notificationclick',id,a,p)});AX('notifications.onPersistentClosed').addListener(function(id,byUser,p){if(byUser===false){delete NSM[id];return}NSD('notificationclose',id,'',p)})}}catch(_){}}` +
  `if(ASHP('topSites'))AM('topSites',['get']);if(ASHP('idle')){AM('idle',['queryState','setDetectionInterval']);AV('idle',['onStateChanged'])}if(ASHP('power'))AM('power',['requestKeepAwake','releaseKeepAwake']);` +
  // chrome.desktopCapture / chrome.tabCapture(browser/api/capture.ts)。preload 丢失的
  // 扩展页(offscreen 录屏文档)也要有:chooseDesktopMedia 只有回调形式、同步返回
  // requestId;选择器是交互式的，经 SW 代理时关掉 8s 传输超时。getUserMedia 包装把
  // crx-desktop:/crx-tab: 令牌换成 Electron 认识的 source id(带上本页 URL 供主进程
  // 定位消费者 WebContents)。
  `var ACAPI=function(n,a,lng){var aid=AIDFN();try{var e=AG.electron;if(e&&typeof e.invokeExtensionRaw==='function')return Promise.resolve(e.invokeExtensionRaw.apply(e,[aid,n,{}].concat(a)))}catch(_){}try{if(AC.runtime&&typeof AC.runtime.sendMessage==='function'){var rq={__crxApiRequest:true,method:n,args:a};if(lng)rq.__crxTransportTimeoutMs=0;return Promise.resolve(AC.runtime.sendMessage(rq)).then(function(v){if(v&&v.__crxApiResponse){if(v.ok)return v.value;throw new Error(v.error||('Extension API failed: '+n))}return v})}}catch(x){return Promise.reject(x)}return Promise.reject(new Error('Extension API transport unavailable: '+n))};` +
  `if(ASHP('desktopCapture')){var ADC=AN('desktopCapture'),ADCN=0;if(ADC&&!ADC.__crxCap){AP(ADC,'__crxCap',true);AP(ADC,'DesktopCaptureSourceType',{SCREEN:'screen',WINDOW:'window',TAB:'tab',AUDIO:'audio'});AP(ADC,'chooseDesktopMedia',function(src,tt,cb){if(typeof tt==='function'){cb=tt;tt=undefined}var rid=++ADCN;ACAPI('desktopCapture.chooseDesktopMedia',[rid,src,tt],true).catch(function(){return null}).then(function(r){if(typeof cb!=='function')return;try{cb((r&&r.streamId)||'',{canRequestAudioTrack:!!(r&&r.canRequestAudioTrack)})}catch(_){}});return rid});AP(ADC,'cancelChooseDesktopMedia',function(rid){ACAPI('desktopCapture.cancelChooseDesktopMedia',[rid]).catch(function(){})})}}` +
  `if(ASHP('tabCapture')){var ATC=AN('tabCapture');if(ATC&&!ATC.__crxCap){AP(ATC,'__crxCap',true);AP(ATC,'getMediaStreamId',AR('tabCapture.getMediaStreamId'));AP(ATC,'getCapturedTabs',AR('tabCapture.getCapturedTabs'));if(!ATC.onStatusChanged)AP(ATC,'onStatusChanged',AX('tabCapture.onStatusChanged'));if(AICP&&typeof navigator!=='undefined'&&navigator.mediaDevices)AP(ATC,'capture',function(o,cb){o=o||{};var tk=function(w,x,sid){if(!w)return false;var m={},k;for(k in((x&&x.mandatory)||{}))m[k]=x.mandatory[k];m.chromeMediaSource='tab';m.chromeMediaSourceId=sid;var r={};for(k in(x||{}))r[k]=x[k];r.mandatory=m;return r};ACAPI('tabCapture.getMediaStreamId',[{}]).then(function(sid){return navigator.mediaDevices.getUserMedia({audio:tk(o.audio,o.audioConstraints,sid),video:tk(o.video,o.videoConstraints,sid)})}).then(function(s){if(typeof cb==='function')try{cb(s)}catch(_){}},function(err){if(typeof cb!=='function')return;var rt=AC.runtime,old;try{old=Object.getOwnPropertyDescriptor(rt,'lastError');Object.defineProperty(rt,'lastError',{value:{message:String(err&&err.message||err||'Error starting tab capture')},configurable:true})}catch(_){}try{cb(null)}catch(_){}try{if(old)Object.defineProperty(rt,'lastError',old);else delete rt.lastError}catch(_){}})})}}` +
  // chrome.extension.isAllowed*:Chrome 默认均为 false(文件网址访问/无痕需用户手动开启);
  // 宿主无对应开关，preload 丢失的页面也按此默认值返回，支持回调与 Promise 两种形式。
  `if(AICP||typeof window==='undefined'){var AEXT=AN('extension');if(AEXT){['isAllowedFileSchemeAccess','isAllowedIncognitoAccess'].forEach(function(m){if(typeof AEXT[m]!=='function')AP(AEXT,m,function(cb){if(typeof cb==='function'){try{cb(false)}catch(_){}return undefined}return Promise.resolve(false)})})}}` +
  `var AMD=AICP&&typeof navigator!=='undefined'&&navigator.mediaDevices;if(AMD&&typeof AMD.getUserMedia==='function'&&!AMD.__crxCaptureIdsPatched){var AGUM=AMD.getUserMedia.bind(AMD),ASID=function(t){if(!t||typeof t!=='object')return null;var i=(t.mandatory&&t.mandatory.chromeMediaSourceId)||t.chromeMediaSourceId;return typeof i==='string'&&/^crx-(desktop|tab):/.test(i)?i:null},ARW=function(t,r,au){var m={},k;for(k in(t.mandatory||{}))m[k]=t.mandatory[k];m.chromeMediaSource=r.kind;if(au&&r.kind==='desktop')delete m.chromeMediaSourceId;else m.chromeMediaSourceId=r.sourceId;var o={};for(k in t)o[k]=t[k];o.mandatory=m;delete o.chromeMediaSource;delete o.chromeMediaSourceId;return o};AP(AMD,'getUserMedia',function(c){var vi=ASID(c&&c.video),ai=ASID(c&&c.audio),sid=vi||ai;if(!sid)return AGUM(c);return ACAPI('capture.resolveStreamId',[sid,String(location.href)]).then(function(r){var n={},k;for(k in c)n[k]=c[k];if(c.video&&vi)n.video=ARW(c.video,r,false);if(c.audio)n.audio=r.audio&&(ai||r.kind==='desktop')?ARW(c.audio,r,true):false;return AGUM(n)},function(){throw new DOMException('Invalid state','AbortError')})});AP(AMD,'__crxCaptureIdsPatched',true)}` +
  // chrome.management: getSelf/uninstallSelf/getPermissionWarningsByManifest
  // are available to every extension; the rest needs "management".
  `AM('management',['getSelf','getPermissionWarningsByManifest','uninstallSelf']);if(ASHP('management')){AM('management',['get','getAll','getPermissionWarningsById','setEnabled','uninstall']);AV('management',['onInstalled','onUninstalled','onEnabled','onDisabled'])}if(ASHP('sessions')){AM('sessions',['getRecentlyClosed','restore','getDevices']);AV('sessions',['onChanged']);try{AC.sessions.MAX_SESSION_RESULTS=25}catch(_){}}` +
  `if(ASHP('search'))AM('search',['query','queryInTab']);if(ASHP('tabGroups')){AM('tabGroups',['get','query','update','move']);var TGN=AN('tabGroups');AP(TGN,'TAB_GROUP_ID_NONE',-1);['get','query','update','move'].forEach(function(m){AP(TGN,m,AR('tabGroups.'+m))});AV('tabGroups',['onCreated','onMoved','onUpdated','onRemoved'])}if(ASHP('browsingData'))AM('browsingData',['remove','removeAppcache','removeCache','removeCookies','removeDownloads','removeFileSystems','removeFormData','removeHistory','removeIndexedDB','removeLocalStorage','removePluginData','removePasswords','removeWebSQL','removeServiceWorkers','settings']);` +
  `if(ASHP('webNavigation')){AM('webNavigation',['getFrame','getAllFrames']);var WN=AN('webNavigation'),WNE=['onBeforeNavigate','onCommitted','onCompleted','onCreatedNavigationTarget','onDOMContentLoaded','onErrorOccurred','onHistoryStateUpdated','onReferenceFragmentUpdated','onTabReplaced'];for(var wi=0;wi<WNE.length;wi++)AP(WN,WNE[wi],AX('webNavigation.'+WNE[wi]))}` +
  // chrome.webRequest: Electron binds the namespace natively but every on*
  // event is undefined. A cold-started MV3 worker (Violentmonkey after a
  // browser restart) registers webRequest listeners at top level before the
  // preload patch lands, dies on `undefined.addListener`, and the popup never
  // gets a response. Install IPC-bridged events (AX forwards filter and
  // extraInfoSpec) synchronously here; keep native enums/*Options/MAX_*.
  // Descriptor reads avoid triggering the native lazy event getters.
  // In a worker, Chromium re-runs its binding refresh when the SW reaches
  // `running` (observed ~110ms after the entry script) and swaps a FRESH
  // native webRequest onto chrome, discarding the patch above; the
  // extension's async handlers then read undefined events. Lock the hosted
  // namespace (non-configurable) so that refresh cannot replace it.
  `if(ASHP('webRequest')&&!AISCS){var WR=AN('webRequest'),WRE=['onBeforeRequest','onBeforeSendHeaders','onSendHeaders','onHeadersReceived','onAuthRequired','onResponseStarted','onBeforeRedirect','onCompleted','onErrorOccurred','onActionIgnored'],WRF=false;if(WR&&!WR.__crxHosted){var WRO={__crxHosted:true};for(var ri=0;ri<WRE.length;ri++){var WRD=null;try{WRD=Object.getOwnPropertyDescriptor(WR,WRE[ri])}catch(_){}var WRV=WRD&&WRD.value;WRO[WRE[ri]]=(WRV&&typeof WRV.addListener==='function')?WRV:AX('webRequest.'+WRE[ri])}for(var rk in WRO){if(!AP(WR,rk,WRO[rk]))WRF=true}if(WRF){try{var WRN=Object.getOwnPropertyNames(WR);for(var rj=0;rj<WRN.length;rj++){if(/^on[A-Z]/.test(WRN[rj])||WRN[rj] in WRO)continue;try{WRO[WRN[rj]]=WR[WRN[rj]]}catch(_){}}}catch(_){}AP(AC,'webRequest',WRO)}}` +
  `if(typeof window==='undefined'){try{var WRL=AC.webRequest;if(WRL&&WRL.__crxHosted)Object.defineProperty(AC,'webRequest',{value:WRL,configurable:false,enumerable:true,writable:false})}catch(_){}}}` +
  `var OF=ASHP('offscreen')?AN('offscreen'):null;if(OF&&!OF.Reason)AP(OF,'Reason',{TESTING:'TESTING',AUDIO_PLAYBACK:'AUDIO_PLAYBACK',IFRAME_SCRIPTING:'IFRAME_SCRIPTING',DOM_SCRAPING:'DOM_SCRAPING',BLOBS:'BLOBS',DOM_PARSER:'DOM_PARSER',USER_MEDIA:'USER_MEDIA',DISPLAY_MEDIA:'DISPLAY_MEDIA',WEB_RTC:'WEB_RTC',CLIPBOARD:'CLIPBOARD',LOCAL_STORAGE:'LOCAL_STORAGE',WORKERS:'WORKERS',BATTERY_STATUS:'BATTERY_STATUS',MATCH_MEDIA:'MATCH_MEDIA',GEOLOCATION:'GEOLOCATION'});` +
  `if(AC.runtime&&!AC.runtime.ContextType)AP(AC.runtime,'ContextType',${JSON.stringify(RUNTIME_CONTEXT_TYPE)});` +
  // action needs MV3 + the "action" key (verified on bare Electron 43: absent
  // without it); browserAction needs MV2 + "browser_action".
  `if(!ASMF||(ASMV===3&&ASMF.action)){AM('action',['setTitle','getTitle','setIcon','setPopup','getPopup','setBadgeText','getBadgeText','setBadgeBackgroundColor','getBadgeBackgroundColor','setBadgeTextColor','getBadgeTextColor','getUserSettings','isEnabled','enable','disable','openPopup']);AV('action',['onClicked','onUserSettingsChanged'])}if(!ASMF||(ASMV===2&&ASMF.browser_action)){AM('browserAction',['setTitle','getTitle','setIcon','setPopup','getPopup','setBadgeText','getBadgeText','setBadgeBackgroundColor','getBadgeBackgroundColor','enable','disable']);AV('browserAction',['onClicked'])}` +
  // Chrome only binds permission-gated namespaces (proxy / privacy / system.*)
  // when the manifest declares the permission (required or optional). Feature
  // detection like WXT's "const p = chrome.proxy; p && p.onRequest.addListener()"
  // relies on the namespace being ABSENT otherwise: installing a partial
  // chrome.proxy for an extension without "proxy" crashed its SW at startup
  // (Status code 15). ASHP() falls back to "installed" if the manifest is
  // unreadable so the previous behavior is kept in degraded contexts.
  `if(ASHP('proxy')){if(!AC.proxy)AC.proxy={};if(!AC.proxy.settings)AC.proxy.settings={};['set','clear','get'].forEach(function(m){if(typeof AC.proxy.settings[m]!=='function')AC.proxy.settings[m]=AF('proxy.settings.'+m)});if(!AC.proxy.settings.onChange)AC.proxy.settings.onChange=AX('proxy.settings.onChange');if(!AC.proxy.onProxyError)AC.proxy.onProxyError=AE();}` +
  // chrome.privacy.{network,services,websites}.<setting> — each leaf is a
  // chrome.types.ChromeSetting (get/set/clear + onChange). The renderer factory
  // (renderer/index.ts) only runs in the chrome-extension main world, so SW /
  // sandboxed popup / content-script contexts never got chrome.privacy.network
  // populated → uBlock Origin's webext.js:144 (`chrome.privacy[cat][setting]`)
  // crashed. This block installs the full nested surface up-front in EVERY
  // context (same unconditional placement as proxy/system); get/set/clear route
  // over AF → crx-msg to PrivacyAPI (browser/api/privacy.ts), onChange is a
  // local no-op event (cross-extension change broadcast is renderer-only, as for
  // proxy). Settings list MUST stay in sync with PRIVACY_SETTINGS in privacy.ts.
  `if(ASHP('privacy')){if(!AC.privacy)AC.privacy={};var PRV={network:['networkPredictionEnabled','webRTCIPHandlingPolicy','globalPrivacyControl'],services:['alternateErrorPagesEnabled','autofillAddressEnabled','autofillCreditCardEnabled','passwordSavingEnabled','safeBrowsingEnabled','safeBrowsingExtendedReportingEnabled','searchSuggestEnabled','spellingServiceEnabled','translationServiceEnabled'],websites:['hyperlinkAuditingEnabled','referrersEnabled','thirdPartyCookiesAllowed','cookieControlsEnabled','protectedContentEnabled']};for(var pc in PRV){if(!AC.privacy[pc])AC.privacy[pc]={};PRV[pc].forEach(function(n){if(!AC.privacy[pc][n])AC.privacy[pc][n]={};['get','set','clear'].forEach(function(m){if(typeof AC.privacy[pc][n][m]!=='function')AC.privacy[pc][n][m]=AF('privacy.'+pc+'.'+n+'.'+m)});if(!AC.privacy[pc][n].onChange)AC.privacy[pc][n].onChange=AE()})}}` +
  `if(ASHP('system.cpu')||ASHP('system.memory')||ASHP('system.display')){if(!AC.system)AC.system={};if(ASHP('system.cpu')){if(!AC.system.cpu)AC.system.cpu={};if(typeof AC.system.cpu.getInfo!=='function')AC.system.cpu.getInfo=AF('system.cpu.getInfo')}if(ASHP('system.memory')){if(!AC.system.memory)AC.system.memory={};if(typeof AC.system.memory.getInfo!=='function')AC.system.memory.getInfo=AF('system.memory.getInfo')}if(ASHP('system.display')){if(!AC.system.display)AC.system.display={};['getInfo','getDisplayLayout','setDisplayProperties','setEnabledDisplays','setDisplayLayout'].forEach(function(m){if(typeof AC.system.display[m]!=='function')AC.system.display[m]=AF('system.display.'+m)});if(!AC.system.display.onDisplayChanged)AC.system.display.onDisplayChanged=AE()}}` +
  // Electron's native DNR in a sandboxed popup bypasses the framework's rule
  // validation and omits onRuleMatchedDebug. Force the same main-process route
  // used by crx-preload. identity is entirely absent in that degraded context.
  `var APM=[];try{var AMF=AC.runtime.getManifest?AC.runtime.getManifest()||{}:{};APM=(AMF.permissions||[]).concat(AMF.optional_permissions||[])}catch(_){};` +
  // Electron drops the native sidePanel namespace because it does not yet
  // recognize the MV3 permission. Sandboxed popups therefore need the same
  // explicit main-process route as DNR and identity; otherwise extensions
  // incorrectly fall back to their in-page sidebar implementation.
  `if(APM.indexOf('sidePanel')>=0){var SP=AN('sidePanel');['open','setOptions','setPanelBehavior','getOptions','getPanelBehavior','close'].forEach(function(m){AP(SP,m,AR('sidePanel.'+m))});['onOpened','onClosed'].forEach(function(e){if(!SP[e]||!SP[e].__crxHosted)AP(SP,e,AX('sidePanel.'+e))})}` +
  `if(APM.indexOf('declarativeNetRequest')>=0||APM.indexOf('declarativeNetRequestWithHostAccess')>=0){var DN=AN('declarativeNetRequest'),DM=['updateDynamicRules','getDynamicRules','updateSessionRules','getSessionRules','getEnabledRulesets','updateEnabledRulesets','getAvailableStaticRuleCount','getMatchedRules','isRegexSupported','setExtensionActionOptions'];for(var di=0;di<DM.length;di++)AP(DN,DM[di],AR('declarativeNetRequest.'+DM[di]));AP(DN,'onRuleMatchedDebug',AE());var DC={ResourceType:{MAIN_FRAME:'main_frame',SUB_FRAME:'sub_frame',STYLESHEET:'stylesheet',SCRIPT:'script',IMAGE:'image',FONT:'font',OBJECT:'object',XMLHTTPREQUEST:'xmlhttprequest',PING:'ping',CSP_REPORT:'csp_report',MEDIA:'media',WEBSOCKET:'websocket',WEBTRANSPORT:'webtransport',WEBBUNDLE:'webbundle',OTHER:'other'},RuleActionType:{BLOCK:'block',REDIRECT:'redirect',ALLOW:'allow',UPGRADE_SCHEME:'upgradeScheme',MODIFY_HEADERS:'modifyHeaders',ALLOW_ALL_REQUESTS:'allowAllRequests'},RequestMethod:{CONNECT:'connect',DELETE:'delete',GET:'get',HEAD:'head',OPTIONS:'options',PATCH:'patch',POST:'post',PUT:'put'},DomainType:{FIRST_PARTY:'firstParty',THIRD_PARTY:'thirdParty'},HeaderOperation:{APPEND:'append',SET:'set',REMOVE:'remove'},UnsupportedRegexReason:{SYNTAX_ERROR:'syntaxError',MEMORY_LIMIT_EXCEEDED:'memoryLimitExceeded'},GUARANTEED_MINIMUM_STATIC_RULES:30000,MAX_NUMBER_OF_DYNAMIC_RULES:30000,MAX_NUMBER_OF_SESSION_RULES:5000,MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES:5000,MAX_NUMBER_OF_ENABLED_STATIC_RULESETS:50,MAX_NUMBER_OF_STATIC_RULESETS:100,MAX_NUMBER_OF_REGEX_RULES:1000,MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES:5000,MAX_NUMBER_OF_UNSAFE_SESSION_RULES:5000,GETMATCHEDRULES_QUOTA_INTERVAL:600,MAX_GETMATCHEDRULES_CALLS_PER_INTERVAL:20,DYNAMIC_RULESET_ID:'_dynamic',SESSION_RULESET_ID:'_session'};for(var dk in DC)AP(DN,dk,DC[dk])}` +
  // identity must preserve Chrome's two error contracts: Promise calls reject;
  // callback calls receive undefined while runtime.lastError is set. Resolve
  // the bridge at call time because preload initialization can trail this shim.
  `if(APM.indexOf('identity')>=0){var ID=AN('identity');AP(ID,'getRedirectURL',function(p){var r='https://'+(AIDFN()||'')+'.chromiumapp.org/';return p?r+String(p).replace(/^\\/+/, ''):r});AP(ID,'launchWebAuthFlow',function(d,cb){var hasCb=typeof cb==='function';var invoke=function(){return new Promise(function(resolve,reject){var tries=0,valid=function(v){if(typeof v==='string'&&v){resolve(v);return}reject(new Error('identity.launchWebAuthFlow returned no redirect URL'))},run=function(){var E=AG&&AG.electron,B=E&&E.launchIdentityWebAuthFlow,R=E&&E.invokeExtensionRaw,RT=AC&&AC.runtime,SM=RT&&RT.sendMessage;if(typeof B==='function'){try{B(AIDFN()||'',d||{},function(p){if(p&&p.ok)valid(p.value);else reject(new Error(String(p&&p.error||'identity.launchWebAuthFlow failed')))})}catch(e){reject(e)}return}if(typeof R==='function'){try{Promise.resolve(R(AIDFN()||'','identity.launchWebAuthFlow',{},d||{})).then(valid,reject)}catch(e){reject(e)}return}if(RT&&RT.__crxPortBrokerPage&&typeof SM==='function'){var req={__crxApiRequest:true,__crxTransportTimeoutMs:0,method:'identity.launchWebAuthFlow',args:[d||{}]},rp;try{rp=SM.call(RT,req)}catch(e){reject(e);return}if(!rp||typeof rp.then!=='function'){reject(new Error('identity.launchWebAuthFlow transport unavailable'));return}Promise.resolve(rp).then(function(v){if(v&&v.__crxApiResponse){if(v.ok)valid(v.value);else reject(new Error(String(v.error||'identity.launchWebAuthFlow failed')))}else reject(new Error('identity.launchWebAuthFlow transport returned an invalid response'))},reject);return}if(tries++<240&&typeof setTimeout==='function'){setTimeout(run,25);return}reject(new Error('identity.launchWebAuthFlow transport unavailable'))};run()})};var out=invoke();if(!hasCb)return out;out.then(function(v){try{cb(v)}catch(_){}},function(e){var rt=AC.runtime,old;try{old=Object.getOwnPropertyDescriptor(rt,'lastError');Object.defineProperty(rt,'lastError',{value:{message:String(e&&e.message||e||'identity.launchWebAuthFlow failed')},configurable:true})}catch(_){}try{cb(undefined)}catch(_){}try{if(old)Object.defineProperty(rt,'lastError',old);else delete rt.lastError}catch(_){}});return undefined});['getAuthToken','removeCachedAuthToken','clearAllCachedAuthTokens','getProfileUserInfo'].forEach(function(m){AP(ID,m,AR('identity.'+m))});AP(ID,'onSignInChanged',AE())}` +
  // userScripts (MV3): the sandboxed popup boots without crx-preload, so it is
  // stuck on Electron 42's NATIVE chrome.userScripts, which is gated behind an
  // "allow user scripts" toggle Electron has no UI for → getScripts/register
  // throw. ScriptCat's popup probe (getScripts, else a register/unregister
  // test) then fails and shows "'Allow User Scripts' is not enabled". Force the
  // methods onto the main-process route (the SW's crx-preload owns the real
  // permission-aware UserScriptsAPI, which already holds the registered
  // scripts), so the probe resolves and the false guide disappears. Same
  // force-override shape as the declarativeNetRequest/identity blocks above.
  // Only the 7 methods the main-process UserScriptsAPI actually backs are
  // exposed — NOT execute() (Chrome 135+), which has no handler: a present-but-
  // always-rejecting method would defeat feature detection. ExecutionWorld is a
  // pure spec constant (like the DNR MAX_* constants above) so callers that
  // reference chrome.userScripts.ExecutionWorld.USER_SCRIPT resolve correctly.
  `if(APM.indexOf('userScripts')>=0){var US=AN('userScripts');['register','update','unregister','getScripts','configureWorld','getWorldConfigurations','resetWorldConfiguration'].forEach(function(m){AP(US,m,AR('userScripts.'+m))});if(!US.ExecutionWorld)AP(US,'ExecutionWorld',{MAIN:'MAIN',USER_SCRIPT:'USER_SCRIPT'})}` +
  `}` + // end if(!AISCS): content scripts only keep runtime/storage/i18n/extension
  `if(AG.browser===AC){try{['tabs','windows','permissions','alarms','commands','contextMenus','cookies','bookmarks','history','downloads','notifications','topSites','idle','power','management','sessions','search','tabGroups','browsingData','webNavigation','action','browserAction','proxy','system','sidePanel','declarativeNetRequest','identity','userScripts'].forEach(function(k){if(AC[k]&&!AG.browser[k])AG.browser[k]=AC[k]})}catch(_){}}}}catch(e){}` +
  // A popup that missed crx-preload still has Electron's native event objects,
  // but those objects are not connected to ExtensionRouter. Replace only that
  // degraded extension-page surface with a local multi-listener facade. The
  // facade subscribes over the long-lived page Port installed below; normal
  // preloaded pages keep renderer/event.ts and the regular IPC route.
  `try{var APageDegraded=typeof window!=='undefined'&&typeof location!=='undefined'&&location&&location.protocol==='chrome-extension:'&&!(AG&&AG.electron&&typeof AG.electron.addExtensionListener==='function');` +
  `if(APageDegraded){var APageEvents={};var APageSubscribe=function(n){var s=APageEvents[n]||(APageEvents[n]={listeners:[],subscribed:false});if(s.subscribed)return;var f=AG.__crxPageEventSubscribe;if(typeof f==='function'){try{f(n);s.subscribed=true;return}catch(_){} }s.pending=true};` +
  `var APageUnsubscribe=function(n){var s=APageEvents[n];if(!s||!s.subscribed)return;var f=AG.__crxPageEventUnsubscribe;if(typeof f==='function'){try{f(n)}catch(_){} }s.subscribed=false};` +
  `var APageMake=function(n){var s=APageEvents[n]||(APageEvents[n]={listeners:[],subscribed:false});if(s.api)return s.api;var api={addListener:function(f){if(typeof f!=='function'||s.listeners.indexOf(f)>=0)return;s.listeners.push(f);if(s.listeners.length===1)APageSubscribe(n)},removeListener:function(f){var i=s.listeners.indexOf(f);if(i>=0)s.listeners.splice(i,1);if(s.listeners.length===0)APageUnsubscribe(n)},hasListener:function(f){return s.listeners.indexOf(f)>=0},hasListeners:function(){return s.listeners.length>0}};s.api=api;return api};` +
  `var APageDispatch=function(n,a){var s=APageEvents[n];if(!s||!s.listeners.length)return;var ls=s.listeners.slice();for(var i=0;i<ls.length;i++){try{ls[i].apply(null,Array.isArray(a)?a:[])}catch(_) {}}};` +
  `var APageReady=function(){var f;for(var n in APageEvents){if(!Object.prototype.hasOwnProperty.call(APageEvents,n))continue;var s=APageEvents[n];if(s&&s.listeners.length&&!s.subscribed){f=AG.__crxPageEventSubscribe;if(typeof f==='function'){try{f(n);s.subscribed=true}catch(_){}}}}};` +
  `var APageInstallEvents=function(){var APageEventNames={tabs:['onCreated','onUpdated','onRemoved','onActivated','onMoved','onAttached','onDetached','onReplaced','onHighlighted','onZoomChange'],windows:['onCreated','onRemoved','onFocusChanged','onBoundsChanged'],alarms:['onAlarm'],commands:['onCommand'],contextMenus:['onClicked'],cookies:['onChanged'],bookmarks:['onCreated','onRemoved','onChanged','onMoved','onChildrenReordered','onImportBegan','onImportEnded'],history:['onVisited','onVisitRemoved'],downloads:['onChanged','onCreated','onDeterminingFilename','onErased'],notifications:['onClicked','onButtonClicked','onClosed'],idle:['onStateChanged'],management:['onInstalled','onUninstalled','onEnabled','onDisabled'],sessions:['onChanged'],tabGroups:['onCreated','onMoved','onUpdated','onRemoved'],webNavigation:['onBeforeNavigate','onCommitted','onCompleted','onCreatedNavigationTarget','onDOMContentLoaded','onErrorOccurred','onHistoryStateUpdated','onReferenceFragmentUpdated','onTabReplaced'],action:['onClicked','onUserSettingsChanged'],browserAction:['onClicked'],permissions:['onAdded','onRemoved'],identity:['onSignInChanged'],declarativeNetRequest:['onRuleMatchedDebug'],system:['onDisplayChanged']};for(var AEN in APageEventNames){var AEO=AC[AEN];if(!AEO)continue;var AEL=APageEventNames[AEN];for(var AEI=0;AEI<AEL.length;AEI++){var AEK=AEL[AEI],AENm=AEN+'.'+AEK,AEE=APageMake(AENm);if(!AP(AEO,AEK,AEE)){try{var AEC=Object.create(AEO);if(AP(AEC,AEK,AEE))AP(AC,AEN,AEC)}catch(_) {}}}}};` +
  `try{AG.__crxPageEventDispatch=APageDispatch;AG.__crxPageEventReady=APageReady;AG.__crxPageEventInstall=APageInstallEvents}catch(_){};` +
  `APageInstallEvents();if(typeof setTimeout==='function'){var APageRetry=0,APageTick=function(){try{APageInstallEvents()}catch(_){}if(++APageRetry>80)return;try{setTimeout(APageTick,25)}catch(_){} };try{setTimeout(APageTick,0)}catch(_){}}}` +
  `}catch(e){}` +
  // ---- runtime.sendMessage Port-broker (sandboxed-popup recovery) ----------
  // When the popup renderer is co-sited with the MV3 service worker, the
  // process boots sandboxed (binding.startupData===null → "sandboxed_renderer
  // .bundle.js script failed to run"), crx-preload is SKIPPED entirely,
  // executeJavaScript HANGS, and globalThis.electron never lands. The popup is
  // then stuck on Electron's NATIVE chrome.runtime.sendMessage, whose response
  // channel CLOSES before an async ('return true' + sendResponse-later) listener
  // can reply ("The message port closed before a response was received") → the
  // callback resolves undefined → popup crash (Dark Reader: "Cannot destructure
  // property 'data' of 'undefined'"). Every bridge-based fix (IPC hub,
  // executeJavaScript) is dead in that state; the only surviving channels are
  // URL-hash (one-way) and native chrome.* messaging. So we route request/
  // response over a long-lived NATIVE Port (chrome.runtime.connect) — a Port
  // never auto-closes, so the SW's async reply always lands.
  //   PAGE side (popup/options, only when crx-preload was SKIPPED, i.e.
  //     !chrome.__crxPatched): override runtime.sendMessage to open a Port named
  //     'crxreq', post {__crxBrokerReq,mid,message,senderUrl}, resolve cb/promise
  //     from {__crxBrokerResp,mid,response}. Native sendMessage is the fallback
  //     for cross-extension send or if connect throws.
  //   SW side: capture every runtime.onMessage/onConnect listener (wrap
  //     addListener) and on a 'crxreq' Port dispatch the inner message to those
  //     listeners with sender.url = the popup's origin+pathname (Dark Reader's
  //     messageListener gates on sender.url being an allowed UI page) and a
  //     sendResponse that posts the reply back over the Port. Honors both
  //     Promise-return and 'return true' async patterns. crx-preload DID run in
  //     the SW, so chrome.runtime here is the additive onMessage/onConnect —
  //     wrapping its addListener captures the RAW listener while forwarding still
  //     registers it for normal traffic. The captured arrays are also exposed on
  //     globalThis (__crxPortBrokerOnMsg/__crxPortBrokerOnConnect) so the IPC
  //     delivery path in renderer/index.ts can dispatch to polyfill-registered
  //     (native-captured) listeners for content→SW traffic.
  // SW side: capture onMessage/onConnect listeners + answer 'crxreq' ports.
  `try {
    var SBG = (typeof globalThis !== 'undefined' && globalThis) || self;
    var SBC = SBG.chrome;
    // Receiver runs in the SW (no window) AND in MV2 background PAGES (which
    // have a window but where crx-preload ran → __crxPatched set). Sandboxed
    // popups have a window AND no __crxPatched → must stay SENDERS, not receivers.
    var SBsw = (typeof window === 'undefined') || !!(SBC && SBC.__crxPatched);
    if (SBsw && SBC && SBC.runtime && SBC.runtime.id && !SBC.runtime.__crxPortBrokerSW) {
      try { Object.defineProperty(SBC.runtime, '__crxPortBrokerSW', { value: true, configurable: true }); } catch (_) {}
      var SBID = SBC.runtime.id;
      var SBLS = [];
      try { SBG.__crxPortBrokerOnMsg = SBLS; } catch (_) {}
      var SBOffPending = {};
      var SBOM = SBC.runtime.onMessage;
      if (SBOM && typeof SBOM.addListener === 'function') {
        var SBoA = SBOM.addListener.bind(SBOM);
        SBOM.addListener = function (fn) {
          SBLS.push(fn);
          try { console.warn('[crx-portbroker-sw] cap n=' + SBLS.length); } catch (_) {}
          return SBoA(fn);
        };
        if (typeof SBOM.removeListener === 'function') {
          var SBoR = SBOM.removeListener.bind(SBOM);
          SBOM.removeListener = function (fn) {
            for (var i = SBLS.length - 1; i >= 0; i--) { if (SBLS[i] === fn) SBLS.splice(i, 1); }
            return SBoR(fn);
          };
        }
      }
      var SBOC = SBC.runtime.onConnect;
      if (SBOC && typeof SBOC.addListener === 'function') {
        var SBLSOC = [];
        var SBLSOCW = [];
        try { SBG.__crxPortBrokerOnConnect = SBLSOC; } catch (_) {}
        var SBOCoA = SBOC.addListener.bind(SBOC);
        var SBInternalPort = function (port) {
          var name = '';
          try { name = '' + ((port && port.name) || ''); } catch (_) {}
          return name.indexOf('crxreq') === 0 || name.indexOf('crx-page-listen') === 0;
        };
        SBOC.addListener = function (fn) {
          if (typeof fn !== 'function') return SBOCoA(fn);
          for (var wi = 0; wi < SBLSOCW.length; wi++) { if (SBLSOCW[wi].fn === fn) return; }
          var wrapped = function (port) { if (SBInternalPort(port)) return; return fn(port); };
          SBLSOC.push(fn);
          SBLSOCW.push({ fn: fn, wrapped: wrapped });
          try { console.warn('[crx-portbroker-sw] capOC n=' + SBLSOC.length); } catch (_) {}
          return SBOCoA(wrapped);
        };
        if (typeof SBOC.removeListener === 'function') {
          var SBOCoR = SBOC.removeListener.bind(SBOC);
          SBOC.removeListener = function (fn) {
            for (var i = SBLSOC.length - 1; i >= 0; i--) { if (SBLSOC[i] === fn) SBLSOC.splice(i, 1); }
            for (var j = SBLSOCW.length - 1; j >= 0; j--) {
              if (SBLSOCW[j].fn !== fn) continue;
              var wrapped = SBLSOCW[j].wrapped;
              SBLSOCW.splice(j, 1);
              return SBOCoR(wrapped);
            }
          };
        }
        try { SBOC.hasListener = function (fn) { for (var i = 0; i < SBLSOCW.length; i++) { if (SBLSOCW[i].fn === fn) return true; } return false; }; } catch (_) {}
        try { SBOC.hasListeners = function () { return SBLSOCW.length > 0; }; } catch (_) {}
        // crxreq broker handler — registered via the ORIGINAL addListener so it
        // is NOT captured into SBLSOC (infrastructure, not an extension listener).
        SBOCoA(function (port) {
          if (!port || ('' + (port.name || '')).indexOf('crxreq') !== 0) return;
             try { console.warn('[crx-portbroker-sw] connect name=' + port.name); } catch (_) {}
             port.onMessage.addListener(function (req) {
               if (!req || !req.__crxBrokerReq) return;
             var mid = req.mid, msg = req.message;
             var resp = false;
            var back = function (r) {
              if (resp) return;
               resp = true;
               try { port.postMessage({ __crxBrokerResp: true, mid: mid, response: r }); } catch (_) {}
             };
             // Sandboxed extension pages have no preload/IPC. Proxy their
             // chrome.* calls through this SW, whose crx-preload still owns the
             // permission-aware main-process API route. Keep failures explicit
             // so page-side Promise/callback semantics match Chrome.
              if (msg && msg.__crxApiRequest && typeof msg.method === 'string') {
                try {
                 // A degraded extension page reaches the worker through a
                 // native Port. Chrome attaches sender.tab only when that page
                 // is itself hosted in a browser tab. Preserve that identity
                 // for getCurrent instead of invoking the API as the worker,
                 // which correctly has no current tab. Popups, side panels and
                 // workers have no sender.tab and therefore stay undefined.
                 if (msg.method === 'tabs.getCurrent') {
                   var sbSenderTab = port && port.sender && port.sender.tab;
                   if (!sbSenderTab || typeof sbSenderTab.id !== 'number') {
                     back({ __crxApiResponse: true, ok: true, value: undefined });
                     return;
                   }
                   var sbGet = SBG.electron;
                   var sbGetFn = sbGet && (sbGet.invokeExtensionRaw || sbGet.invokeExtension);
                   if (typeof sbGetFn !== 'function') {
                     back({ __crxApiResponse: true, ok: true, value: sbSenderTab });
                     return;
                   }
                   Promise.resolve(sbGetFn.call(sbGet, SBID, 'tabs.get', {}, sbSenderTab.id)).then(function (value) {
                     back({ __crxApiResponse: true, ok: true, value: value && typeof value.id === 'number' && value.id >= 0 ? value : sbSenderTab });
                   }, function () {
                     back({ __crxApiResponse: true, ok: true, value: sbSenderTab });
                   });
                   return;
                 }
                 var sbe = SBG.electron;
                 var sbf = sbe && (sbe.invokeExtensionRaw || sbe.invokeExtension);
                 if (typeof sbf !== 'function') {
                   back({ __crxApiResponse: true, ok: false, error: 'Extension API transport unavailable' });
                   return;
                 }
                 var sba = [SBID, msg.method, {}].concat(Array.isArray(msg.args) ? msg.args : []);
                 Promise.resolve(sbf.apply(sbe, sba)).then(function (value) {
                   try { console.warn('[crx-apiproxy-sw] ok method=' + msg.method + ' resultType=' + (Array.isArray(value) ? ('array[' + value.length + ']') : (typeof value))); } catch (_) {}
                   back({ __crxApiResponse: true, ok: true, value: value });
                 }, function (err) {
                   try { console.warn('[crx-apiproxy-sw] ERR method=' + msg.method + ' err=' + String((err && err.message) || err)); } catch (_) {}
                   back({ __crxApiResponse: true, ok: false, error: String((err && err.message) || err || 'Unknown error') });
                 });
               } catch (err) {
                 back({ __crxApiResponse: true, ok: false, error: String((err && err.message) || err || 'Unknown error') });
                }
                return;
              }
              // The tabs relay listener is installed earlier in this shim, before
              // onMessage.addListener is wrapped, so it is intentionally absent
              // from SBLS. Handle its private request here instead of dispatching
              // it to extension listeners, which correctly ignore the envelope.
              if (msg && msg.__crxTabsSendMessage && typeof TSend === 'function') {
                try {
                  var relayCommand = msg.message && typeof msg.message === 'object' ? (msg.message.command || '') : '';
                  try { if (__crxAutoVerbose) console.warn('[crx-portbroker-sw] tabs-relay mid=' + mid + ' tabId=' + msg.tabId + ' command=' + (relayCommand || '?')); } catch (_) {}
                  Promise.resolve(TSend(msg.tabId, msg.message, msg.options, false)).then(function (value) {
                    try { if (__crxAutoVerbose) console.warn('[crx-portbroker-sw] tabs-relay-response mid=' + mid + ' command=' + (relayCommand || '?') + ' response=' + (value === undefined ? 'undefined' : value === null ? 'null' : typeof value)); } catch (_) {}
                    back(value);
                  }, function () { back(undefined); });
                } catch (_) {
                  back(undefined);
                }
                return;
              }
              var rr = [];
            for (var i = 0; i < SBLS.length; i++) {
              // Chrome omits MessageSender.tab for extension pages. Supplying
              // tab:null is observably different: extensions that use
              // hasOwn(sender, 'tab') treat the message as tab-backed and then
              // dereference null (KeePassXC-Browser does this in onMessage).
              try { rr.push(SBLS[i](msg, { id: SBID, url: (req.senderUrl || ''), origin: ('chrome-extension://' + SBID) }, back)); }
              catch (_) { rr.push(undefined); }
            }
            var pr = [], ht = false;
            for (var j = 0; j < rr.length; j++) {
              var rv = rr[j];
              if (rv && typeof rv.then === 'function') pr.push(rv);
              else if (rv === true) ht = true;
            }
            try {
              var dispatchCommand = msg && typeof msg === 'object' ? (msg.command || msg.type || msg.method || '') : '';
              if (__crxAutoVerbose) console.warn('[crx-portbroker-sw] dispatch mid=' + mid + ' command=' + (dispatchCommand || '?') + ' L=' + SBLS.length + ' P=' + pr.length + ' T=' + ht);
            } catch (_) {}
            if (pr.length) {
              pr[0].then(function (v) { back(v); }, function () { back(undefined); });
            } else if (!ht && !resp) {
              back(undefined);
            }
          });
        });
        // Save 'crx-page-listen' Ports opened by sandboxed popups, and forward
        // main-process 'crx-page-broadcast' events onto them so bg→popup push
        // reaches the popup's __crxPageOnMsg listeners over the only runtime
        // channel that survives a sandboxed popup (native connect Port).
        SBOCoA(function (port) {
          if (!port || ('' + (port.name || '')).indexOf('crx-page-listen') !== 0) return;
          try {
            var SBPLP = SBG.__crxPageListenPorts;
            var SBPageEventHandlers = {};
            var SBPageEventSubscribe = function (eventName) {
              if (!eventName || SBPageEventHandlers[eventName]) return;
              var el = SBG.electron;
              if (!el || typeof el.addExtensionListener !== 'function') return;
              var cb = function () {
                var args = [];
                try { args = Array.prototype.slice.call(arguments); } catch (_) { args = []; }
                try { port.postMessage({ __crxPageEvent: true, eventName: eventName, args: args }); } catch (_) {}
              };
              try {
                el.addExtensionListener(SBID, eventName, cb);
                SBPageEventHandlers[eventName] = cb;
                try { console.warn('[crx-portbroker-sw] event subscribed name=' + eventName); } catch (_) {}
              } catch (_) {}
            };
            var SBPageEventUnsubscribe = function (eventName) {
              var cb = SBPageEventHandlers[eventName];
              if (!cb) return;
              try {
                var el = SBG.electron;
                if (el && typeof el.removeExtensionListener === 'function') el.removeExtensionListener(SBID, eventName, cb);
              } catch (_) {}
              try { delete SBPageEventHandlers[eventName]; } catch (_) {}
            };
            if (!SBPLP) { SBPLP = []; try { SBG.__crxPageListenPorts = SBPLP; } catch (_) {} }
            try { port.__crxOffscreenPage = ('' + (port.name || '')).indexOf(':offscreen') > 0; } catch (_) {}
            if (SBPLP.indexOf(port) < 0) SBPLP.push(port);
            try { port.postMessage({ __crxPageListenReady: true }); } catch (_) {}
            if (port.onMessage) port.onMessage.addListener(function (msg) {
              if (msg && msg.__crxPageEventSubscribe && typeof msg.eventName === 'string') {
                SBPageEventSubscribe(msg.eventName);
                return;
              }
              if (msg && msg.__crxPageEventUnsubscribe && typeof msg.eventName === 'string') {
                SBPageEventUnsubscribe(msg.eventName);
                return;
              }
              if (!msg || !msg.__crxOffscreenPageResponse || !msg.requestId) return;
              var pending = SBOffPending[msg.requestId];
              if (!pending) return;
              try { delete SBOffPending[msg.requestId]; } catch (_) {}
              try { if (pending.timer) clearTimeout(pending.timer); } catch (_) {}
              try { pending.sendResponse(msg.response); } catch (_) {}
            });
             if (port.onDisconnect) port.onDisconnect.addListener(function () {
               try { for (var eventName in SBPageEventHandlers) { if (Object.prototype.hasOwnProperty.call(SBPageEventHandlers, eventName)) SBPageEventUnsubscribe(eventName); } } catch (_) {}
               try { var a = SBG.__crxPageListenPorts || []; var ix = a.indexOf(port); if (ix >= 0) a.splice(ix, 1); } catch (_) {}
             });
            try { console.warn('[crx-portbroker-sw] page-listen saved n=' + SBPLP.length); } catch (_) {}
          } catch (_) {}
        });
        // Main-process MessagingAPI sends this private request back into the SW
        // when an offscreen renderer lost its preload. Relay it over the native
        // page Port and keep sendResponse alive until the page answers.
        try { SBG.__crxOffscreenRelay = function (req, sender, sendResponse) {
          if (!req || !req.__crxOffscreenRelay) return;
          var rid = 'offscreen-' + Date.now() + '-' + Math.random().toString(36).slice(2);
          var SBdocUrl = typeof req.documentUrl === 'string' ? req.documentUrl.split('#')[0] : '';
          // Match the real offscreen document (createDocument may pick any path);
          // the :offscreen name suffix only covers the conventional offscreen.html.
          var pages = (SBG.__crxPageListenPorts || []).filter(function (p) {
            if (!p) return false;
            if (SBdocUrl) { try { return ('' + ((p.sender && p.sender.url) || '')).split('#')[0] === SBdocUrl; } catch (_) { return false; } }
            return !!p.__crxOffscreenPage;
          });
          if (!pages.length) { try { sendResponse(undefined); } catch (_) {} return false; }
          var timer = setTimeout(function () {
            var pending = SBOffPending[rid];
            if (!pending) return;
            try { delete SBOffPending[rid]; } catch (_) {}
            try { pending.sendResponse(undefined); } catch (_) {}
          }, 30000);
          SBOffPending[rid] = { sendResponse: sendResponse, timer: timer };
          for (var oi = 0; oi < pages.length; oi++) {
            try { pages[oi].postMessage({ __crxOffscreenPageRequest: true, requestId: rid, message: req.message, sender: req.sender || sender }); } catch (_) {}
          }
          return true;
        }; } catch (_) {}
        var SBPbind = function () {
          var el = SBG.electron;
          if (!el || typeof el.addExtensionListener !== 'function' || SBG.__crxPB) return false;
          try { SBG.__crxPB = 1; } catch (_) {}
          try {
            el.addExtensionListener(SBID, 'crx-page-broadcast', function (payload) {
              try {
                var arr = SBG.__crxPageListenPorts || [];
                for (var i = 0; i < arr.length; i++) { try { arr[i].postMessage(payload); } catch (_) {} }
              } catch (_) {}
            });
            try { console.warn('[crx-portbroker-sw] page-broadcast bound'); } catch (_) {}
            return true;
          } catch (e) { try { console.warn('[crx-portbroker-sw] page-bcast bind err ' + ((e && e.message) || e)); } catch (_) {} return false; }
        };
        if (!SBPbind()) { var SBPn = 0; var SBPiv = (SBG.setInterval ? SBG.setInterval(function () { if (SBPbind() || ++SBPn > 60) { try { SBG.clearInterval(SBPiv); } catch (_) {} } }, 100) : null); }
      }
    }
  } catch (_) {}` +
  // Page side: override runtime.sendMessage to use a 'crxreq' Port (sandboxed
  // popup/options where crx-preload was skipped). Non-sandboxed pages keep
  // crx-preload's IPC-backed sendMessage (gated by !chrome.__crxPatched).
  `try {
    var PBG = (typeof globalThis !== 'undefined' && globalThis) || self;
    var PBC = PBG.chrome;
    var PBpage = (typeof window !== 'undefined') && PBC && PBC.runtime && PBC.runtime.id && !PBC.__crxPatched &&
      (typeof location !== 'undefined') && location && location.protocol && ('' + location.protocol).indexOf('chrome-extension') === 0;
    if (PBpage && PBC.runtime && !PBC.runtime.__crxPortBrokerPage) {
      var PBnsend = PBC.runtime.sendMessage;
      var PBconn = PBC.runtime.connect;
      try { Object.defineProperty(PBC.runtime, '__crxPortBrokerPage', { value: true, configurable: true }); } catch (_) {}
      var PBSEQ = 0;
      var PBSEND = function () {
        var a = Array.prototype.slice.call(arguments);
        var cb = (a.length && typeof a[a.length - 1] === 'function') ? a.pop() : null;
        // Chromium treats an explicitly-undefined optional extensionId exactly
        // like an omitted extensionId. Browser abstraction layers commonly
        // preserve the positional slot and call
        // sendMessage(undefined, message, options, callback).
        var omittedExtensionId = a.length >= 2 && a[0] === undefined;
        if (omittedExtensionId) a.shift();
        var nativeArgs = a.slice();
        if (cb) nativeArgs.push(cb);
        var msg, ce = false;
        if (!omittedExtensionId && a.length >= 2 && typeof a[0] === 'string') { ce = true; msg = a[1]; } else { msg = a[0]; }
        if (ce || typeof PBconn !== 'function') {
          if (typeof PBnsend === 'function') { try { return PBnsend.apply(PBC.runtime, nativeArgs); } catch (_) {} }
          if (cb) { try { cb(undefined); } catch (_) {} return undefined; }
          return Promise.resolve(undefined);
        }
        var mid = 'pb' + (++PBSEQ);
        var dn = false;
        var resolve;
        var p = new Promise(function (r) { resolve = r; });
        var fin = function (r) { if (dn) return; dn = true; try { resolve(r); } catch (_) {} if (cb) { try { cb(r); } catch (_) {} } };
        try {
          var port = PBconn.call(PBC.runtime, { name: 'crxreq' });
          if (!port) {
            if (typeof PBnsend === 'function') { try { return PBnsend.apply(PBC.runtime, nativeArgs); } catch (_) {} }
            fin(undefined); return cb ? undefined : p;
          }
          var clean = function () { try { port.disconnect(); } catch (_) {} };
          port.onMessage.addListener(function (rp) {
            if (rp && rp.__crxBrokerResp && rp.mid === mid) { try { console.warn('[crx-portbroker-page] resp mid=' + mid); } catch (_) {} fin(rp.response); clean(); }
          });
          port.onDisconnect.addListener(function () { try { console.warn('[crx-portbroker-page] disconnect mid=' + mid + ' settled=' + dn); } catch (_) {} if (!dn) fin(undefined); });
          // sender.url: Dark Reader's messageListener only handles messages whose
          // sender.url is an allowed UI page (popup/devtools/options). Send origin
          // +pathname (hash-stripped — popup.ts appends #crxbridge=) to match the
          // page URL the SW allow-lists.
          var pbsurl = '';
          try { if (typeof location !== 'undefined') pbsurl = '' + location.origin + location.pathname; } catch (_) {}
          try { port.postMessage({ __crxBrokerReq: true, mid: mid, message: msg, senderUrl: pbsurl }); }
          catch (pe) {
            try { console.warn('[crx-portbroker-page] postMessage err ' + ((pe && pe.message) || pe)); } catch (_) {}
            if (typeof PBnsend === 'function') { try { return PBnsend.apply(PBC.runtime, nativeArgs); } catch (_) {} }
            fin(undefined); return cb ? undefined : p;
          }
          // The caller may opt a genuinely interactive request out of the
          // ordinary eight-second transport timeout. The broker itself stays
          // API-agnostic instead of maintaining a list of long-running APIs.
          var requestedTimeout = msg && msg.__crxApiRequest ? Number(msg.__crxTransportTimeoutMs) : NaN;
          var pbTimeout = Number.isFinite(requestedTimeout) && requestedTimeout >= 0 ? requestedTimeout : 8000;
          try { if (pbTimeout > 0 && typeof PBG.setTimeout === 'function') PBG.setTimeout(function () { if (!dn) { try { console.warn('[crx-portbroker-page] timeout mid=' + mid); } catch (_) {} fin(undefined); clean(); } }, pbTimeout); } catch (_) {}
          try {
            var pbCommand = msg && typeof msg === 'object' ? (msg.command || msg.type || msg.method || '') : '';
            var pbKeys = msg && typeof msg === 'object' ? Object.keys(msg).slice(0, 10).join(',') : '';
            if (__crxAutoVerbose) console.warn('[crx-portbroker-page] send mid=' + mid + ' command=' + (pbCommand || '?') + ' keys=' + pbKeys);
          } catch (_) {}
        } catch (e) {
          try { console.warn('[crx-portbroker-page] port-err ' + ((e && e.message) || e)); } catch (_) {}
          if (typeof PBnsend === 'function') { try { return PBnsend.apply(PBC.runtime, nativeArgs); } catch (_) {} }
          fin(undefined);
        }
        return cb ? undefined : p;
      };
      try { Object.defineProperty(PBC.runtime, 'sendMessage', { value: PBSEND, configurable: true, writable: true }); }
      catch (e) { try { PBC.runtime.sendMessage = PBSEND; } catch (_) {} }
      try { console.warn('[crx-portbroker-page] armed EID=' + PBC.runtime.id + ' patched=' + (PBC.runtime.sendMessage === PBSEND) + ' hasConnect=' + (typeof PBconn === 'function')); } catch (_) {}
      // Capture runtime.onMessage listeners into globalThis.__crxPageOnMsg so
      // the 'crx-page-listen' Port (below) can dispatch SW broadcasts to them.
      // Sandboxed pages (popup co-sited with the running MV3 SW) skip crx-preload
      // entirely, so the framework router never gets a runtime.onMessage frame
      // listener for this page and the SW's bg→popup push has nowhere to land.
      // Native onMessage's addListener is a locked accessor on these sandboxed
      // renderers, so try defineProperty → assignment → replace the whole
      // onMessage object. The original addListener is still called too, so any
      // native delivery path keeps working.
      var PBOM = PBC.runtime.onMessage;
      if (PBOM && typeof PBOM.addListener === 'function' && !PBC.runtime.__crxPageOnMsgPatched) {
        try {
          var pageMsgListeners = [];
          try { PBG.__crxPageOnMsg = pageMsgListeners; } catch (_) {}
          var origPBA = PBOM.addListener.bind(PBOM);
          var wrappedAdd = function (fn) {
            try { if (pageMsgListeners.indexOf(fn) === -1) pageMsgListeners.push(fn); } catch (_) {}
            try { return origPBA(fn); } catch (_) {}
          };
          var origPBR = (typeof PBOM.removeListener === 'function') ? PBOM.removeListener.bind(PBOM) : null;
          var wrappedRem = function (fn) {
            try { var pix = pageMsgListeners.indexOf(fn); if (pix >= 0) pageMsgListeners.splice(pix, 1); } catch (_) {}
            try { if (origPBR) return origPBR(fn); } catch (_) {}
          };
          var addOk = false;
          try { Object.defineProperty(PBOM, 'addListener', { value: wrappedAdd, configurable: true, writable: true }); addOk = (PBOM.addListener === wrappedAdd); } catch (_) {}
          if (!addOk) { try { PBOM.addListener = wrappedAdd; addOk = (PBOM.addListener === wrappedAdd); } catch (_) {} }
          try { if (origPBR) { Object.defineProperty(PBOM, 'removeListener', { value: wrappedRem, configurable: true, writable: true }); } } catch (_) {}
          if (!addOk) {
            try {
              var proxied = { addListener: wrappedAdd, removeListener: wrappedRem, hasListener: function (fn) { try { return pageMsgListeners.indexOf(fn) >= 0; } catch (_) { return false; } }, hasListeners: function () { return pageMsgListeners.length > 0; } };
              Object.defineProperty(PBC.runtime, 'onMessage', { value: proxied, configurable: true, writable: true });
              addOk = (PBC.runtime.onMessage === proxied);
            } catch (_) {}
          }
          try { PBC.runtime.__crxPageOnMsgPatched = addOk; } catch (_) {}
        } catch (_) {}
      }
      // Open a long-lived 'crx-page-listen' Port back to the SW. The SW saves
      // it and forwards main-process 'crx-page-broadcast' events (sent by
      // messaging.ts dispatchRuntimeMessageFromBackground) onto it. This is the
      // only runtime channel into a sandboxed popup (no ipcRenderer,
      // executeJavaScript hangs, native MV3 SW→popup doesn't deliver) — it
      // delivers bg→popup runtime.sendMessage pushes to __crxPageOnMsg.
      try {
        if (typeof PBconn === 'function') {
          var pageEventSubscriptions = PBG.__crxPageEventSubscriptions || {};
          try { PBG.__crxPageEventSubscriptions = pageEventSubscriptions; } catch (_) {}
          var PBarmPageListen = null;
          var PBschedulePageListenReconnect = function () {
            if (PBG.__crxPageListenRetryTimer || typeof PBG.setTimeout !== 'function') return;
            var attempts = Number(PBG.__crxPageListenRetryCount) || 0;
            if (attempts >= 8) return;
            try { PBG.__crxPageListenRetryCount = attempts + 1; } catch (_) {}
            var delay = Number(PBG.__crxPageListenRetryDelay) || 100;
            delay = Math.max(100, Math.min(2000, delay));
            try {
              PBG.__crxPageListenRetryTimer = PBG.setTimeout(function () {
                try { PBG.__crxPageListenRetryTimer = null; } catch (_) {}
                try { PBG.__crxPageListenRetryDelay = Math.min(2000, delay * 2); } catch (_) {}
                try { if (typeof PBarmPageListen === 'function') PBarmPageListen(); } catch (_) { PBschedulePageListenReconnect(); }
              }, delay);
            } catch (_) {
              try { PBG.__crxPageListenRetryTimer = null; } catch (_) {}
            }
          };
          try { PBG.__crxPageEventSubscribe = function (eventName) {
            if (!eventName || pageEventSubscriptions[eventName]) return;
            pageEventSubscriptions[eventName] = true;
            var currentPort = PBG.__crxPageListenPort;
            try { if (currentPort) currentPort.postMessage({ __crxPageEventSubscribe: true, eventName: eventName }); } catch (_) {}
          }; } catch (_) {}
          try { PBG.__crxPageEventUnsubscribe = function (eventName) {
            if (!eventName || !pageEventSubscriptions[eventName]) return;
            try { delete pageEventSubscriptions[eventName]; } catch (_) {}
            var currentPort = PBG.__crxPageListenPort;
            try { if (currentPort) currentPort.postMessage({ __crxPageEventUnsubscribe: true, eventName: eventName }); } catch (_) {}
          }; } catch (_) {}
          PBarmPageListen = function () {
            if (PBG.__crxPageListenArmed) return;
            try { PBG.__crxPageListenArmed = true; } catch (_) {}
            var isOffscreenPage = false;
            try { isOffscreenPage = location && location.pathname === '/offscreen.html'; } catch (_) {}
            var pListen = null;
            try { pListen = PBconn.call(PBC.runtime, { name: 'crx-page-listen' + (isOffscreenPage ? ':offscreen' : '') }); } catch (_) {}
            if (!pListen || !pListen.onMessage) {
              try { PBG.__crxPageListenArmed = false; } catch (_) {}
              PBschedulePageListenReconnect();
              return;
            }
            try { PBG.__crxPageListenPort = pListen; } catch (_) {}
            for (var subscribedEventName in pageEventSubscriptions) {
              if (!Object.prototype.hasOwnProperty.call(pageEventSubscriptions, subscribedEventName)) continue;
              try { pListen.postMessage({ __crxPageEventSubscribe: true, eventName: subscribedEventName }); } catch (_) {}
            }
            pListen.onMessage.addListener(function (msg) {
               try {
                 try { PBG.__crxPageListenRetryCount = 0; PBG.__crxPageListenRetryDelay = 100; } catch (_) {}
                 if (msg && msg.__crxPageListenReady) return;
                 if (msg && msg.__crxPageEvent && typeof msg.eventName === 'string') {
                   var dispatch = PBG.__crxPageEventDispatch;
                   if (typeof dispatch === 'function') dispatch(msg.eventName, Array.isArray(msg.args) ? msg.args : []);
                   return;
                 }
                 var L = PBG.__crxPageOnMsg || [];
                var m = (msg && typeof msg === 'object' && msg.message !== undefined) ? msg.message : msg;
                var s = (msg && typeof msg === 'object' && msg.sender) ? msg.sender : { id: PBC.runtime.id };
                if (msg && msg.__crxOffscreenPageRequest && msg.requestId) {
                  var done = false, asyncPending = false;
                  var respond = function (value) {
                    if (done) return;
                    done = true;
                    try { pListen.postMessage({ __crxOffscreenPageResponse: true, requestId: msg.requestId, response: value }); } catch (_) {}
                  };
                  for (var ri = 0; ri < L.length; ri++) {
                    var result;
                    try { result = L[ri](m, s, respond); } catch (_) { result = undefined; }
                    if (result === true) asyncPending = true;
                    else if (result && typeof result.then === 'function') {
                      asyncPending = true;
                      try { Promise.resolve(result).then(respond, function () { respond(undefined); }); } catch (_) { respond(undefined); }
                    } else if (result !== undefined && result !== false && !done) respond(result);
                  }
                  if (!asyncPending && !done) respond(undefined);
                  if (asyncPending) setTimeout(function () { respond(undefined); }, 30000);
                  return;
                }
                for (var li = 0; li < L.length; li++) {
                  try { L[li](m, s, function () { return true }); } catch (_) {}
                }
              } catch (_) {}
            });
            if (pListen.onDisconnect) pListen.onDisconnect.addListener(function () {
              if (PBG.__crxPageListenPort !== pListen) return;
              try { PBG.__crxPageListenPort = null; } catch (_) {}
              try { PBG.__crxPageListenArmed = false; } catch (_) {}
              try { void PBC.runtime.lastError; } catch (_) {}
              try { if (__crxAutoVerbose) console.warn('[crx-portbroker-page] page-listen disconnected; reconnecting'); } catch (_) {}
              PBschedulePageListenReconnect();
            });
            try { if (typeof PBG.__crxPageEventReady === 'function') PBG.__crxPageEventReady(); } catch (_) {}
            try { if (typeof PBG.__crxPageEventInstall === 'function') PBG.__crxPageEventInstall(); } catch (_) {}
            try { console.warn('[crx-portbroker-page] page-listen armed'); } catch (_) {}
          };
          PBarmPageListen();
          }
      } catch (_) {}
    }
  } catch (_) {}` +
  // Sandboxed ext-page i18n fallback (popup/options whose renderer boots
  // sandboxed when co-sited with the MV3 SW host, or after a render-process-
  // gone rebuild). In that state crx-preload never runs, so chrome.i18n
  // .getMessage stays Electron's NATIVE impl and resolves to default_locale
  // 'en'. Sync-XHR the extension's _locales catalog for navigator.language
  // and install a catalog-backed getMessage/getUILanguage. If the earliest
  // page-head pass runs before chrome/runtime are fully ready, self-retry for
  // a short window instead of requiring the whole shim to re-run.
  `try{var NG=(typeof globalThis!=='undefined'&&globalThis)||(typeof self!=='undefined'&&self)||this;var NP=(typeof location!=='undefined'&&location&&location.protocol)||'';var NInstallI18n=function(){try{var NC=(typeof chrome!=='undefined'&&chrome)||(NG&&NG.chrome);var NGM=NC&&NC.i18n&&typeof NC.i18n.getMessage==='function'?String(NC.i18n.getMessage):'';` +
  `if(!(NC&&NC.i18n&&NC.runtime&&NC.runtime.id&&NGM.indexOf('[native code]')>=0&&NP==='chrome-extension:'&&!NG.__crxI18nShim))return !!(NG&&NG.__crxI18nShim);try{Object.defineProperty(NG,'__crxI18nShim',{value:1,configurable:true})}catch(_){}var NExtId=NC.runtime.id;var NL=(typeof navigator!=='undefined'&&navigator.language)||'en-US';var NCands=[];(function(c){if(!c)return;var u=c.replace('-','_');if(NCands.indexOf(u)<0)NCands.push(u);var s=c.split(/[-_]/)[0];if(s&&NCands.indexOf(s)<0)NCands.push(s)})(NL);try{var NMan=NC.runtime.getManifest?NC.runtime.getManifest():null;var NDef=(NMan&&NMan.default_locale)||'';if(NDef){var nd=NDef.replace('-','_');if(NCands.indexOf(nd)<0)NCands.push(nd)}}catch(_){}if(NCands.indexOf('en')<0)NCands.push('en');` +
  // Service workers have no XMLHttpRequest: there the catalog is filled by an
  // async fetch (candidates merged in priority order). Until it lands, lookups
  // fall through to native getMessage (default_locale), which is how a
  // Tampermonkey SW-built popup used to stay English.
  `var NMsgs={};var NUrlOf=function(c){var NLoc='_locales/'+c+'/messages.json';return (NC&&NC.runtime&&typeof NC.runtime.getURL==='function')?NC.runtime.getURL(NLoc):(NP==='chrome-extension:'?'/'+NLoc:NLoc)};var NMerge=function(raw){if(!raw||typeof raw!=='object')return;for(var k in raw){var lk=k.toLowerCase();if(!(lk in NMsgs)&&raw[k]&&typeof raw[k].message==='string'){NMsgs[lk]=raw[k]}}};` +
  `if(typeof XMLHttpRequest!=='undefined'){for(var i=0;i<NCands.length;i++){try{var xhr=new XMLHttpRequest();xhr.open('GET',NUrlOf(NCands[i]),false);xhr.send();if(xhr.status===200&&xhr.responseText){NMerge(JSON.parse(xhr.responseText))}}catch(_){}}}else if(typeof fetch==='function'){try{Promise.all(NCands.map(function(c){return fetch(NUrlOf(c)).then(function(r){return r&&r.ok?r.text():null}).then(function(t){return t?JSON.parse(String(t).replace(/^\\uFEFF/,'')):null}).catch(function(){return null})})).then(function(list){for(var j=0;j<list.length;j++)NMerge(list[j]);try{console.warn('[crx-i18n-shim] async catalog ext='+NExtId+' msgs='+Object.keys(NMsgs).length)}catch(_){}})}catch(_){}}` +
  `var NSubst=function(entry,subs){var msg=String(entry.message==null?'':entry.message);var placeholders=entry.placeholders||{};msg=msg.replace(/\\$([a-zA-Z0-9_@]+)\\$/g,function(m,pname){var ph=placeholders[pname.toLowerCase()];return ph&&ph.content!=null?ph.content:m});var args=subs==null?[]:Array.isArray(subs)?subs:[subs];msg=msg.replace(/\\$(\\$|[1-9])/g,function(m,p){if(p==='$')return '$';var v=args[parseInt(p,10)-1];return v==null?'':String(v)});return msg};` +
  `var NNativeGet=NC.i18n.getMessage?NC.i18n.getMessage.bind(NC.i18n):null;NC.i18n.getMessage=function(messageName,substitutions){var n=String(messageName||'');if(n==='@@extension_id')return NExtId||'';if(n==='@@ui_locale')return (NL||'en').replace('-','_');var entry=NMsgs[n.toLowerCase()];if(entry)return NSubst(entry,substitutions);if(NNativeGet){try{return NNativeGet(messageName,substitutions)}catch(_){}}return ''};try{NC.i18n.getUILanguage=function(){return NL||'en-US'}}catch(_){}try{if(!NC.i18n.getAcceptLanguages)NC.i18n.getAcceptLanguages=function(cb){var r=[NL||'en-US'];if(cb){try{cb(r)}catch(_){}}return Promise.resolve(r)}}catch(_){}try{console.warn('[crx-i18n-shim] installed ext='+NExtId+' locale='+NL+' msgs='+Object.keys(NMsgs).length)}catch(_){}return true}catch(_){return false}};` +
  `if(!NInstallI18n()&&NP==='chrome-extension:'&&!NG.__crxI18nRetry){try{Object.defineProperty(NG,'__crxI18nRetry',{value:1,configurable:true,writable:true})}catch(_){NG.__crxI18nRetry=1}var NTry=0,NLoop=function(){if(NInstallI18n()||++NTry>40){try{delete NG.__crxI18nRetry}catch(_){NG.__crxI18nRetry=0}return}try{setTimeout(NLoop,50)}catch(_){}};try{setTimeout(NLoop,50)}catch(_){}}}catch(_){}` +
  // mainWorldScript normally performs this synchronization. Keep the same
  // Chrome 148+ child-namespace identity when an extension page misses its
  // preload and runs only this source shim. Do this before permission-specific
  // blocks that can return early; the native browser root itself survives.
  `try{var BSG=(typeof globalThis!=='undefined'&&globalThis)||(typeof self!=='undefined'&&self)||this,` +
  `BSC=(typeof chrome!=='undefined'&&chrome)||(BSG&&BSG.chrome),BSB=BSG&&BSG.browser,BSM=null,BSV=0;try{BSM=BSC&&BSC.runtime&&typeof BSC.runtime.getManifest==='function'?BSC.runtime.getManifest():null}catch(_){}try{var BSVM=String(BSG&&BSG.navigator&&BSG.navigator.userAgent||'').match(/(?:Chrome|Chromium)\\/(\\d+)/);BSV=BSVM?Number(BSVM[1]):0}catch(_){}` +
  `if(BSC&&BSB&&BSB!==BSC&&BSM&&BSM.manifest_version===3&&!(BSM.devtools_page&&BSV>=148&&BSV<152)){Object.getOwnPropertyNames(BSC).forEach(function(k){if(k.indexOf('__crx')===0)return;var v;try{v=BSC[k];if(BSB[k]===v)return}catch(_){return}try{Object.defineProperty(BSB,k,{value:v,configurable:true,enumerable:true,writable:true})}catch(_){try{BSB[k]=v}catch(_){}}})}}catch(_){}` +
  // Electron exposes storage.sync/managed as present-but-throwing areas. Map
  // them to local so extensions degrade like a single-profile Chrome build.
  // Also delay successful set completion by one task. Electron can resolve a
  // frame's storage.set Promise before another extension context receives the
  // matching storage.onChanged event. A foreground page that immediately sends
  // a runtime message can therefore make the background observe stale state
  // (Bitwarden's loggedIn message raced its active-account write). Chrome makes
  // that write visible before the dependent message path continues.
  // Electron 43 can omit both global and StorageArea onChanged events entirely.
  // Synthesize the standard records and relay page writes to the MV3 worker so
  // long-lived extension state services observe login/account changes.
  // Electron can also briefly report an empty local area while a new MV3 worker
  // is hydrating its persistent store. Share a bounded startup probe and retain
  // relayed values briefly, avoiding repeated full-area reads on large stores.
  `try{` +
  `var c=(typeof chrome!=='undefined'&&chrome)||(typeof self!=='undefined'&&self.chrome)||(typeof globalThis!=='undefined'&&globalThis.chrome);` +
  `if(!c||!c.storage)return;` +
  `var st=c.storage,local;try{local=st.local}catch(e){return}if(!local)return;` +
  `var ses;try{ses=st.session}catch(e){}var onc;try{onc=st.onChanged}catch(e){}` +
  `var fire=function(changes,areaName){var area;try{area=st[areaName]}catch(_){}try{var getter=area&&area.get;if(getter&&typeof getter.__crxApplyChanges==='function')getter.__crxApplyChanges(changes)}catch(_){}try{if(area&&area.onChanged&&typeof area.onChanged.dispatch==='function')area.onChanged.dispatch(changes)}catch(_){}try{if(onc&&typeof onc.dispatch==='function')onc.dispatch(changes,areaName)}catch(_){}};` +
  `var worker=typeof document==='undefined',relay=function(changes,areaName){if(worker)return;try{var rt=c.runtime;if(!rt||typeof rt.sendMessage!=='function')return;var out=rt.sendMessage({__crxStorageSyntheticChange:true,area:areaName,changes:changes});if(out&&typeof out.then==='function')out.catch(function(){return undefined})}catch(_){}};` +
  `try{var rt=c.runtime,G=(typeof globalThis!=='undefined'&&globalThis)||(typeof self!=='undefined'&&self)||this;if(worker&&rt&&rt.onMessage&&typeof rt.onMessage.addListener==='function'&&!G.__crxStorageSyntheticReceiver){try{Object.defineProperty(G,'__crxStorageSyntheticReceiver',{value:1,configurable:true})}catch(_){G.__crxStorageSyntheticReceiver=1}rt.onMessage.addListener(function(message,sender,respond){if(!message||message.__crxStorageSyntheticChange!==true)return;fire(message.changes||{},message.area||'local');try{respond({__crxStorageSyntheticAck:true})}catch(_){}})}}catch(_){}` +
  `var guardGet=function(area){if(!area||typeof area.get!=='function'||area.get.__crxHydrationGuard)return;var orig=area.get.bind(area),started=Date.now(),hydration,hydrated=false,overlayTimer,overlay=Object.create(null),read=function(keys){try{var out=orig(keys);return out&&typeof out.then==='function'?Promise.resolve(out):Promise.resolve(out||{})}catch(e){return Promise.reject(e)}},canFull=function(){return new Promise(function(resolve){var fn=area.getBytesInUse;if(typeof fn!=='function'){resolve(false);return}var settled=false,timer,finish=function(bytes){if(settled)return;settled=true;try{clearTimeout(timer)}catch(_){}resolve(typeof bytes==='number'&&Number.isFinite(bytes)&&bytes<=8388608)};timer=setTimeout(function(){finish(undefined)},100);try{var out=fn.call(area,null,finish);if(out&&typeof out.then==='function')out.then(finish,function(){finish(undefined)});else if(typeof out==='number')finish(out)}catch(_){finish(undefined)}})},empty=function(value){return !!value&&typeof value==='object'&&Object.keys(value).length===0},merge=function(keys,result,source){var list=typeof keys==='string'?[keys]:keys,out=result,added=false;for(var i=0;i<list.length;i++){var key=list[i];if(!Object.prototype.hasOwnProperty.call(result,key)&&Object.prototype.hasOwnProperty.call(source,key)){if(!added){out={};for(var k in result)if(Object.prototype.hasOwnProperty.call(result,k))out[k]=result[k]}out[key]=source[key];added=true}}return out},overlayValues=function(){var now=Date.now(),values=Object.create(null);for(var key in overlay)if(Object.prototype.hasOwnProperty.call(overlay,key)){if(overlay[key].expiresAt<=now)delete overlay[key];else values[key]=overlay[key].value}return values},cleanup=function(){overlayTimer=undefined;var now=Date.now(),next=Infinity;for(var key in overlay)if(Object.prototype.hasOwnProperty.call(overlay,key)){if(overlay[key].expiresAt<=now)delete overlay[key];else next=Math.min(next,overlay[key].expiresAt)}if(next!==Infinity)overlayTimer=setTimeout(cleanup,Math.max(0,next-now))},probe=function(){if(hydration)return hydration;if(hydrated)return Promise.resolve({});var attempts=0,run=function(){return canFull().then(function(allowed){if(!allowed)return {};return read(null).then(function(all){if(!empty(all)||++attempts>=3)return all;return new Promise(function(resolve){setTimeout(resolve,50)}).then(run)})})};hydration=run().then(function(all){hydrated=true;hydration=undefined;return all},function(error){hydration=undefined;throw error});return hydration},load=function(keys){return read(keys).then(function(result){var specific=typeof keys==='string'||(Array.isArray(keys)&&keys.length>0);if(!specific)return result;var list=typeof keys==='string'?[keys]:keys,missing=false;for(var i=0;i<list.length;i++)if(!Object.prototype.hasOwnProperty.call(result,list[i])){missing=true;break}if(!missing)return result;var recovered=merge(keys,result,overlayValues());if(recovered!==result||Date.now()-started>500)return recovered;return probe().then(function(all){return merge(keys,result,all)})})},next=function(keys,cb){var out=load(keys);if(typeof cb==='function'){out.then(function(value){try{cb(value)}catch(_){}},function(){try{cb({})}catch(_){}});return undefined}return out};try{Object.defineProperty(next,'__crxHydrationGuard',{value:true,configurable:true});Object.defineProperty(next,'__crxRawGet',{value:read,configurable:true});Object.defineProperty(next,'__crxApplyChanges',{value:function(changes){var expiresAt=Date.now()+2000;for(var key in changes)if(Object.prototype.hasOwnProperty.call(changes,key)){var change=changes[key];if(change&&Object.prototype.hasOwnProperty.call(change,'newValue'))overlay[key]={value:change.newValue,expiresAt:expiresAt};else delete overlay[key]}if(!overlayTimer&&Object.keys(overlay).length)overlayTimer=setTimeout(cleanup,2000)},configurable:true})}catch(_){}try{area.get=next}catch(_){}if(area.get!==next){try{Object.defineProperty(area,'get',{value:next,configurable:true,writable:true})}catch(_){}}};guardGet(local);` +
  `var wrap=function(area,areaName){if(!area||typeof area.set!=='function'||area.set.__crxVisibilityBarrier)return;var orig=area.set.bind(area),call=function(items){return new Promise(function(resolve,reject){var done=false,ok=function(value){if(done)return;done=true;resolve(value)},bad=function(error){if(done)return;done=true;reject(error)};try{var out=orig(items,function(){ok(undefined)});if(out&&typeof out.then==='function')out.then(ok,bad);else if(out!==undefined)ok(out)}catch(e){bad(e)}})},perform=function(items){var keys=[];try{keys=Object.keys(items||{})}catch(_){}var before=Promise.resolve({});try{if(keys.length&&typeof area.get==='function'){var getter=typeof area.get.__crxRawGet==='function'?area.get.__crxRawGet:area.get.bind(area),got=getter(keys);if(got&&typeof got.then==='function')before=got.catch(function(){return {}});else before=Promise.resolve(got||{})}}catch(_){}return before.then(function(old){return call(items).then(function(value){var changes={};for(var i=0;i<keys.length;i++){var key=keys[i],change={newValue:items[key]};if(old&&Object.prototype.hasOwnProperty.call(old,key))change.oldValue=old[key];changes[key]=change}if(keys.length)fire(changes,areaName);relay(changes,areaName);return new Promise(function(resolve){setTimeout(function(){resolve(value)},0)})})})},next=function(items,cb){var out=perform(items);if(typeof cb==='function'){out.then(function(){try{cb()}catch(_){}},function(){try{cb()}catch(_){}});return undefined}return out};try{Object.defineProperty(next,'__crxVisibilityBarrier',{value:true,configurable:true})}catch(_){}try{area.set=next}catch(_){}if(area.set!==next){try{Object.defineProperty(area,'set',{value:next,configurable:true,writable:true})}catch(_){}}};wrap(local,'local');wrap(ses,'session');` +
  // storage.managed: Chrome without enterprise policy exposes an EMPTY read-only
  // area. Aliasing it to local made extensions read their own data as policy.
  `var MG;try{var MGC=st.managed;if(MGC&&MGC.__crxManagedEmpty)MG=MGC}catch(_){}if(!MG){var MGV=function(v){return function(){var cb=arguments[arguments.length-1];if(typeof cb==='function'){try{cb(v)}catch(_){}return undefined}return Promise.resolve(v)}},MGR=function(){var cb=arguments[arguments.length-1],m='This is a read-only store.';if(typeof cb==='function'){try{Object.defineProperty(c.runtime,'lastError',{value:{message:m},configurable:true})}catch(_){}try{cb()}catch(_){}try{delete c.runtime.lastError}catch(_){}return undefined}return Promise.reject(new Error(m))};MG={__crxManagedEmpty:true,get:MGV({}),getBytesInUse:MGV(0),getKeys:MGV([]),set:MGR,remove:MGR,clear:MGR,setAccessLevel:MGR,onChanged:{addListener:function(){},removeListener:function(){},hasListener:function(){return false},hasListeners:function(){return false}}}}` +
  `var need=false;` +
  `[['sync',local],['managed',MG]].forEach(function(pair){var a=pair[0],val=pair[1];` +
  `var cur;try{cur=st[a]}catch(e){cur=undefined}` +
  `if(cur===val)return;` +
  `try{Object.defineProperty(st,a,{value:val,configurable:true,enumerable:true,writable:true})}` +
  `catch(e){need=true}});` +
  `if(need){try{var ns={local:local};if(ses)ns.session=ses;if(onc)ns.onChanged=onc;ns.sync=local;ns.managed=MG;` +
  `Object.defineProperty(c,'storage',{value:ns,configurable:true,enumerable:true,writable:true})}` +
  `catch(e){}}` +
  `}catch(e){}` +
  // beforeload polyfill: Chromium doesn't fire the non-standard 'beforeload'
  // event (WebKit/Safari private). IDM's content sc handler (case 25) listens
  // for it on document (capture) to detect <video>/<audio>/<object>/<embed>
  // loading — the ONLY video-detection path for generic sites (this.A=0,
  // where ha() MutationObserver scanning is skipped because `if(this.A)` is
  // falsy). Without it, generic-site video is never detected -> no IDM desktop
  // overlay button. Synthesize 'beforeload' on media-element insertion +
  // src/data change. Runs in this isolated world (same as sc), so the dispatch
  // reaches sc (main-world dispatch is dropped as an untrusted synthetic event
  // by isolated listeners).
  `try{if(typeof document!=='undefined'){` +
  `var crxBLT=['video','audio','object','embed'];` +
  `var crxBLD=function(el){if(!el||el.nodeType!==1)return;if(crxBLT.indexOf(el.localName)<0)return;var u='';try{u=el.src||el.data||el.currentSrc||''}catch(_){}if(!u){try{var s=el.querySelector('source[src]');if(s)u=s.src}catch(_){}}if(!u)return;try{var ev=new Event('beforeload',{bubbles:false,cancelable:true});Object.defineProperty(ev,'url',{value:u,configurable:true});el.dispatchEvent(ev)}catch(_){}};` +
  `var crxBLS=function(r){if(!r)return;try{if(r.nodeType===1){if(crxBLT.indexOf(r.localName)>=0)crxBLD(r);var ss=r.querySelectorAll('video,audio,object,embed');if(ss)for(var i=0;i<ss.length;i++)crxBLD(ss[i])}}catch(_){}};` +
  `try{crxBLS(document.documentElement||document)}catch(_){}` +
  `try{var crxBLO=new MutationObserver(function(ms){for(var i=0;i<ms.length;i++){var m=ms[i];if(m.type==='childList'){for(var j=0;j<m.addedNodes.length;j++)crxBLS(m.addedNodes[j])}else if(m.type==='attributes'&&m.target&&m.target.nodeType===1&&crxBLT.indexOf(m.target.localName)>=0){crxBLD(m.target)}}});crxBLO.observe(document.documentElement||document,{childList:true,subtree:true,attributes:true,attributeFilter:['src','data']})}catch(_){}` +
  `}}catch(_){}` +
  `})();\n`).replace(/console\.warn/g, '__crxWarn');
// Marker = prefix + short hash of the shim body. Because it's derived from the
// body, editing SHIM_BODY automatically changes the marker, so the
// `startsWith(MARKER)` idempotency check below re-patches any file carrying an
// older body — no manual version bump needed.
const SHIM_VERSION = createHash('sha256')
  .update(SHIM_BODY)
  .digest('hex')
  .slice(0, 12);
// Increment when the on-disk layout/injection algorithm changes without a
// SHIM_BODY edit. Version 3 normalizes extension-root paths such as
// "/js/background.js" before path.resolve; on Windows those previously escaped
// to the drive root and the MV3 service worker was silently left unpatched.
const PATCH_FORMAT_VERSION = 3;
const PATCH_STATE_VERSION = `${SHIM_VERSION}:${PATCH_FORMAT_VERSION}`;
const MARKER = `${MARKER_PREFIX}_${SHIM_VERSION}__*/`;
// The separator belongs to the shim block so stripping a patched file cannot
// leave an extra semicolon behind before the next repatch.
const SHIM = `${MARKER};${SHIM_BODY}`;

// Match one leading shim block so the patcher can strip ALL of them (current,
// any prior version, AND orphaned bodies). A shim is `(function(){…})();\n`,
// optionally preceded by the marker comment. The body has NO internal `})();`,
// so the non-greedy `[\s\S]*?` stops at the shim's own terminator (the FIRST
// `})();` — which for a pretty-printed multi-line body is still the terminator,
// since this body only uses `}catch(e){}`-style closers).
//
// SHIM_BLOCK_ORPHAN exists because an OLDER SHIM_BODY was multi-line
// (pretty-printed), and the old line-based stripper removed only the marker
// line — leaving the old shim BODY embedded as "content" right after the new
// shim. The orphan branch keys on the shim's invariant first statement
// `(function(){try{var GB=` so a real extension IIFE at the start of a file is
// never mistaken for a shim. `[^*]*\*\/` matches the marker comment regardless
// of its trailing underscores.
// Marker-led shim block. `\s*` between `*/` and `(function` lets it match BOTH
// the minified form (marker+body on one line) AND the pretty-printed form where
// the marker sits alone on its own line and `(function () {` starts the next.
// The non-greedy `[\s\S]*?` stops at the shim's own `})();` terminator: nested
// IIFEs inside the body (sendMessage/connect are `(function(){…})()`) terminate
// with `})()` followed by `,`/`}`, never `})();`, so they are never matched.
const SHIM_BLOCK_MARKER_LED =
  /^\/\*__crx_storage_sync_shim_[^*]*\*\/\s*;?\s*\(function\s*\(\s*\)\s*\{[\s\S]*?\}\s*\)\s*\(\s*\)\s*;\r?\n/;
// Unanchored + global: strips marker-led shim blocks ANYWHERE in the file, not
// just at the start. Older line-based patchers removed only the marker line and
// left a prior-version shim BODY embedded mid-file (pretty-printed) — that
// orphan is unreachable by a leading-only stripper. The marker is unique to our
// shim, so this never touches real extension code.
const SHIM_BLOCK_MARKER_ANYWHERE =
  /\/\*__crx_storage_sync_shim_[^*]*\*\/\s*;?\s*\(function\s*\(\s*\)\s*\{[\s\S]*?\}\s*\)\s*\(\s*\)\s*;\r?\n/g;
// Historical bug chain, newest to oldest:
//   1. marker-only strip left a full pretty-printed shim body at the file start;
//   2. later regexes stripped the marker-led current shim, but could still leave
//      a marker-less BODY fragment whose opening wrapper had already been eaten,
//      so the file now started with plain `try { var SBG = ...` and ended with
//      one or more dangling `}catch(_){}})();` lines.
// Those remnants are always at the START of the file and contain multiple
// shim-only signatures (`__crx*`, `crx-msg`, etc). Strip greedily through the
// LAST shim-tail terminator near the front of the file, but only when the
// prefix clearly looks like our shim so real extension code is untouched.
const SHIM_ORPHAN_HEAD =
  /^(?:\uFEFF)?\s*(?:\(function\s*\(\s*\)\s*\{\s*)?try\s*\{/;
const SHIM_ORPHAN_TAIL = /\}\s*catch\s*\([^)]*\)\s*\{\}\}\)\(\)\s*;\r?\n?/g;
const SHIM_DANGLING_TAILS =
  /^(?:\uFEFF)?(?:\}\s*catch\s*\([^)]*\)\s*\{\}\}\)\(\)\s*;\r?\n?)+/;
const SHIM_ORPHAN_SIGNATURES = [
  '__crx',
  '[crx-',
  'crx-msg',
  'invokeExtension',
  '__idm_obs__',
  'chrome-extension:',
];

function looksLikeShimOrphan(prefix: string): boolean {
  let hits = 0;
  for (const sig of SHIM_ORPHAN_SIGNATURES) {
    if (prefix.includes(sig) && ++hits >= 2) return true;
  }
  return false;
}

function stripLeadingShimOrphans(s: string): string {
  for (;;) {
    const dangling = s.match(SHIM_DANGLING_TAILS);
    if (dangling) {
      s = s.slice(dangling[0].length);
      continue;
    }
    if (!SHIM_ORPHAN_HEAD.test(s)) break;
    let cut = -1;
    SHIM_ORPHAN_TAIL.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SHIM_ORPHAN_TAIL.exec(s)) !== null) {
      if (m.index > 300_000) break; // shim remnants are only ever near the front
      const end = m.index + m[0].length;
      if (looksLikeShimOrphan(s.slice(0, end))) cut = end;
    }
    if (cut < 0) break;
    s = s.slice(cut);
  }
  return s;
}

function stripLeadingShims(s: string): string {
  // First remove EVERY marker-led shim block anywhere in the file (current,
  // prior-version, AND mid-file orphans), then prepend the current SHIM below.
  s = s.replace(SHIM_BLOCK_MARKER_ANYWHERE, '');
  // Then strip any leading marker-less shim body remnants left by older
  // patchers. These only ever survive at the file start.
  return stripLeadingShimOrphans(s);
}

// Keep a source file's directive prologue (most importantly "use strict") at
// the beginning of the script. A prepended shim would otherwise turn the
// original bundle into sloppy mode, which changes the `this` value observed by
// its helper functions and can make extension state recursively contain the
// global object. This scanner intentionally handles only the lexical forms
// needed at the start of a JavaScript file; it does not attempt to parse the
// rest of the program.
function injectShimPreservingDirectives(source: string): string {
  const findLineEnd = (from: number): number => {
    const match = /[\r\n]/u.exec(source.slice(from));
    return match ? from + match.index : -1;
  };
  let offset = source.charCodeAt(0) === 0xfeff ? 1 : 0;

  // A hashbang must remain the first line of a script. Node-style extension
  // bundles occasionally retain one even though Chromium normally ignores it.
  if (source.slice(offset, offset + 2) === '#!') {
    const lineEnd = findLineEnd(offset + 2);
    if (lineEnd < 0) return source + `\n` + SHIM;
    offset = lineEnd;
    if (source[offset] === '\r' && source[offset + 1] === '\n') offset += 2;
    else offset += 1;
  }

  let cursor = offset;
  let directiveEnd = -1;

  for (;;) {
    // Whitespace and comments are allowed between directive statements.
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
      if (/\s/u.test(ch)) {
        cursor += 1;
        continue;
      }
      break;
    }

    const quote = source[cursor];
    if (quote !== '"' && quote !== "'") break;

    let end = cursor + 1;
    let closed = false;
    for (; end < source.length; end += 1) {
      const ch = source[end];
      if (ch === '\\') {
        end += 1; // escaped character or a line continuation
        continue;
      }
      if (ch === quote) {
        end += 1;
        closed = true;
        break;
      }
      if (ch === '\r' || ch === '\n' || ch === '\u2028' || ch === '\u2029') break;
    }
    if (!closed) break;

    // A directive ends at a semicolon, a line terminator (ASI), or EOF. A
    // block/comment sequence without a line break still belongs to the same
    // statement, so `"a" /*x*/ "b"` is correctly rejected as a directive.
    let probe = end;
    let statementEnd = -1;
    for (;;) {
      if (probe >= source.length) {
        statementEnd = source.length;
        cursor = source.length;
        break;
      }
      const ch = source[probe];
      if (ch === ';') {
        probe += 1;
        statementEnd = probe;
        cursor = probe;
        break;
      }
      if (ch === '\r' || ch === '\n' || ch === '\u2028' || ch === '\u2029') {
        if (ch === '\r' && source[probe + 1] === '\n') probe += 2;
        else probe += 1;
        statementEnd = probe;
        cursor = probe;
        break;
      }
      if (ch === '/' && source[probe + 1] === '/') {
        const lineEnd = findLineEnd(probe + 2);
        if (lineEnd < 0) {
          statementEnd = source.length;
          cursor = source.length;
          break;
        }
        probe = lineEnd;
        continue;
      }
      if (ch === '/' && source[probe + 1] === '*') {
        const commentEnd = source.indexOf('*/', probe + 2);
        if (commentEnd < 0) {
          break;
        }
        if (/[\r\n\u2028\u2029]/u.test(source.slice(probe, commentEnd + 2))) {
          statementEnd = commentEnd + 2;
          cursor = statementEnd;
          break;
        }
        probe = commentEnd + 2;
        continue;
      }
      if (ch === ' ' || ch === '\t' || ch === '\v' || ch === '\f') {
        probe += 1;
        continue;
      }
      // No statement terminator: this is ordinary code, not a directive.
      break;
    }

    if (statementEnd < 0) break;
    directiveEnd = statementEnd;
    if (cursor >= source.length) break;
  }

  const insertionPoint = directiveEnd >= 0 ? directiveEnd : offset;
  return source.slice(0, insertionPoint) + SHIM + source.slice(insertionPoint);
}

// ---- HTML <head> injection via external crx-shim.js -----------------------
// In addition to prepending the shim to every JS entry, write a single
// crx-shim.js at the extension root and reference it from a <script src> tag
// injected as the FIRST <head> child of every extension HTML page. The classic
// <script src> (no async/defer) is parser-blocking, so it runs before any other
// inline or external script on the page — the shim is in place before ANY
// extension code, closing the gap for inline <script> blocks and dynamically-
// injected scripts that aren't in the JS entry list. The top-level
// __crxShimInstalled guard above means the per-JS-file prepend (still present
// on every entry JS) no-ops in HTML-page contexts, so the two paths never
// double-install.
//
// External file (not inline <script>) because:
//   • CSP-safe: script-src 'self' always allows same-origin crx-shim.js, so
//     this works even if a future Electron/vendored layer starts enforcing
//     manifest CSP on chrome-extension: pages (inline <script> would not).
//   • Simplest: the HTML injection is a short, stable one-liner; future SHIM
//     edits only touch crx-shim.js (re-patched like any JS entry), never the
//     HTML. No '</script>'/newline edge cases.
// '/' resolves to the extension root for every chrome-extension:// page
// regardless of the page's subdir, so the same path works everywhere.
// Chrome reserves extension package entries whose names start with '_'. The
// legacy name triggered an ExtensionLoadWarning on every load and is removed
// during migration.
const SHIM_FILE = 'crx-shim.js';
const LEGACY_SHIM_FILE = '__crx_shim.js';
const HTML_MARKER_PREFIX = '<!--__crx_html_shim';
const HTML_MARKER = `${HTML_MARKER_PREFIX}_${SHIM_VERSION}__-->`;
const HTML_SHIM_BLOCK = `${HTML_MARKER}<script src="/${SHIM_FILE}"></script>\n`;
// Match an HTML shim block (any version) ANYWHERE. Eats the LEADING newline
// (injectHtmlHeadShim inserts "\n" + block after <head>) and ONE trailing
// newline (HTML_SHIM_BLOCK ends with "\n"), so strip + re-inject is stable
// across runs. The body matches BOTH the current external-file form
// (including the legacy <script src="/__crx_shim.js"></script>) AND any
// prior-version inline form
// (<script>…body…</script>) — the non-greedy [^]*? stops at the first
// </script>, which is always our own tag (SHIM_BODY has no '</script>'). This
// lets the migration from a prior inline block happen automatically: the old
// block is stripped and the new <script src> tag injected on the next patch.
// Global so a single replace strips every prior-version block in one pass.
const HTML_BLOCK_ANYWHERE =
  /\r?\n?<!--__crx_html_shim_[a-f0-9]*__-->\s*<script\b[^]*?<\/script>\r?\n?/g;

// Strip every HTML shim block (current + any prior version), then inject the
// current block as the first <head> child. Falls back to <html> (synthesizing a
// <head>) or to the document start. Returns the original string unchanged when
// the file already carries exactly the current block (idempotent — no rewrite).
function injectHtmlHeadShim(html: string): string {
  const stripped = html.replace(HTML_BLOCK_ANYWHERE, '');
  const headMatch = stripped.match(/<head\b[^>]*>/i);
  if (headMatch && headMatch.index !== undefined) {
    const idx = headMatch.index + headMatch[0].length;
    return (
      stripped.slice(0, idx) + '\n' + HTML_SHIM_BLOCK + stripped.slice(idx)
    );
  }
  const htmlTagMatch = stripped.match(/<html\b[^>]*>/i);
  if (htmlTagMatch && htmlTagMatch.index !== undefined) {
    const idx = htmlTagMatch.index + htmlTagMatch[0].length;
    return (
      stripped.slice(0, idx) +
      '\n<head>\n' +
      HTML_SHIM_BLOCK +
      '</head>\n' +
      stripped.slice(idx)
    );
  }
  // No <head>/<html>: only inject if the file looks like a real HTML document
  // (avoid touching partial fragments). A document has a <!DOCTYPE or <body.
  if (/<(?:!doctype html|body\b)/i.test(stripped)) {
    return HTML_SHIM_BLOCK + stripped;
  }
  return stripped;
}

// Write crx-shim.js at the extension root. Content is exactly SHIM (marker +
// body), the same form as a patched JS entry, so force-repatch-shim.js keeps it
// current via its standard strip-and-prepend JS path. Creates the file on first
// run, rewrites it when SHIM_BODY changes, no-ops when already current.
async function patchShimFile(extDir: string): Promise<boolean> {
  const file = resolve(extDir, SHIM_FILE);
  let original: string | null = null;
  try {
    original = await fs.readFile(file, 'utf8');
  } catch (err: any) {
    if (err && err.code === 'ENOENT') {
      original = null; // first time — create below
    } else {
      return false; // unreadable — retry next startup
    }
  }
  try {
    if (original !== SHIM) await fs.writeFile(file, SHIM, 'utf8');
    await fs.rm(resolve(extDir, LEGACY_SHIM_FILE), {force: true});
    return true;
  } catch {
    return false; // couldn't write — retry next startup
  }
}

// Offscreen documents are created at runtime via chrome.offscreen.createDocument,
// so their path is never in the manifest — this conventional guess is the only
// lever we have for them. Every other entry (SW, content scripts, and the JS
// behind popup/options/side-panel/devtools/MV2-background pages) is derived
// precisely from the manifest by collectEntryFiles.
const OFFSCREEN_FALLBACK = ['offscreen.js'];

// manifest keys whose value is an HTML page that may load extension JS via
// local `<script src>`. popup/options/side_panel/devtools/MV2-background and
// chrome_url_overrides pages all run in a context where chrome.storage is
// reachable, so the JS they load needs the shim too — but the manifest only
// names the HTML, not the JS, so we parse the HTML for it.
function collectHtmlPages(manifest: any): string[] {
  const pages: string[] = [];
  const push = (v: any) => {
    if (typeof v === 'string') pages.push(v);
  };
  push(manifest?.action?.default_popup);
  push(manifest?.browser_action?.default_popup); // MV2
  push(manifest?.page_action?.default_popup); // MV2
  push(manifest?.options_ui?.page);
  push(manifest?.options_page); // MV2
  push(manifest?.side_panel?.default_path);
  push(manifest?.background?.page); // MV2 background page
  push(manifest?.devtools_page);
  const overrides = manifest?.chrome_url_overrides;
  if (overrides && typeof overrides === 'object') {
    for (const k of Object.keys(overrides)) push(overrides[k]);
  }
  return pages;
}

const EXECUTABLE_SCRIPT_TYPES = new Set([
  '',
  'module',
  'text/javascript',
  'application/javascript',
  'text/ecmascript',
  'application/ecmascript',
  'application/x-javascript',
]);

function scriptAttrValue(attrs: string, name: string): string {
  const re = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'<=\`]+))`,
    'i',
  );
  const m = attrs.match(re);
  return (m?.[1] || m?.[2] || m?.[3] || '').trim();
}

function isExecutableScriptTag(attrs: string): boolean {
  const rawType = scriptAttrValue(attrs, 'type');
  if (!rawType) return true; // HTML default: classic JavaScript.
  const normalized = rawType.toLowerCase().split(';', 1)[0].trim();
  return EXECUTABLE_SCRIPT_TYPES.has(normalized);
}

// Pull local `<script src>` targets out of an HTML page. Skips absolute
// (http(s)/protocol-relative) and data: URLs. A leading '/' is the extension
// root; otherwise src is relative to the HTML file's directory. Returns
// absolute paths (confinement to extDir is enforced by the caller).
async function scriptsInHtml(
  htmlAbs: string,
  extDir: string,
): Promise<string[]> {
  let html: string;
  try {
    html = await fs.readFile(htmlAbs, 'utf8');
  } catch {
    return []; // page declared in manifest but not shipped — nothing to do
  }
  const out: string[] = [];
  // Accept double-quoted, single-quoted, AND unquoted attributes. Unquoted
  // (<script src=/generated/popup.js>) is valid HTML5 and common in minified
  // extension HTML (e.g. pakku). Only classic/module JavaScript is eligible:
  // data blocks such as import maps or application/json must NOT be patched,
  // otherwise prepending our shim turns their payload into invalid syntax.
  const re = /<script\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || '';
    const src = scriptAttrValue(attrs, 'src');
    if (!src || !isExecutableScriptTag(attrs)) continue;
    if (
      !src ||
      /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(src) ||
      src.startsWith('data:')
    ) {
      continue; // external or inline-data script
    }
    out.push(
      src.startsWith('/')
        ? resolve(extDir, '.' + src)
        : resolve(dirname(htmlAbs), src),
    );
  }
  return out;
}

/**
 * Resolve the JS entry files an extension actually loads, derived from its
 * manifest: the MV3 background service worker, MV2 background scripts, every
 * content script, and the local `<script src>` JS behind each declared HTML
 * page (popup/options/side-panel/devtools/etc.). These run in contexts where
 * chrome.storage is reachable, so each needs the shim prepended. Manifest paths
 * routinely live in subdirectories (e.g. `src/background/script.js`), which a
 * flat filename list would miss. Returns absolute paths confined to extDir.
 * Never throws — a missing/invalid manifest yields just the offscreen fallback.
 */
// Recursively collect every *.html file under extDir. Extensions can set their
// popup/page at runtime (chrome.action.setPopup) to an HTML file that is not
// declared anywhere in the manifest. collectHtmlPages only knows manifest-
// declared pages, so the JS behind such dynamic pages would never get the
// startup shim. Walking the directory for HTML guarantees every loadable
// extension page is covered.
async function collectHtmlFilesInDir(extDir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 8) return; // guard against pathological nesting / cycles
    let entries: any[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = resolve(dir, ent.name);
      if (ent.isDirectory()) {
        // Skip locales and node_modules — never host loadable pages, and
        // _locales can be large. Everything else may contain a page.
        if (ent.name === '_locales' || ent.name === 'node_modules') continue;
        await walk(full, depth + 1);
      } else if (ent.isFile() && /\.html?$/i.test(ent.name)) {
        out.push(full);
      }
    }
  };
  await walk(extDir, 0);
  return out;
}

// Resolve BOTH the JS entry files and the HTML page files an extension loads,
// in a single directory walk. JS entries (SW, content scripts, offscreen
// fallback, and the local <script src> JS behind each HTML page) get the shim
// PREPENDED; HTML pages ALSO get the shim injected as the first <head> child
// (covering inline scripts and guaranteeing first execution). Both lists are
// confined to extDir. Never throws — a missing/invalid manifest yields just the
// offscreen fallback (JS) and the dir-walk HTML files.
async function collectPatchTargets(
  extDir: string,
): Promise<{ js: string[]; html: string[] }> {
  const jsSet = new Set<string>();
  const addRel = (r: any) => {
    if (typeof r === 'string' && r) {
      jsSet.add(resolve(extDir, r.replace(/^[\\/]+/, '')));
    }
  };

  OFFSCREEN_FALLBACK.forEach(addRel);

  let manifest: any = null;
  try {
    manifest = JSON.parse(
      await fs.readFile(resolve(extDir, 'manifest.json'), 'utf8'),
    );
  } catch {
    // missing/invalid manifest — keep just the offscreen fallback + dir HTML
  }

  if (manifest) {
    const bg = manifest.background;
    if (bg) {
      addRel(bg.service_worker);
      if (Array.isArray(bg.scripts)) bg.scripts.forEach(addRel);
    }
    if (Array.isArray(manifest.content_scripts)) {
      for (const cs of manifest.content_scripts) {
        if (Array.isArray(cs?.js)) cs.js.forEach(addRel);
      }
    }
  }

  // Union of manifest-declared HTML pages and every HTML file shipped in the
  // package, so runtime-set popups/pages (chrome.action.setPopup) are covered.
  // These are BOTH injection targets (head shim) AND the source of JS entries.
  const htmlSet = new Set<string>();
  if (manifest) {
    for (const p of collectHtmlPages(manifest)) {
      if (typeof p === 'string' && p) {
        htmlSet.add(resolve(extDir, p.replace(/^[\\/]+/, '')));
      }
    }
  }
  for (const h of await collectHtmlFilesInDir(extDir)) htmlSet.add(h);

  const htmlFiles: string[] = [];
  for (const h of htmlSet) {
    if (h === extDir || h.startsWith(extDir + sep)) htmlFiles.push(h);
  }

  const pageScripts = await Promise.all(
    htmlFiles.map((htmlAbs) => scriptsInHtml(htmlAbs, extDir)),
  );
  for (const list of pageScripts) for (const j of list) jsSet.add(j);

  const jsFiles: string[] = [];
  for (const a of jsSet) {
    // Confine to extDir; ignore '..' traversal or absolute escapes.
    if (a === extDir || a.startsWith(extDir + sep)) jsFiles.push(a);
  }
  return { js: jsFiles, html: htmlFiles };
}

/**
 * Install the shim into an extension on disk via THREE complementary paths:
 *   1. WRITE crx-shim.js at the extension root (the shared shim file);
 *   2. PREPEND the shim to every JS entry file (SW, content scripts, offscreen,
 *      and the local <script src> JS behind each HTML page);
 *   3. INJECT `<script src="/crx-shim.js">` as the first <head> child of every
 *      HTML page, so the shim runs (from the external file) before any inline or
 *      external script on the page.
 * The shim's top-level __crxShimInstalled guard dedups across the paths, so
 * whichever lands first in a given context wins and the other(s) no-op.
 *
 * Idempotent per shim version: a file already carrying the CURRENT shim is
 * skipped; a file carrying an OLDER shim (or none) has any prior shim stripped
 * and the current shim installed. Never throws — a failed patch must not block
 * extension loading.
 *
 * On full success (manifest exclusions + shim file + every JS AND HTML file)
 * writes PATCH_STATE_FILE = PATCH_STATE_VERSION; on any per-file failure
 * removes it, so isExtensionStoragePatched reports "needs patch" and the next
 * startup scan retries.
 */
export async function patchExtensionStorage(extDir: string): Promise<void> {
  const manifestResult = await patchInternalContentScriptExcludes(extDir);
  const { js: jsFiles, html: htmlFiles } = await collectPatchTargets(extDir);

  const shimResult = await patchShimFile(extDir);

  const jsResults = await Promise.all(
    jsFiles.map(async (file): Promise<boolean> => {
      let original: string;
      try {
        original = await fs.readFile(file, 'utf8');
      } catch (err: any) {
        // Absent entry (e.g. the offscreen fallback) is expected, not a
        // failure. Any other read error (locked/unreadable) should retry later.
        return err && err.code === 'ENOENT';
      }

      try {
        // Strip ALL leading shim blocks: the current marker-led block, any prior
        // version's marker-led block, AND any orphaned shim BODY left behind by
        // the old line-based stripper (a prior SHIM_BODY was multi-line, so only
        // its marker line was removed — the body stayed embedded and re-defined
        // chrome.tabs WITHOUT connect, clobbering our fixes). Idempotent: if the
        // file is already exactly <directives><our shim><real content> with no
        // orphans, the rebuilt string equals the original and we skip the
        // write. Keeping directives before the shim preserves strict-mode
        // semantics in bundles such as Violentmonkey's background script.
        const stripped = stripLeadingShims(original);
        const next = injectShimPreservingDirectives(stripped);
        if (next === original) return true; // already exactly current

        await fs.writeFile(file, next, 'utf8');
        return true;
      } catch {
        return false; // present but couldn't rewrite — retry next startup
      }
    }),
  );

  const htmlResults = await Promise.all(
    htmlFiles.map(async (file): Promise<boolean> => {
      let original: string;
      try {
        original = await fs.readFile(file, 'utf8');
      } catch (err: any) {
        // A page declared in the manifest but not shipped is expected, not a
        // failure. Any other read error (locked/unreadable) should retry later.
        return err && err.code === 'ENOENT';
      }
      try {
        const next = injectHtmlHeadShim(original);
        if (next === original) return true; // already exactly current
        await fs.writeFile(file, next, 'utf8');
        return true;
      } catch {
        return false; // present but couldn't rewrite — retry next startup
      }
    }),
  );

  const stateFile = resolve(extDir, PATCH_STATE_FILE);
  try {
    if ([manifestResult, shimResult, ...jsResults, ...htmlResults].every(Boolean)) {
      await fs.writeFile(stateFile, PATCH_STATE_VERSION, 'utf8');
    } else {
      // Drop a stale/partial success record so the next scan re-patches.
      await fs.rm(stateFile, { force: true });
    }
  } catch {
    // best-effort: never block extension loading on the marker
  }
}

/**
 * Whether extDir's entries are already patched at the CURRENT shim version,
 * per the directory-level success marker. Cheap single-file read used by the
 * startup scan to skip extensions that don't need re-patching. Returns false
 * (→ patch) on a missing/stale/unreadable marker.
 */
export async function isExtensionStoragePatched(
  extDir: string,
): Promise<boolean> {
  try {
    const v = await fs.readFile(resolve(extDir, PATCH_STATE_FILE), 'utf8');
    if (v.trim() !== PATCH_STATE_VERSION) return false;
    await fs.access(resolve(extDir, SHIM_FILE));
    try {
      await fs.access(resolve(extDir, LEGACY_SHIM_FILE));
      return false;
    } catch {
      // Expected after migration.
    }
    const manifest = JSON.parse(
      await fs.readFile(resolve(extDir, 'manifest.json'), 'utf8'),
    );
    return hasInternalContentScriptExcludes(manifest);
  } catch {
    return false;
  }
}
