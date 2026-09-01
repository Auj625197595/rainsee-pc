import OnHeadersReceivedListenerDetails = Electron.OnHeadersReceivedListenerDetails;
import {Application} from "~/main/application";
import {isVideoPlayerWhitelistedHost} from "~/main/services/video-player-whitelist";

const m3u8Types = ["application/vnd.apple.mpegurl", "application/mpegurl", "application/x-mpegurl", "audio/mpegurl", "audio/x-mpegurl", "application/x-mpeg"]
// 直链视频的 Content-Type / 后缀，用于嗅探 mp4 等可直接播放的资源。
// 不含 video/mp2t：那是 HLS 的 .ts 分片，数量巨大且无法直接整段播放，
// 真正可播的 .m3u8 清单走下面的 hls 分支，仍照常嗅探。
const directVideoTypes = ["video/mp4", "video/webm", "video/ogg", "video/x-flv", "video/quicktime"]
const directVideoExts = [".mp4", ".webm", ".flv", ".m4s", ".mov"]

export interface VideoRequest {
  url: string,
  requestHeaders?: Record<string, string>,
  // 嗅探时一并保存的响应头，后续播放/下载排查用
  responseHeaders?: Record<string, string>,
  // 归一化后的 Content-Type，便于判定播放类型
  contentType?: string,
  // 'hls' | 'mp4' | 'other'
  mediaType?: string,
  referrer: string,
  frameUrl?: string,
  // 嗅探到的时间戳(ms)，用于资源列表排序
  addedAt?: number,
}

// 把 Electron 的响应头(值为字符串数组)拍平成单值字典
const flattenResponseHeaders = (responseHeaders?: Record<string, string[]>): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!responseHeaders) return out;
  for (const key of Object.keys(responseHeaders)) {
    const val = responseHeaders[key];
    out[key] = Array.isArray(val) ? val.join(", ") : String(val);
  }
  return out;
}

// 读取响应头里的 Content-Type(大小写不敏感)
const readContentType = (responseHeaders?: Record<string, string[]>): string => {
  if (!responseHeaders) return "";
  for (const key of Object.keys(responseHeaders)) {
    if (key.toLowerCase() === "content-type") {
      const val = responseHeaders[key];
      const raw = Array.isArray(val) ? val[0] : String(val);
      return (raw || "").split(";")[0].trim().toLowerCase();
    }
  }
  return "";
}

// 去掉 microsoftedge 商城响应里的 CSP 头,放行 view-preload 注入的 crxdownload.js。
// Electron 的 webRequest 每个事件只允许一个监听器:广告屏蔽开启时由 cliqz
// (engine.onHeadersReceived)占有该槽位并覆盖 settings.ts 的监听者,故此处去 CSP
// 的逻辑需同时在 settings.ts(onHeadersReceived,屏蔽关闭时)与 adblock.ts(包装
// engine.onHeadersReceived,屏蔽开启时)两处调用,详见 adblock.ts 的 hookEngine。
export const stripEdgeCspHeaders = (
  url: string,
  responseHeaders?: Record<string, string[]>,
) => {
  if (
    !responseHeaders ||
    !url.startsWith('https://microsoftedge.microsoft.com/')
  ) {
    return responseHeaders;
  }

  const filteredHeaders: Record<string, string[]> = {};
  let stripped = false;
  for (const key of Object.keys(responseHeaders)) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey === 'content-security-policy' ||
      normalizedKey === 'content-security-policy-report-only' ||
      normalizedKey === 'x-webkit-csp'
    ) {
      stripped = true;
      continue;
    }
    filteredHeaders[key] = responseHeaders[key];
  }
  if (stripped) {
    console.log('[csp] stripped Edge add-ons CSP for', url.slice(0, 80));
  }
  return filteredHeaders;
};

// 播放/下载时复用嗅探到的请求头：剔除会干扰续播的逐跳头与请求态头，
// 保留 Referer / Origin / Cookie / User-Agent 等防盗链关键标识头。
const DROP_HEADER_PREFIXES = ["sec-fetch", "sec-ch", "proxy-"];
const DROP_HEADER_EXACT = new Set([
  "range", "if-range", "if-modified-since", "if-none-match",
  "if-match", "if-unmodified-since", "accept-encoding", "host",
  "content-length", "connection", "keep-alive", "te", "trailer",
  "transfer-encoding", "upgrade",
]);

export const cleanHeaders = (headers?: Record<string, string>): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (DROP_HEADER_EXACT.has(lower)) continue;
    if (DROP_HEADER_PREFIXES.some((p) => lower.startsWith(p))) continue;
    const value = headers[key];
    if (value === undefined || value === null || value === "") continue;
    out[key] = value;
  }
  return out;
}

//记录请求头headers
export const recordUrlRequest = (details: Electron.OnBeforeSendHeadersListenerDetails) => {
  try {
    const {webContentsId, url, requestHeaders} = details;
    if (webContentsId) {
      // Look the view up across all windows. Using windows.current here is
      // unsafe: it is only set on window 'focus', so during startup (before the
      // window is focused) it is undefined and this throws — which, because this
      // runs inside the session's onBeforeSendHeaders, would prevent callback()
      // from firing and hang every request ~30s on Chromium's webRequest timeout.
      const view = findViewById(webContentsId);
      if (view) {
        view.requestRecord.set(url, requestHeaders);
        // Polling URLs often contain cache-busting parameters. Bound the
        // request-header window so a long-lived SPA cannot grow it forever.
        while (view.requestRecord.size > 2048) {
          const oldest = view.requestRecord.keys().next().value;
          if (oldest === undefined) break;
          view.requestRecord.delete(oldest);
        }
      }
    }
  } catch (e) {
    // Never let a bookkeeping error block the request pipeline.
  }
}

// 疑似视频的判定：仅用于控制诊断日志的量(只对疑似请求打印，避免每个 xhr 都刷屏)。
const videoishExts = [".m3u8", ".mp4", ".ts", ".flv", ".m4s", ".webm", ".mov", ".mpd", "video", "playlist", "/media"]
const sniffLogAt = new Map<string, number>();
const shouldLogSniff = (kind: string, url: string, intervalMs = 5000): boolean => {
  const key = `${kind}:${url}`;
  const now = Date.now();
  const previous = sniffLogAt.get(key) || 0;
  if (now - previous < intervalMs) return false;
  sniffLogAt.set(key, now);
  // Keep repeated live-playlist polling from growing the map forever.
  if (sniffLogAt.size > 4096) {
    const first = sniffLogAt.keys().next().value;
    if (first) sniffLogAt.delete(first);
  }
  return true;
}
const looksVideoish = (url: string, contentType: string): boolean => {
  const lower = (url || "").toLowerCase();
  if (videoishExts.some((e) => lower.includes(e))) return true;
  const ct = (contentType || "").toLowerCase();
  if (ct.startsWith("video/") || ct.startsWith("audio/")) return true;
  if (ct.includes("mpegurl") || ct.includes("mp2t")) return true;
  return false;
}

// 判断 url / Content-Type 命中的媒体类型
const detectMediaType = (url: string, contentType: string): string | null => {
  const lowerUrl = (url || "").toLowerCase();
  // HLS 的 .ts 传输流分片一律不嗅探：单个视频会有上百个分片，刷屏且无法直接整段播放。
  // 无论服务端返回什么 Content-Type 都跳过（实际多为 video/mp2t）。可播的 .m3u8 清单仍走 hls 分支。
  if (/\.ts($|[?#])/i.test(lowerUrl)) {
    return null;
  }
  if (lowerUrl.includes(".m3u8") || m3u8Types.includes(contentType)) {
    return "hls";
  }
  if (directVideoTypes.includes(contentType) || directVideoExts.some((ext) => lowerUrl.includes(ext))) {
    return contentType === "video/mp4" || lowerUrl.includes(".mp4") ? "mp4" : "other";
  }
  return null;
}

//记录m3u8/mp4等视频链接，用于后续blob地址的替换与播放器展示
export const filterVideo = (details: OnHeadersReceivedListenerDetails) => {
  try {
    const {webContentsId, url, frame, referrer, resourceType, responseHeaders} = details;
    const view = findViewById(webContentsId);
    const requestHeaders = {...(view?.requestRecord.get(url) || {})};
    // Some Chromium/adblock paths expose the response but omit the matching
    // request-header event. Keep the page referrer as a usable anti-hotlink
    // header instead of passing an empty header set to the player/downloader.
    if (
      referrer &&
      !Object.keys(requestHeaders).some((key) => key.toLowerCase() === 'referer')
    ) {
      requestHeaders.Referer = referrer;
    }
    // onBeforeSendHeaders records every request so media responses can reuse
    // their headers. Consume every completed response instead of retaining
    // non-media and whitelisted requests until eviction.
    view?.requestRecord.delete(url);
    const contentType = readContentType(responseHeaders);
    // 诊断日志：对疑似视频请求打印 resourceType / contentType，
    // 用来定位 m3u8 为何没命中（resourceType 被闸掉 / content-type 不是 mpegurl / url 不含 .m3u8 等）。
    if (looksVideoish(url, contentType) && shouldLogSniff('seen', url)) {
      console.log("[video-sniff] seen", JSON.stringify({resourceType, contentType, url}));
    }
    if (resourceType == 'xhr' || resourceType == "object" || resourceType == "media" || resourceType == "other") {
      const mediaType = detectMediaType(url, contentType);
      if (mediaType) {
        if (!view) {
          console.log("[video-sniff] match-but-no-view", JSON.stringify({mediaType, contentType, url}));
          return
        }
        // 智能播放器白名单：当前页 host 命中则不嗅探视频（地址栏图标也随之不出现）。
        if (isVideoPlayerWhitelistedHost(view.hostname)) {
          console.log("[video-sniff] match-but-whitelisted", JSON.stringify({host: view.hostname, mediaType, url}));
          return;
        }
        const request: VideoRequest = {
          url,
          referrer,
          frameUrl: (frame || {}).url,
          requestHeaders,
          responseHeaders: flattenResponseHeaders(responseHeaders),
          contentType,
          mediaType,
          addedAt: Date.now(),
        };
        if (shouldLogSniff('matched', url)) {
          console.log("[video-sniff] matched", JSON.stringify({mediaType, contentType, url}));
        }
        view.addNetVideoRequest(request);
      }
    }
  } catch (e) {
    console.log("[video-sniff] filterVideo error", e);
    // Never let video sniffing block the request pipeline.
  }
}

// Find a tab View by its webContents id across every open window. Returns
// undefined instead of throwing when no window/view matches (e.g. at startup).
const findViewById = (webContentsId: number) => {
  const windows = Application.instance.windows;
  for (const win of windows.list) {
    const view = win.viewManager.findViewByWebContentsId(webContentsId);
    if (view) return view;
  }
  return undefined;
}

//找到video组件
export const findVideoCode = `
          function findLargestPlayingVideo() {
            const videos = Array.from(document.querySelectorAll('video'))
              .filter(video => video.readyState != 0)
              // .filter(video => video.disablePictureInPicture == false)
              .sort((v1, v2) => {
                const v1Rect = v1.getClientRects()[0]||{width:0,height:0};
                const v2Rect = v2.getClientRects()[0]||{width:0,height:0};
                return ((v2Rect.width * v2Rect.height) - (v1Rect.width * v1Rect.height));
              });
            if (videos.length === 0) {
              return;
            }
            return videos[0];
          }
      `;


//暂停播放
const pauseCode = `
        (() => {
              ${findVideoCode}
              (async () => {
                const video = findLargestPlayingVideo();
                if (!video) {
                  return;
                }
                video.pause();
              })();
        })();
          `;


//全屏播放
const fullscreenCode = `
    (() => {
          ${findVideoCode}
          (async () => {
            const video = findLargestPlayingVideo();
            if (!video) {
              return;
            }
            function hasClick(item) {
              if (item.onclick) {
                return true;
              }
              return typeof hasClickEvent000 != 'undefined' && hasClickEvent000(item);
            }

            function hasBtnSize(item) {
              if (item.clientWidth <= 0 || item.clientHeight <= 0) {
                const styles = window.getComputedStyle(item);
                const height = styles.getPropertyValue('height');
                const width = styles.getPropertyValue('width');
                return height != '0px' && width != '0px' && height != '0' && width != '0';
              }
              if (item.clientWidth > 100) {
                return false;
              }
              if (item.clientHeight > 100) {
                return false;
              }
              return true;
            }

            function findFullscreenNode(node) {
              let tag = node.tagName.toLowerCase();
              if (tag == "video" || tag == "link" || tag == "script" || tag == "use" || tag == "svg") {
                return null;
              }
              let html = (node.outerHTML || "").toLowerCase();
              if (!html.includes("fullscreen") && !html.includes("full-screen") && !html.includes("全屏")) {
                return null;
              }
              let arr1 = Array.from(node.children || []);
              if(arr1.length > 0) {
                let childNodes = [];
                for (let item of arr1) {
                  let child = findFullscreenNode(item);
                  if(child) {
                    childNodes.push(child);
                  }
                }
                //筛选一下
                let nodes1 = [];
                let nodes2 = [];
                for (let item of childNodes) {
                  let html1 = (item.outerHTML || "").toLowerCase();
                  if(html1.includes("网页全屏") || html1.includes("页面全屏")) {
                    nodes1.push(item);
                  } else {
                    nodes2.push(item);
                  }
                }
                if(nodes2.length > 0) {
                  return nodes2[0];
                }
                if(nodes1.length > 0) {
                  return nodes1[0];
                }
              }
              if(hasBtnSize(node) && hasClick(node)) {
                return node;
              }
              return null;
            }

            function checkFullscreenBtn(video) {
              try {
                let now = video;
                let parent = video.parentNode;
                let count = 0;
                let found;
                while(count <= 5) {
                  if(parent == null) {
                    console.log('parent == null');
                    return;
                  }
                  for(let node of parent.children) {
                    if(node === now) {
                      continue;
                    }
                    found = findFullscreenNode(node);
                    if(found) {
                      console.log(found);
                      found.click();
                      return;
                    }
                  }
                  now = parent;
                  parent = parent.parentNode;
                  count++;
                }
              } catch(e) {
                console.log(e);
              }
            }
            checkFullscreenBtn(video);
            function isFullscreen() {
              return document.fullscreenElement != null
               || document.webkitFullscreenElement != null
               || document.mozFullscreenElement != null;
            }
            let isFull = isFullscreen();
            console.log("isFullscreen", isFull);
            if(!isFull) {
              setTimeout(() => {
                isFull = isFullscreen();
                console.log("isFullscreen2", isFull);
                if(!isFull) {
                  if (video.requestFullscreen) {
                    video.requestFullscreen();
                  } else if (video.mozRequestFullScreen) {
                    video.mozRequestFullScreen();
                  } else if (video.webkitRequestFullscreen) {
                    video.webkitRequestFullscreen();
                  } else if (video.msRequestFullscreen) {
                    video.msRequestFullscreen();
                  }
                }
              }, 100);
            }
          })();
    })();
      `;


//画中画模式播放
const floatCode = `
    (() => {
          ${findVideoCode}
          async function requestPictureInPicture(video) {
            await video.requestPictureInPicture();
            video.setAttribute('__pip__', true);
            video.addEventListener('leavepictureinpicture', event => {
              video.removeAttribute('__pip__');
            }, { once: true });
            new ResizeObserver(maybeUpdatePictureInPictureVideo).observe(video);
          }
          function maybeUpdatePictureInPictureVideo(entries, observer) {
            const observedVideo = entries[0].target;
            if (!document.querySelector('[__pip__]')) {
              observer.unobserve(observedVideo);
              return;
            }
            const video = findLargestPlayingVideo();
            if (video && !video.hasAttribute('__pip__')) {
              observer.unobserve(observedVideo);
              requestPictureInPicture(video);
            }
          }
          (async () => {
            const video = findLargestPlayingVideo();
            if (!video) {
              return;
            }
            if (video.hasAttribute('__pip__')) {
              document.exitPictureInPicture();
              return;
            }
            await requestPictureInPicture(video);
          })();
    })();
      `;

export const getVideoPlayCode = (method: string) => {
  if (method == "other") {
    return pauseCode;
  }
  if (method == "full") {
    return fullscreenCode;
  }
  return floatCode;
}


//拦截监听页面添加点击事件
export const hookClickCode = `
        try {
          //console.log('injectJS2', location.href);
          if(typeof originalAddEventListener == 'undefined') {
            originalAddEventListener = EventTarget.prototype.addEventListener;
            // Keep membership without retaining detached DOM nodes.
            let clickEventSet000 = new WeakSet();
            EventTarget.prototype.addEventListener = function(type, listener, options) {
              if (type === 'click') {
                clickEventSet000.add(this);
              }
              originalAddEventListener.call(this, type, listener, options);
            };
            hasClickEvent000 = function(element) {
              return clickEventSet000.has(element);
            };
          }
        } catch(e) {
          //console.log('injectJS2', e);
        }
      `;


//监听页面中的视频链接和组件
export const watchVideoCode = `
    (() => {
        const observerKey = '__rainseeVideoObserver';
        const previousObserver = window[observerKey];
        if (previousObserver && typeof previousObserver.disconnect === 'function') {
          previousObserver.disconnect();
        }
        function getParentWindow00(w) {
          // 如果当前窗口是最顶层窗口，则停止递归
          if (w === w.parent) {
            return w;
          }
          if(w.parent) {
            return getParentWindow00(w.parent);
          } else {
            return w;
          }
        }
        function findVideos00(c) {
          try {
            const urls = Array.from(document.getElementsByTagName('video'))
            .filter(video => video && video.src).map((video) => video.src);
            //console.log(‘video’, document.getElementsByTagName('video'));
            //console.log(urls);
            if(urls && urls.length > 0) {
              for (let v of urls) {
                v && getParentWindow00(window).postMessage({ type: 'supervideo-video-created', src: v }, '*');
              }
            } else if(c < 10){
              c++;
              setTimeout(() => {
                findVideos00(c);
              }, c < 3 ? 500 : 1000);
            }
          } catch(e) {
            console.log(e);
          }
        }
        findVideos00(0);
        const observer = new MutationObserver((mutationsList) => {
        for (const mutation of mutationsList) {
          if (mutation.type === 'childList') {
            for (const addedNode of mutation.addedNodes) {
              if (addedNode instanceof HTMLVideoElement) {
                const src = addedNode.getAttribute('src');
                if(src) {
                  getParentWindow00(window).postMessage({ type: 'supervideo-video-created', src }, '*');
                }
              }
            }
          }
        }
      });
      if(document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
        window[observerKey] = observer;
      }
    })();true
      `
