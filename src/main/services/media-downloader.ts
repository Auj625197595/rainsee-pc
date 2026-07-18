import {app, net, ipcMain} from 'electron';
import {createWriteStream, promises as fsp, existsSync, statSync} from 'fs';
import {join, resolve, parse as parsePath} from 'path';
import {createDecipheriv} from 'crypto';
import {URL} from 'url';
import {Application} from '../application';
import {IDownloadItem} from '~/interfaces';
import {makeId} from '~/utils';

// 媒体下载服务：支持 m3u8(解析切片 + AES-128 解密 + 合并)与 mp4 等直链。
// 所有网络请求复用嗅探时保存、清理后的请求头(Referer/Origin/Cookie/UA)，绕过防盗链。
//
// 关键设计：媒体下载接入浏览器原生下载面板。MediaDownloadManager 维护任务表，
// 向下载弹窗与主窗口广播与原生下载同构的 IDownloadItem 事件
// (download-started/progress/paused/completed/canceled)，并支持断点续传：
//   - mp4/直链：暂停=abort 保留半成品；恢复=带 Range 续传(206 追加,200 截断重下)
//   - hls    ：切片下到临时目录边下边解密；暂停=当前切片下完即停；
//              恢复=从 segIndex 继续(已存在 .part 跳过)；完成=按序合并为 .ts

const PARTITION = 'persist:mediaplayer';

export interface MediaDownloadTask {
  id?: string;
  url: string;
  mediaType: string; // 'hls' | 'mp4' | 'other'
  headers: Record<string, string>;
  fileName: string;
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
  paused: boolean;
  canceled: boolean;
  completed: boolean;
  // 运行控制
  request?: Electron.ClientRequest; // 当前直链请求(用于 abort)
  running: boolean;                 // 是否有循环在跑(避免重复 resume)
  // hls 续传
  isHls: boolean;
  segments?: M3u8Segment[];
  segIndex: number;
  partsDir?: string;
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
  return new Promise((resolve, reject) => {
    const request = net.request({url, partition: PARTITION, useSessionCookies: true});
    const all = {...(headers || {}), ...(extra || {})};
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
      response.on('end', () =>
        resolve({
          status: response.statusCode,
          body: Buffer.concat(chunks),
          headers: response.headers as Record<string, any>,
        }),
      );
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });
};

const fetchText = async (url: string, headers: Record<string, string>): Promise<string> => {
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

const keyCache = new Map<string, Buffer>();

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
      savePath: j.savePath,
      url: j.url,
      paused: j.paused,
      completed: j.completed,
      canceled: j.canceled,
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

  // 新建并启动一个媒体下载任务，返回 id
  public static start(task: MediaDownloadTask): string {
    const id = task.id || makeId(32);
    const isHls =
      task.mediaType === 'hls' || (task.url || '').toLowerCase().includes('.m3u8');
    const savePath = this.uniqueSavePath(task.fileName);
    const job: MediaJob = {
      id,
      url: task.url,
      mediaType: task.mediaType,
      headers: task.headers || {},
      fileName: parsePath(savePath).base,
      savePath,
      receivedBytes: 0,
      totalBytes: 0,
      paused: false,
      canceled: false,
      completed: false,
      running: false,
      isHls,
      segIndex: 0,
    };
    if (isHls) {
      job.partsDir = join(this.getDownloadDir(), `.${id}.parts`);
    }
    this.jobs.set(id, job);

    this.emit('download-started', this.toItem(job));
    this.run(job);
    return id;
  }

  public static pause(id: string) {
    const job = this.jobs.get(id);
    if (!job || job.completed || job.canceled) return;
    job.paused = true;
    try {
      job.request?.abort();
    } catch (e) {
    }
    this.emit('download-paused', id);
  }

  public static resume(id: string) {
    const job = this.jobs.get(id);
    if (!job || job.completed || job.canceled || job.running) return;
    job.paused = false;
    this.emit('download-progress', this.toItem(job));
    this.run(job);
  }

  public static cancel(id: string) {
    const job = this.jobs.get(id);
    if (!job) return;
    job.canceled = true;
    job.paused = false;
    try {
      job.request?.abort();
    } catch (e) {
    }
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
      this.cleanup(job);
    }
    this.jobs.delete(id);
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
  private static progress(job: MediaJob) {
    this.emit('download-progress', this.toItem(job));
  }

  private static done(job: MediaJob) {
    job.completed = true;
    job.running = false;
    this.emit('download-completed', job.id);
    this.emit('download-progress', this.toItem(job));
  }

  private static fail(job: MediaJob, message: string) {
    job.running = false;
    if (job.canceled) return;
    // 失败按取消处理，面板显示 Canceled
    job.canceled = true;
    console.log(`[media-download] ${job.fileName} failed: ${message}`);
    this.emit('download-canceled', job.id);
  }

  // 调度入口
  private static run(job: MediaJob) {
    if (job.running) return;
    job.running = true;
    const work = job.isHls ? this.runHls(job) : this.runDirect(job);
    work
      .then((finished) => {
        if (finished) this.done(job);
        else job.running = false; // 暂停态：保留进度，等 resume
      })
      .catch((e: any) => this.fail(job, e?.message || String(e)));
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
      if (startByte > 0) extra['Range'] = `bytes=${startByte}-`;

      const request = net.request({
        url: job.url,
        partition: PARTITION,
        useSessionCookies: true,
      });
      job.request = request;
      const all = {...(job.headers || {}), ...extra};
      for (const key of Object.keys(all)) {
        try {
          request.setHeader(key, all[key]);
        } catch (e) {
        }
      }

      request.on('response', (response) => {
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
        response.on('data', (chunk: Buffer) => {
          job.receivedBytes += chunk.length;
          ws.write(chunk);
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
        job.request = undefined;
        if (job.paused || job.canceled) resolveRun(false);
        else rejectRun(err);
      });
      request.end();
    });
  }

  private static async getKey(keyUrl: string, headers: Record<string, string>): Promise<Buffer> {
    if (keyCache.has(keyUrl)) return keyCache.get(keyUrl);
    const res = await fetchBuffer(keyUrl, headers);
    if (res.status >= 400) throw new Error(`HTTP ${res.status} for key`);
    keyCache.set(keyUrl, res.body);
    return res.body;
  }

  // ── hls/m3u8：切片续传 ──
  // 返回 true=完成并已合并；false=暂停(切片留在 partsDir，等 resume)
  private static async runHls(job: MediaJob): Promise<boolean> {
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
      if (!parsed.segments.length) throw new Error('m3u8 中未解析到任何切片');
      job.segments = parsed.segments;
      job.totalBytes = 0;
      await fsp.mkdir(job.partsDir, {recursive: true});
    }

    const segments = job.segments;
    const total = segments.length;

    for (; job.segIndex < total; job.segIndex++) {
      if (job.paused) return false;
      if (job.canceled) return false;

      const i = job.segIndex;
      const seg = segments[i];
      const partPath = join(job.partsDir, `${String(i).padStart(6, '0')}.part`);

      // 已存在的切片跳过(续传)
      if (existsSync(partPath)) {
        try {
          job.receivedBytes += statSync(partPath).size;
        } catch (e) {
        }
        // 按已完成比例估算总量，进度条可用
        job.totalBytes = Math.round((job.receivedBytes / (i + 1)) * total);
        this.progress(job);
        continue;
      }

      const res = await fetchBuffer(seg.url, job.headers);
      if (res.status >= 400) throw new Error(`HTTP ${res.status} for segment ${i}`);
      let data = res.body;

      if (seg.keyUrl) {
        const key = await this.getKey(seg.keyUrl, job.headers);
        const iv = seg.iv && seg.iv.length === 16 ? seg.iv : defaultIv(i);
        const decipher = createDecipheriv('aes-128-cbc', key, iv);
        decipher.setAutoPadding(false);
        data = Buffer.concat([decipher.update(data), decipher.final()]);
      }

      await fsp.writeFile(partPath, data);
      job.receivedBytes += data.length;
      job.totalBytes = Math.round((job.receivedBytes / (i + 1)) * total);
      this.progress(job);
    }

    if (job.canceled) return false;

    // 全部切片就绪 → 按序合并为 .ts
    const ws = createWriteStream(job.savePath);
    for (let i = 0; i < total; i++) {
      const partPath = join(job.partsDir, `${String(i).padStart(6, '0')}.part`);
      const buf = await fsp.readFile(partPath);
      await new Promise<void>((res, rej) => ws.write(buf, (e) => (e ? rej(e) : res())));
    }
    await new Promise<void>((res) => ws.end(() => res()));
    // 合并完成删临时目录
    await fsp.rm(job.partsDir, {recursive: true, force: true}).catch(() => undefined);
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
