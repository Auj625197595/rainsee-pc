import {app, net, ipcMain, session, BrowserWindow} from 'electron';
import {createWriteStream, promises as fsp, existsSync, statSync} from 'fs';
import {join, resolve, parse as parsePath} from 'path';
import {createDecipheriv} from 'crypto';
import {URL} from 'url';
import * as http from 'http';
import * as https from 'https';
import {Application} from '../application';
import {getMainTranslator} from '../i18n';
import {IDownloadItem} from '~/interfaces';
import {makeId} from '~/utils';
import {normalizeDownloadSpeed} from '~/common/download-speed';
import {ChromeUserAgent} from '../user-agent';
import type {View} from '../view';
import {cleanHeaders} from './supervideo-video';
import {
  DEFAULT_SETTINGS,
  MAX_M3U8_DOWNLOAD_THREADS,
  MIN_M3U8_DOWNLOAD_THREADS,
} from '~/constants';

// 媒体下载服务：支持 m3u8(解析切片 + AES-128 解密 + MP4 封装)与 mp4 等直链。
// 所有网络请求复用嗅探时保存、清理后的请求头(Referer/Origin/Cookie/UA)，绕过防盗链。
//
// 关键设计：媒体下载接入浏览器原生下载面板。MediaDownloadManager 维护任务表，
// 向下载弹窗与主窗口广播与原生下载同构的 IDownloadItem 事件
// (download-started/progress/paused/completed/canceled)，并支持断点续传：
//   - mp4/直链：暂停=abort 保留半成品；恢复=带 Range 续传(206 追加,200 截断重下)
//   - hls    ：切片下到临时目录边下边解密；暂停=当前切片下完即停；
//              恢复=从 segIndex 继续(已存在 .part 跳过)；完成=纯 JS 重封装为 .mp4

// 下载请求使用独立的持久 Session：复用 Cookie，但不绑定播放器窗口或其拦截规则。
const DOWNLOAD_PARTITION = 'persist:media-download';
let downloadSession: Electron.Session | undefined;
type PendingDownloadHeaders = {
  headers: Record<string, string>;
  active: boolean;
};
const pendingDownloadHeaders = new Map<string, PendingDownloadHeaders[]>();

const setHeaderCaseInsensitive = (
  headers: Record<string, string>,
  name: string,
  value: string,
) => {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) delete headers[key];
  }
  headers[name] = value;
};

const isSessionInjectedHeader = (name: string) => {
  const lower = name.toLowerCase();
  return lower === 'referer' || lower === 'origin';
};

const withDefaultUserAgent = (headers: Record<string, string>) => {
  if (!Object.keys(headers).some((name) => name.toLowerCase() === 'user-agent')) {
    headers['User-Agent'] = ChromeUserAgent;
  }
  return headers;
};

const headerPresenceForLog = (headers: Record<string, string>) => {
  const names = Object.keys(headers).map((name) => name.toLowerCase());
  return {
    referer: names.includes('referer'),
    origin: names.includes('origin'),
    userAgent: names.includes('user-agent'),
    range: names.includes('range'),
    cookie: names.includes('cookie'),
  };
};

const headersForLog = (headers: Record<string, string>) => {
  const sensitive = /^(cookie|set-cookie|authorization|proxy-authorization|x-api-key|x-auth-token)$/i;
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      sensitive.test(name) ? '<redacted>' : value,
    ]),
  );
};

const registerDownloadHeaders = (url: string, headers: Record<string, string>) => {
  const entry: PendingDownloadHeaders = {headers: {...headers}, active: true};
  const entries = pendingDownloadHeaders.get(url) || [];
  entries.push(entry);
  pendingDownloadHeaders.set(url, entries);
  return () => {
    if (!entry.active) return;
    entry.active = false;
    const current = pendingDownloadHeaders.get(url);
    if (!current) return;
    const index = current.indexOf(entry);
    if (index >= 0) current.splice(index, 1);
    if (!current.length) pendingDownloadHeaders.delete(url);
  };
};

const installDownloadSessionHooks = (target: Electron.Session) => {
  target.webRequest.onBeforeSendHeaders(
    {urls: ['<all_urls>']},
    (details, callback) => {
      const entries = pendingDownloadHeaders.get(details.url);
      const rule = entries?.shift();
      if (entries && !entries.length) pendingDownloadHeaders.delete(details.url);
      if (!rule) {
        callback({requestHeaders: details.requestHeaders});
        return;
      }
      rule.active = false;

      const requestHeaders = {...details.requestHeaders};
      for (const [name, value] of Object.entries(rule.headers)) {
        setHeaderCaseInsensitive(requestHeaders, name, value);
      }
      const protectedHeaders = Object.keys(rule.headers).filter((name) =>
        isSessionInjectedHeader(name),
      );
      if (protectedHeaders.length) {
        console.log(
          '[media-download] Electron Session injected protected headers',
          JSON.stringify({url: details.url, headers: protectedHeaders}),
        );
      }
      callback({requestHeaders});
    },
  );
};

const getDownloadSession = (): Electron.Session => {
  if (!downloadSession) {
    downloadSession = session.fromPartition(DOWNLOAD_PARTITION);
    installDownloadSessionHooks(downloadSession);
  }
  return downloadSession;
};

// Electron's net.request can be cancelled by a client-side webRequest/DNR
// handler even when the media session is intended to be isolated.  Keep a
// small Node transport fallback for CDN media; it bypasses Electron's client
// blocking layer while preserving the captured request headers.
const nodeRequest = (url: string, headers: Record<string, string>) => {
  const target = new URL(url);
  const transport = target.protocol === 'http:' ? http : https;
  return transport.request(target, {method: 'GET', headers});
};

const isClientBlockedError = (error: any) =>
  String(error?.message || error || '').includes('ERR_BLOCKED_BY_CLIENT') ||
  error?.code === 'ERR_BLOCKED_BY_CLIENT';

interface Mp4TransmuxedSegment {
  initSegment?: Uint8Array;
  data: Uint8Array;
}

interface Mp4Transmuxer {
  on(event: 'data', handler: (segment: Mp4TransmuxedSegment) => void): void;
  push(data: Uint8Array): void;
  flush(): void;
  dispose?(): void;
}

interface MuxJsModule {
  mp4: {
    Transmuxer: new () => Mp4Transmuxer;
  };
}

// mux.js 只改变封装容器，不重新编码音视频；H.264/AAC TS 可无损输出为 fMP4。
const MuxJs = require('mux.js') as MuxJsModule;

export interface MediaDownloadTask {
  id?: string;
  url: string;
  mediaType: string; // 'hls' | 'mp4' | 'other'
  headers: Record<string, string>;
  fileName: string;
  /** 网页创建任务时填写的页面地址；媒体 URL 由浏览器嗅探后补上。 */
  pageUrl?: string;
}

interface M3u8Segment {
  url: string;
  keyUrl?: string;
  iv?: Buffer;
}

interface M3u8Parsed {
  segments: M3u8Segment[];
  masterChild?: string;
}

// 内部任务状态(含续传所需)
interface MediaJob {
  id: string;
  url: string;
  mediaType: string;
  headers: Record<string, string>;
  fileName: string;
  savePath: string;
  receivedBytes: number;
  totalBytes: number;
  speedBytesPerSecond: number;
  paused: boolean;
  interrupted: boolean;
  retrying: boolean;
  canceled: boolean;
  completed: boolean;
  // 运行控制
  request?: Electron.ClientRequest; // 当前直链请求(用于 abort)
  running: boolean;                 // 是否有循环在跑(避免重复 resume)
  retryAttempts: number;
  retryBytes: number;
  retryTimer?: ReturnType<typeof setTimeout>;
  lastSpeedBytes: number;
  lastSpeedAt: number;
  lastProgressAt: number;
  // hls 续传
  isHls: boolean;
  segments?: M3u8Segment[];
  partsDir?: string;
  skippedSegments?: Set<number>;
  transmuxProbeDone?: boolean;
  fatalError?: boolean;
  preparing: boolean;
  sniffPageUrl?: string;
  sniffView?: View;
}

// 相对/绝对 URL 解析为绝对地址
const resolveUrl = (base: string, ref: string): string => {
  try {
    return new URL(ref, base).toString();
  } catch (e) {
    return ref;
  }
};

const fetchBuffer = (
  url: string,
  headers: Record<string, string>,
  extra?: Record<string, string>,
): Promise<{status: number; body: Buffer; headers: Record<string, any>}> => {
  const all = withDefaultUserAgent({...(headers || {}), ...(extra || {})});
  const fetchViaNode = (redirects = 0): Promise<{status: number; body: Buffer; headers: Record<string, any>}> =>
    new Promise((resolve, reject) => {
      let request: any;
      try {
        request = nodeRequest(url, all);
      } catch (error) {
        reject(error);
        return;
      }
      request.on('response', (response: any) => {
        const location = response.headers?.location;
        if (response.statusCode >= 300 && response.statusCode < 400 && location && redirects < 5) {
          response.resume();
          fetchBuffer(resolveUrl(url, location), headers, extra).then(resolve, reject);
          return;
        }
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => resolve({
          status: response.statusCode || 0,
          body: Buffer.concat(chunks),
          headers: response.headers || {},
        }));
        response.on('error', reject);
      });
      request.on('error', reject);
      request.end();
    });

  return new Promise((resolve, reject) => {
    const requestSession = getDownloadSession();
    const request = net.request({
      url,
      session: requestSession,
      useSessionCookies: true,
    });
    let releaseHeaders = registerDownloadHeaders(url, all);
    const registerRedirectHeaders = (_status: number, _method: string, redirectUrl: string) => {
      releaseHeaders();
      releaseHeaders = registerDownloadHeaders(redirectUrl, all);
    };
    (request as any).on?.('redirect', registerRedirectHeaders);
    const releaseRequestHeaders = () => releaseHeaders();
    (request as any).once?.('abort', releaseRequestHeaders);
    (request as any).once?.('close', releaseRequestHeaders);
    for (const key of Object.keys(all)) {
      try {
        request.setHeader(key, all[key]);
      } catch (e) {
        // 某些受保护头无法设置，忽略，交给 session 注入兜底
      }
    }
    request.on('response', (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        releaseHeaders();
        resolve({
          status: response.statusCode,
          body: Buffer.concat(chunks),
          headers: response.headers as Record<string, any>,
        });
      });
      response.on('error', (error) => {
        releaseHeaders();
        reject(error);
      });
    });
    request.on('error', (error) => {
      releaseHeaders();
      if (isClientBlockedError(error)) {
        fetchViaNode().then(resolve, reject);
      } else {
        reject(error);
      }
    });
    request.end();
  });
};

const fetchText = async (
  url: string,
  headers: Record<string, string>,
): Promise<string> => {
  const res = await fetchBuffer(url, headers);
  if (res.status >= 400) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.body.toString('utf-8');
};

const parseM3u8 = (content: string, baseUrl: string): M3u8Parsed => {
  const lines = content.split(/\r?\n/);
  const segments: M3u8Segment[] = [];

  // master playlist：挑选码率最高的 STREAM
  if (content.includes('#EXT-X-STREAM-INF')) {
    let bestUrl: string | undefined;
    let bestBandwidth = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#EXT-X-STREAM-INF')) {
        const m = line.match(/BANDWIDTH=(\d+)/);
        const bw = m ? parseInt(m[1], 10) : 0;
        const next = (lines[i + 1] || '').trim();
        if (next && !next.startsWith('#') && bw >= bestBandwidth) {
          bestBandwidth = bw;
          bestUrl = resolveUrl(baseUrl, next);
        }
      }
    }
    if (bestUrl) return {segments: [], masterChild: bestUrl};
  }

  // media playlist：解析 EXT-X-KEY 与切片
  let curKeyUrl: string | undefined;
  let curIv: Buffer | undefined;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXT-X-KEY')) {
      const methodMatch = line.match(/METHOD=([^,]+)/);
      const method = methodMatch ? methodMatch[1] : 'NONE';
      if (method === 'NONE') {
        curKeyUrl = undefined;
        curIv = undefined;
      } else {
        const uriMatch = line.match(/URI="([^"]+)"/);
        curKeyUrl = uriMatch ? resolveUrl(baseUrl, uriMatch[1]) : undefined;
        const ivMatch = line.match(/IV=0x([0-9A-Fa-f]+)/);
        curIv = ivMatch ? Buffer.from(ivMatch[1], 'hex') : undefined;
      }
      continue;
    }
    if (line.startsWith('#')) continue;
    segments.push({url: resolveUrl(baseUrl, line), keyUrl: curKeyUrl, iv: curIv});
  }
  return {segments};
};

// 默认 IV：序号大端 16 字节
const defaultIv = (index: number): Buffer => {
  const iv = Buffer.alloc(16);
  iv.writeUInt32BE(index, 12);
  return iv;
};

const createFatalHlsError = (message: string): Error & {code: string} => {
  const error = new Error(message) as Error & {code: string};
  error.code = 'HLS_TRANSMUX_UNSUPPORTED';
  return error;
};

const canTransmuxSegment = (data: Buffer): boolean => {
  const transmuxer = new MuxJs.mp4.Transmuxer();
  let emitted = false;
  transmuxer.on('data', (segment) => {
    emitted = emitted || Boolean(segment.initSegment?.length || segment.data?.length);
  });
  try {
    transmuxer.push(data);
    transmuxer.flush();
    return emitted;
  } catch (e) {
    return false;
  } finally {
    transmuxer.dispose?.();
  }
};

const waitForHlsRetry = (job: MediaJob, delayMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    const deadline = Date.now() + delayMs;
    const check = () => {
      if (job.paused || job.canceled) {
        resolve(false);
        return;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        resolve(true);
        return;
      }
      setTimeout(check, Math.min(100, remaining));
    };
    check();
  });

const keyCache = new Map<string, Buffer>();
const HLS_SEGMENT_RETRY_DELAYS = [1000, 2000, 5000] as const;

export class MediaDownloadManager {
  private static jobs = new Map<string, MediaJob>();

  // 是否为媒体任务 id(供 sessions-service 守卫复用)
  public static has(id: string): boolean {
    return this.jobs.has(id);
  }

  // 暴露给面板初始化(get-downloads 合并)
  public static list(): IDownloadItem[] {
    return Array.from(this.jobs.values()).map((j) => this.toItem(j));
  }

  private static toItem(j: MediaJob): IDownloadItem {
    return {
      id: j.id,
      fileName: j.fileName,
      receivedBytes: j.receivedBytes,
      totalBytes: j.totalBytes,
      speedBytesPerSecond: j.speedBytesPerSecond,
      savePath: j.savePath,
      url: j.url,
      paused: j.paused,
      interrupted: j.interrupted,
      retrying: j.retrying,
      completed: j.completed,
      canceled: j.canceled,
      preparing: j.preparing,
      sourceUrl: j.sniffPageUrl,
    };
  }

  // 向下载弹窗 + 所有主窗口广播(与原生下载同构)
  private static emit(channel: string, ...args: any[]) {
    try {
      const dlg = Application.instance.dialogs
        .getDynamic('downloads-dialog')?.browserView?.webContents;
      if (dlg && !dlg.isDestroyed()) dlg.send(channel, ...args);
    } catch (e) {
    }
    try {
      Application.instance.windows.broadcast(channel, ...args);
    } catch (e) {
    }
  }

  private static getDownloadDir(): string {
    try {
      const configured = (Application.instance?.settings?.object as any)?.downloadsPath;
      if (configured) return configured;
    } catch (e) {
    }
    return app.getPath('downloads');
  }

  // 去重后的最终保存路径(与原生下载一致的 (1)(2) 规则)
  private static uniqueSavePath(fileName: string): string {
    const dir = this.getDownloadDir();
    let savePath = resolve(dir, fileName);
    let i = 1;
    while (existsSync(savePath)) {
      const {name, ext} = parsePath(fileName);
      savePath = resolve(dir, `${name} (${i})${ext}`);
      i++;
    }
    return savePath;
  }

  private static createJob(task: MediaDownloadTask, preparing = false): MediaJob {
    const id = task.id || makeId(32);
    const isHls =
      task.mediaType === 'hls' || (task.url || '').toLowerCase().includes('.m3u8');
    // 文件名来自播放器/下载页输入，始终取 basename，避免把保存路径带出下载目录。
    const requestedFileName = parsePath(task.fileName || 'video').base || 'video';
    const fileName = isHls
      ? `${parsePath(requestedFileName).name || 'video'}.mp4`
      : requestedFileName;
    const savePath = this.uniqueSavePath(fileName);
    const job: MediaJob = {
      id,
      url: task.url,
      mediaType: task.mediaType,
      headers: task.headers || {},
      fileName: parsePath(savePath).base,
      savePath,
      receivedBytes: 0,
      totalBytes: 0,
      speedBytesPerSecond: 0,
      paused: false,
      interrupted: false,
      retrying: false,
      canceled: false,
      completed: false,
      running: false,
      retryAttempts: 0,
      retryBytes: 0,
      lastSpeedBytes: 0,
      lastSpeedAt: Date.now(),
      lastProgressAt: 0,
      isHls,
      preparing,
      sniffPageUrl: task.pageUrl,
    };
    if (isHls) {
      job.partsDir = join(this.getDownloadDir(), `.${id}.parts`);
      job.skippedSegments = new Set<number>();
    }
    this.jobs.set(id, job);
    return job;
  }

  // 新建并启动一个媒体下载任务，返回 id
  public static start(task: MediaDownloadTask): string {
    const job = this.createJob(task);

    this.emit('download-started', this.toItem(job));
    this.run(job);
    return job.id;
  }

  /**
   * 从网页地址创建任务。页面加载和媒体嗅探使用浏览器现有 View/session，
   * 真正的媒体字节传输仍由本服务执行，避免网页下载链路被客户端拦截器接管。
   */
  public static startFromPage(
    pageUrl: string,
    fileName: string | undefined,
    appWindow: any,
  ): string {
    const t = getMainTranslator(Application.instance.settings?.object?.language);
    let parsed: URL;
    try {
      parsed = new URL(pageUrl);
    } catch {
      throw new Error(t('mdInvalidPageUrl'));
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(t('mdPageUrlHttpOnly'));
    }

    const fallbackName = `${(parsed.hostname || 'video').replace(/[^a-z0-9._-]+/gi, '_')}-${Date.now()}.mp4`;
    const job = this.createJob({
      url: pageUrl,
      pageUrl,
      mediaType: 'other',
      headers: {},
      fileName: fileName || fallbackName,
    }, true);
    this.emit('download-started', this.toItem(job));
    this.sniffAndStart(job, appWindow);
    return job.id;
  }

  private static sniffAndStart(job: MediaJob, appWindow: any) {
    const t = getMainTranslator(Application.instance.settings?.object?.language);
    const manager = appWindow?.viewManager;
    if (!manager || typeof manager.create !== 'function') {
      this.failPreparing(job, t('mdNoBrowserWindow'));
      return;
    }

    let view: View | undefined;
    try {
      // 不发送 create-tab，且 active=false：这是浏览器自己的后台 View，
      // 会话、Cookie、扩展拦截和视频嗅探逻辑与普通网页完全一致。
      view = manager.create({url: job.sniffPageUrl, active: false}, false, false, undefined, false) as View;
      job.sniffView = view;
    } catch (error: any) {
      this.failPreparing(job, error?.message || String(error));
      return;
    }

    const startedAt = Date.now();
    const timeoutMs = 30000;
    let settled = false;
    const finish = (candidate?: any, error?: Error) => {
      if (settled) return;
      settled = true;
      // 先复制嗅探头，再销毁临时 View；View.destroy() 会清空 requestRecord/
      // netVideoUrls，之后无法再恢复防盗链请求头。
      const headers = candidate
        ? (view?.getPlaybackHeaders?.(candidate.url) || candidate.requestHeaders || {})
        : {};
      if (job.sniffView === view) job.sniffView = undefined;
      try {
        if (view && manager.views?.has(view.id)) manager.destroy(view.id);
        else view?.destroy?.();
      } catch {
      }
      if (error) {
        this.failPreparing(job, error.message);
        return;
      }
      if (!candidate || job.canceled) return;
      job.url = candidate.url;
      job.mediaType = candidate.mediaType || (candidate.url.toLowerCase().includes('.m3u8') ? 'hls' : 'mp4');
      console.log('[media-download] browser sniff matched', JSON.stringify({
        taskId: job.id,
        mediaType: job.mediaType,
        url: candidate.url,
      }));
      job.headers = cleanHeaders(headers);
      if (!Object.keys(job.headers).some((key) => key.toLowerCase() === 'referer')) {
        const referrer = candidate.referrer || job.sniffPageUrl;
        if (referrer) job.headers.Referer = referrer;
      }
      if (!Object.keys(job.headers).some((key) => key.toLowerCase() === 'origin')) {
        try { job.headers.Origin = new URL(job.headers.Referer || job.sniffPageUrl).origin; } catch {
        }
      }
      job.isHls = job.mediaType === 'hls' || /\.m3u8(?:$|[?#])/i.test(job.url);
      if (job.isHls) {
        job.partsDir = join(this.getDownloadDir(), `.${job.id}.parts`);
        job.skippedSegments = new Set<number>();
        const {name} = parsePath(job.fileName);
        job.fileName = `${name || 'video'}.mp4`;
        job.savePath = this.uniqueSavePath(job.fileName);
      }
      job.preparing = false;
      job.interrupted = false;
      this.emit('download-progress', this.toItem(job));
      this.run(job);
    };

    const poll = () => {
      if (settled || job.canceled) return;
      // 后台 View 不在 renderer 标签列表中；持续刷新活跃时间，避免窗口的
      // ghost-view 对账在嗅探期间把它提前回收。
      try { (manager as any).lastActiveAt?.set(view.id, Date.now()); } catch {
      }
      if (!job.paused) {
        try {
          const items = view?.getVideoItems?.() || [];
          // 最新的 HLS/直链优先，避免把单个 TS 分片当成下载目标。
          const candidate = items.find((item: any) => item.mediaType === 'hls' || item.mediaType === 'mp4') || items[0];
          if (candidate) {
            finish(candidate);
            return;
          }
        } catch {
        }
      }
      if (Date.now() - startedAt >= timeoutMs) {
        finish(undefined, new Error(t('mdNoVideoSniffed')));
        return;
      }
      setTimeout(poll, 500);
    };

    view.webContents.once('did-finish-load', () => {
      // 许多站点只有在 video.play() 后才发起媒体请求；失败不影响正常页面脚本。
      view?.webContents.executeJavaScript(`(() => { for (const video of document.querySelectorAll('video')) { try { video.muted = true; const p = video.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {} } })()`, true).catch(() => undefined);
    });
    view.webContents.once('destroyed', () => {
      if (!settled && !job.canceled) finish(undefined, new Error(t('mdSniffPageClosed')));
    });
    poll();
  }

  private static failPreparing(job: MediaJob, message: string) {
    if (job.canceled) return;
    job.preparing = false;
    job.paused = true;
    job.interrupted = true;
    job.fatalError = true;
    console.log(`[media-download] ${job.fileName} sniff failed: ${message}`);
    this.progress(job, true);
  }

  public static pause(id: string) {
    const job = this.jobs.get(id);
    if (!job || job.completed || job.canceled) return;
    job.paused = true;
    job.interrupted = false;
    job.retrying = false;
    job.speedBytesPerSecond = 0;
    if (job.retryTimer) clearTimeout(job.retryTimer);
    job.retryTimer = undefined;
    try {
      job.request?.abort();
    } catch (e) {
    }
    this.emit('download-paused', id);
    this.progress(job, true);
  }

  public static resume(id: string) {
    const job = this.jobs.get(id);
    if (!job || job.completed || job.canceled) return;
    job.paused = false;
    job.interrupted = false;
    job.retrying = false;
    job.retryAttempts = 0;
    job.lastSpeedBytes = job.receivedBytes;
    job.lastSpeedAt = Date.now();
    job.speedBytesPerSecond = 0;
    this.progress(job, true);
    if (!job.running) this.run(job);
  }

  public static cancel(id: string) {
    const job = this.jobs.get(id);
    if (!job) return;
    job.canceled = true;
    job.paused = false;
    job.interrupted = false;
    job.retrying = false;
    if (job.retryTimer) clearTimeout(job.retryTimer);
    job.retryTimer = undefined;
    try {
      job.request?.abort();
    } catch (e) {
    }
    try {
      job.sniffView?.destroy?.();
    } catch (e) {
    }
    job.sniffView = undefined;
    this.cleanup(job);
    this.emit('download-canceled', id);
  }

  public static remove(id: string) {
    const job = this.jobs.get(id);
    if (!job) return;
    if (!job.completed) {
      job.canceled = true;
      try {
        job.request?.abort();
      } catch (e) {
      }
      try {
        job.sniffView?.destroy?.();
      } catch (e) {
      }
      job.sniffView = undefined;
      this.cleanup(job);
    }
    if (job.retryTimer) clearTimeout(job.retryTimer);
    this.jobs.delete(id);
  }

  // 清理已结束的媒体下载记录，保留正在进行的任务和已下载文件。
  public static clearHistory(): string[] {
    const removedIds: string[] = [];
    for (const [id, job] of this.jobs) {
      if (!job.completed && !job.canceled) continue;
      this.jobs.delete(id);
      removedIds.push(id);
    }
    return removedIds;
  }

  private static cleanup(job: MediaJob) {
    // 删除半成品/临时目录(取消时)
    try {
      if (job.partsDir && existsSync(job.partsDir)) {
        fsp.rm(job.partsDir, {recursive: true, force: true}).catch(() => undefined);
      }
    } catch (e) {
    }
  }

  // 进度上报(节流交给渲染层，这里直接发)
  private static progress(job: MediaJob, force = false) {
    const now = Date.now();
    if (job.paused || job.interrupted || job.completed || job.canceled) {
      job.speedBytesPerSecond = 0;
    } else {
      const elapsed = now - job.lastSpeedAt;
      if (elapsed >= 250) {
        const instant = Math.max(0, job.receivedBytes - job.lastSpeedBytes) * 1000 / elapsed;
        job.speedBytesPerSecond = normalizeDownloadSpeed(
          job.speedBytesPerSecond > 0
            ? job.speedBytesPerSecond * 0.35 + instant * 0.65
            : instant,
        );
        job.lastSpeedBytes = job.receivedBytes;
        job.lastSpeedAt = now;
      }
    }
    if (force || now - job.lastProgressAt >= 250) {
      job.lastProgressAt = now;
      this.emit('download-progress', this.toItem(job));
    }
  }

  private static done(job: MediaJob) {
    job.completed = true;
    job.running = false;
    job.speedBytesPerSecond = 0;
    job.interrupted = false;
    job.retrying = false;
    this.emit('download-completed', job.id);
    this.emit('download-progress', this.toItem(job));
  }

  private static fail(job: MediaJob, message: string) {
    job.running = false;
    if (job.canceled) return;
    if (job.paused) return;

    if (job.fatalError) {
      job.paused = true;
      job.interrupted = true;
      job.retrying = false;
      job.speedBytesPerSecond = 0;
      this.cleanup(job);
      console.log(`[media-download] ${job.fileName} interrupted: ${message}`);
      this.progress(job, true);
      return;
    }

    if (job.receivedBytes > job.retryBytes) job.retryAttempts = 0;
    job.retryBytes = job.receivedBytes;
    const delays = [1000, 2000, 5000, 10000, 15000];
    if (job.retryAttempts >= delays.length) {
      job.paused = true;
      job.interrupted = true;
      job.retrying = false;
      job.speedBytesPerSecond = 0;
      console.log(`[media-download] ${job.fileName} interrupted: ${message}`);
      this.progress(job, true);
      return;
    }

    const delay = delays[job.retryAttempts++];
    job.interrupted = true;
    job.retrying = true;
    job.speedBytesPerSecond = 0;
    console.log(
      `[media-download] ${job.fileName} failed, retry ${job.retryAttempts}/${delays.length} in ${delay}ms: ${message}`,
    );
    this.progress(job, true);
    job.retryTimer = setTimeout(() => {
      job.retryTimer = undefined;
      if (job.paused || job.canceled || job.completed) return;
      job.interrupted = false;
      job.retrying = false;
      job.lastSpeedBytes = job.receivedBytes;
      job.lastSpeedAt = Date.now();
      this.run(job);
    }, delay);
  }

  // 调度入口
  private static run(job: MediaJob) {
    if (job.preparing) {
      job.running = false;
      return;
    }
    if (job.running) return;
    job.running = true;
    const work = job.isHls ? this.runHls(job) : this.runDirect(job);
    work
      .then((finished) => {
        if (finished) this.done(job);
        else {
          job.running = false;
          // 用户可能在 abort 完成前就点了恢复；旧请求退出后立即接续。
          if (!job.paused && !job.canceled) this.run(job);
        }
      })
      .catch((e: any) => {
        if (e?.code === 'HLS_TRANSMUX_UNSUPPORTED') job.fatalError = true;
        this.fail(job, e?.message || String(e));
      });
  }

  // ── 直链(mp4 等)：带 Range 续传 ──
  // 返回 true=下载完成；false=被暂停(保留半成品，等 resume)
  private static runDirect(job: MediaJob): Promise<boolean> {
    return new Promise((resolveRun, rejectRun) => {
      // 已下载字节：以磁盘半成品为准(续传场景)
      let startByte = 0;
      try {
        if (existsSync(job.savePath)) startByte = statSync(job.savePath).size;
      } catch (e) {
      }
      job.receivedBytes = startByte;

      const extra: Record<string, string> = {};
      // Bilibili DASH fragments are normally requested as byte ranges even
      // for the first request. Keep ordinary MP4 GET semantics unchanged.
      if (startByte > 0 || /\.m4s(?:$|[?#])/i.test(job.url)) {
        extra['Range'] = `bytes=${startByte}-`;
      }

      const all = withDefaultUserAgent({...(job.headers || {}), ...extra});
      // Bilibili DASH fragments are the requests most commonly rejected by a
      // client-side blocker.  Use the isolated Electron session first for
      // normal links, and the Node transport for .m4s so a blocker cannot
      // cancel the actual media transfer after the player already proved the
      // signed URL works.
      const useNodeTransport = /\.m4s(?:$|[?#])/i.test(job.url);
      const request: any = useNodeTransport
        ? nodeRequest(job.url, all)
        : net.request({
            url: job.url,
            session: getDownloadSession(),
            useSessionCookies: true,
          });
      job.request = request;
      console.log(
        '[media-download] request prepared',
        JSON.stringify({
          mediaType: job.mediaType,
          url: job.url,
          transport: useNodeTransport ? 'node' : 'electron',
          headers: headerPresenceForLog(all),
        }),
      );
      let releaseHeaders = useNodeTransport
        ? () => {}
        : registerDownloadHeaders(job.url, all);
      const registerRedirectHeaders = (_status: number, _method: string, redirectUrl: string) => {
        releaseHeaders();
        releaseHeaders = registerDownloadHeaders(redirectUrl, all);
      };
      if (!useNodeTransport) (request as any).on?.('redirect', registerRedirectHeaders);
      const releaseRequestHeaders = () => releaseHeaders();
      (request as any).once?.('abort', releaseRequestHeaders);
      (request as any).once?.('close', releaseRequestHeaders);
      for (const key of Object.keys(all)) {
        try {
          request.setHeader(key, all[key]);
        } catch (e) {
        }
      }

      request.on('response', (response: any) => {
        releaseHeaders();
        const status = response.statusCode;
        if (status >= 400) {
          rejectRun(new Error(`HTTP ${status}`));
          return;
        }
        // 206 续传 → 追加；200 → 服务端忽略 Range，从头重下(截断)
        const append = status === 206 && startByte > 0;
        if (!append) {
          job.receivedBytes = 0;
        }
        const lenHeader = parseInt(
          (response.headers['content-length'] as string) || '0',
          10,
        );
        if (append) {
          job.totalBytes = startByte + (lenHeader || 0);
        } else {
          job.totalBytes = lenHeader || 0;
        }

        const ws = createWriteStream(job.savePath, append ? {flags: 'a'} : {flags: 'w'});
        ws.on('error', (err) => {
          job.request = undefined;
          try {
            request.abort();
          } catch (e) {
          }
          rejectRun(err);
        });
        response.on('data', (chunk: Buffer) => {
          job.receivedBytes += chunk.length;
          if (!ws.write(chunk)) {
            (response as any).pause?.();
            ws.once('drain', () => (response as any).resume?.());
          }
          this.progress(job);
        });
        response.on('end', () => {
          ws.end(() => {
            job.request = undefined;
            if (job.paused) resolveRun(false);
            else if (job.canceled) resolveRun(false);
            else resolveRun(true);
          });
        });
        response.on('error', (err: any) => {
          ws.end(() => {
            job.request = undefined;
            // abort 触发的 error 是暂停/取消的正常路径
            if (job.paused || job.canceled) resolveRun(false);
            else rejectRun(err);
          });
        });
      });
      request.on('error', (err: any) => {
        releaseHeaders();
        job.request = undefined;
        if (job.paused || job.canceled) resolveRun(false);
        else rejectRun(err);
      });
      request.end();
    });
  }

  private static async getKey(
    keyUrl: string,
    headers: Record<string, string>,
  ): Promise<Buffer> {
    if (keyCache.has(keyUrl)) return keyCache.get(keyUrl);
    const res = await fetchBuffer(keyUrl, headers);
    if (res.status >= 400) throw new Error(`HTTP ${res.status} for key`);
    keyCache.set(keyUrl, res.body);
    return res.body;
  }

  private static getM3u8DownloadThreads(): number {
    const configured = Application.instance?.settings?.object?.m3u8DownloadThreads;
    if (typeof configured !== 'number' || !Number.isFinite(configured)) {
      return DEFAULT_SETTINGS.m3u8DownloadThreads;
    }
    return Math.max(
      MIN_M3U8_DOWNLOAD_THREADS,
      Math.min(MAX_M3U8_DOWNLOAD_THREADS, Math.round(configured)),
    );
  }

  private static async transmuxHlsToMp4(job: MediaJob, total: number): Promise<boolean> {
    const t = getMainTranslator(Application.instance.settings?.object?.language);
    const transmuxer = new MuxJs.mp4.Transmuxer();
    const output: Mp4TransmuxedSegment[] = [];
    let wroteInitSegment = false;
    let lastInitSegment: Buffer | undefined;
    const outputFile = await fsp.open(job.savePath, 'w');
    let completed = false;

    transmuxer.on('data', (segment) => output.push(segment));

    try {
      for (let i = 0; i < total; i++) {
        if (job.paused || job.canceled) return false;

        const partPath = join(job.partsDir, `${String(i).padStart(6, '0')}.part`);
        if (!existsSync(partPath)) {
          if (job.skippedSegments?.has(i)) {
            console.warn(`[media-download] skip failed TS segment ${i}`);
            continue;
          }
          throw new Error(t('mdSegFileMissing', {index: i + 1}));
        }
        const part = await fsp.readFile(partPath);
        output.length = 0;
        transmuxer.push(part);
        transmuxer.flush();

        if (!output.length) {
          throw createFatalHlsError(
            t('mdSegNotMp4Compatible', {index: i + 1}),
          );
        }

        for (const segment of output) {
          if (segment.initSegment?.length) {
            const initSegment = Buffer.from(segment.initSegment);
            if (!lastInitSegment || !lastInitSegment.equals(initSegment)) {
              await outputFile.write(initSegment);
              lastInitSegment = initSegment;
            }
            wroteInitSegment = true;
          }
          if (segment.data?.length) {
            await outputFile.write(Buffer.from(segment.data));
          }
        }
      }

      if (!wroteInitSegment) {
        throw createFatalHlsError(
          t('mdMp4InitMissing'),
        );
      }

      completed = true;
      return true;
    } finally {
      try {
        await outputFile.close();
        if (!completed || job.canceled) {
          await fsp.rm(job.savePath, {force: true}).catch(() => undefined);
        }
      } finally {
        transmuxer.dispose?.();
      }
    }
  }

  // ── hls/m3u8：切片续传 ──
  // 返回 true=完成并已合并；false=暂停(切片留在 partsDir，等 resume)
  private static async runHls(job: MediaJob): Promise<boolean> {
    const t = getMainTranslator(Application.instance.settings?.object?.language);
    // 首次：解析 playlist(master → child)，建临时目录
    if (!job.segments) {
      let content = await fetchText(job.url, job.headers);
      let parsed = parseM3u8(content, job.url);
      let playlistUrl = job.url;
      if (parsed.masterChild) {
        playlistUrl = parsed.masterChild;
        content = await fetchText(playlistUrl, job.headers);
        parsed = parseM3u8(content, playlistUrl);
      }
      if (!parsed.segments.length) throw new Error(t('mdPlaylistNoSegments'));
      job.segments = parsed.segments;
      job.totalBytes = 0;
      await fsp.mkdir(job.partsDir, {recursive: true});
    }

    const segments = job.segments;
    const total = segments.length;

    // 每次启动/恢复都以临时目录为准重建进度。并发下载会产生非连续分片，
    // 不能再只依赖单一 segIndex 判断续传位置。
    const pending: number[] = [];
    let completedCount = 0;
    job.receivedBytes = 0;
    for (let i = 0; i < total; i++) {
      const partPath = join(job.partsDir, `${String(i).padStart(6, '0')}.part`);
      if (existsSync(partPath)) {
        try {
          job.receivedBytes += statSync(partPath).size;
          completedCount++;
          continue;
        } catch (e) {
        }
      }
      pending.push(i);
    }
    job.totalBytes = completedCount > 0
      ? Math.round((job.receivedBytes / completedCount) * total)
      : 0;
    this.progress(job, true);

    let pendingIndex = 0;
    let processedCount = completedCount;
    const retryDelays = HLS_SEGMENT_RETRY_DELAYS;
    const downloadNext = async () => {
      while (!job.paused && !job.canceled && !job.fatalError) {
        const queueIndex = pendingIndex++;
        if (queueIndex >= pending.length) return;

        const i = pending[queueIndex];
        const seg = segments[i];
        const partPath = join(job.partsDir, `${String(i).padStart(6, '0')}.part`);
        let downloaded = false;
        let lastError: any;
        for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
          if (job.paused || job.canceled) return;
          try {
            console.log(
              '[media-download] TS request',
              JSON.stringify({
                index: i,
                attempt: attempt + 1,
                maxAttempts: retryDelays.length + 1,
                url: seg.url,
                headers: headersForLog(job.headers),
              }),
            );
            const res = await fetchBuffer(seg.url, job.headers);
            if (res.status >= 400) {
              throw new Error(`HTTP ${res.status} for segment ${i}`);
            }
            let data = res.body;

            if (seg.keyUrl) {
              const key = await this.getKey(seg.keyUrl, job.headers);
              const iv = seg.iv && seg.iv.length === 16 ? seg.iv : defaultIv(i);
              const decipher = createDecipheriv('aes-128-cbc', key, iv);
              decipher.setAutoPadding(false);
              data = Buffer.concat([decipher.update(data), decipher.final()]);
            }

            // mux.js 只支持 H.264/AAC。首个可用分片先做预检，避免 HEVC
            // 流全部下载完后才发现无法生成 MP4。
            if (!job.transmuxProbeDone) {
              if (!canTransmuxSegment(data)) {
                const unsupported = createFatalHlsError(
                  t('mdHlsHevcUnsupported'),
                );
                job.fatalError = true;
                throw unsupported;
              }
              job.transmuxProbeDone = true;
            }

            await fsp.writeFile(partPath, data);
            job.receivedBytes += data.length;
            completedCount++;
            processedCount++;
            job.totalBytes = Math.round((job.receivedBytes / processedCount) * total);
            this.progress(job);
            downloaded = true;
            break;
          } catch (e) {
            lastError = e;
            if ((e as any)?.code === 'HLS_TRANSMUX_UNSUPPORTED') {
              job.fatalError = true;
              return;
            }
            if (attempt < retryDelays.length) {
              const delay = retryDelays[attempt];
              console.warn(
                `[media-download] TS segment ${i} failed, retry ${attempt + 1}/${retryDelays.length} in ${delay}ms:`,
                (e as any)?.message || String(e),
              );
              if (!(await waitForHlsRetry(job, delay))) return;
            }
          }
        }

        if (!downloaded) {
          job.skippedSegments?.add(i);
          processedCount++;
          job.totalBytes = processedCount > 0
            ? Math.round((job.receivedBytes / processedCount) * total)
            : 0;
          console.error(
            `[media-download] TS segment ${i} skipped after ${retryDelays.length} retries:`,
            lastError?.message || String(lastError),
          );
          this.progress(job, true);
        }
      }
    };

    const workerCount = Math.min(this.getM3u8DownloadThreads(), pending.length);
    await Promise.all(Array.from({length: workerCount}, () => downloadNext()));

    if (job.fatalError) {
      throw createFatalHlsError(
        t('mdHlsRemuxUnsupported'),
      );
    }

    if (job.paused || job.canceled) return false;
    if (!job.skippedSegments?.size) {
      job.totalBytes = job.receivedBytes;
    } else {
      console.warn(
        `[media-download] completed with ${job.skippedSegments.size} skipped TS segment(s); parts retained at ${job.partsDir}`,
      );
    }

    // 全部切片就绪 → 逐片重封装，避免把整部视频一次性载入内存。
    const transmuxed = await this.transmuxHlsToMp4(job, total);
    if (!transmuxed) return false;

    // MP4 封装完成删临时目录
    if (!job.skippedSegments?.size) {
      await fsp.rm(job.partsDir, {recursive: true, force: true}).catch(() => undefined);
    }
    return true;
  }
}

// 注册一次：播放器窗口通过 IPC 触发下载；下载面板的暂停/恢复/取消/移除复用同名频道。
let registered = false;
export const setupMediaDownloader = () => {
  if (registered) return;
  registered = true;

  // 播放器加入下载队列(立即返回，进面板)
  ipcMain.handle('media-download', async (event, task: MediaDownloadTask) => {
    try {
      const id = MediaDownloadManager.start(task);
      // 触发主窗口弹出下载面板(与原生下载一致)
      try {
        Application.instance.windows.broadcast('show-download-dialog');
      } catch (e) {
      }
      return {ok: true, id};
    } catch (e: any) {
      return {ok: false, message: e?.message || String(e)};
    }
  });

  // 下载页面创建任务：先在所属浏览器窗口的后台 View 中嗅探，再交给独立传输器。
  ipcMain.handle('media-download-create', async (event, input: {pageUrl: string; fileName?: string}) => {
    try {
      const browserWindow = BrowserWindow.fromWebContents(event.sender);
      const appWindow = browserWindow
        ? Application.instance.windows.fromBrowserWindow(browserWindow)
        : Application.instance.windows.current;
      const id = MediaDownloadManager.startFromPage(input?.pageUrl || '', input?.fileName, appWindow);
      try {
        Application.instance.windows.broadcast('show-download-dialog');
      } catch (e) {
      }
      return {ok: true, id};
    } catch (e: any) {
      return {ok: false, message: e?.message || String(e)};
    }
  });

  // 下载面板控制：仅处理媒体任务 id，非媒体 id 交回原生处理
  ipcMain.on('download-pause', (e, id) => {
    if (MediaDownloadManager.has(id)) MediaDownloadManager.pause(id);
  });
  ipcMain.on('download-resume', (e, id) => {
    if (MediaDownloadManager.has(id)) MediaDownloadManager.resume(id);
  });
  ipcMain.on('download-cancel', (e, id) => {
    if (MediaDownloadManager.has(id)) MediaDownloadManager.cancel(id);
  });
  ipcMain.on('download-remove', (e, id) => {
    if (MediaDownloadManager.has(id)) MediaDownloadManager.remove(id);
  });
};
