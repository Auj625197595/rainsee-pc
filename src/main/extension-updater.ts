// 扩展程序「检测更新 / 自动更新」——复刻 Chrome 的扩展更新行为。
//
// 思路:对每个已安装扩展直接请求 Chrome 与 Edge 两个官方更新端点
// (Edge: https://edge.microsoft.com/extensionwebstorebase/v1/crx,
//  Chrome: https://clients2.google.com/service/update2/crx)。这两个端点都支持
// Chrome 自己用的 gupdate / Omaha 更新检查协议:
//   GET <endpoint>?response=updatecheck&prodversion=<chrome>&acceptformat=crx2,crx3&x=id%3D<id>%26uc
// 返回 <updatecheck status="ok" codebase="<crx 地址>" version="<新版本>"/>,据此比较版本、
// 下载新 crx,复用 SessionsService.installExtensionFromCrxInfo 落盘并重载。

import { app, powerMonitor } from 'electron';
import { promises } from 'fs';
import { resolve } from 'path';

import { getPath } from '~/utils';
import { parseCrx } from '~/utils/crx';
import { tlog } from './timing';
import { Application } from './application';
import type { SessionsService } from './sessions-service';

const UPDATE_CHECK_INTERVAL = 5 * 60 * 60 * 1000; // 每 5 小时检查一次(与 Chrome 一致)
const MIN_UPDATE_INTERVAL = 3 * 60 * 60 * 1000; // 两次检查的最小间隔
const SYSTEM_IDLE_THRESHOLD = 60 * 60; // 秒:用户空闲超过 1 小时则跳过本次检查
const STARTUP_DELAY = 30 * 1000; // 启动后延迟首检,避开启动高峰
const UPDATE_ENDPOINTS = [
  'https://clients2.google.com/service/update2/crx',
  'https://edge.microsoft.com/extensionwebstorebase/v1/crx',
] as const;

/** 上次检查时间(进程内存,重启即重置)。 */
let lastUpdateCheck: number | undefined;
/** 进行中的检查标记,避免手动 + 后台并发重入。 */
let checking = false;

/** 网络抖动重试:对 edge.microsoft.com / clients2.google.com 的请求在部分网络下
 *  频繁 ECONNRESET / 连接被重置,单次 fetch 失败率可观。指数退避重试几次。 */
async function fetchWithRetry(
  url: string,
  opts: {tries?: number; timeoutMs?: number} = {},
): Promise<Response | null> {
  const tries = opts.tries ?? 3;
  for (let i = 0; i < tries; i++) {
    try {
      return await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30000),
      });
    } catch (e: any) {
      tlog(
        `ext-update: request failed attempt=${i + 1}/${tries} url=${url} error=${String(
          e?.message || e,
        )}`,
      );
      if (i === tries - 1) return null;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  return null;
}

interface InstalledExt {
  id: string;
  name: string;
  version: string;
}

interface AvailableUpdate {
  id: string;
  name: string;
  fromVersion: string;
  toVersion: string;
  url: string; // codebase:新版本 crx 下载地址
}

export interface UpdateResult {
  checked: number;
  updated: Array<{ id: string; name: string; fromVersion: string; toVersion: string }>;
  failed: Array<{ id: string; name: string; error: string }>;
}

/**
 * 检查并更新一个指定的扩展。与全量检查共用同一把进程级锁，避免同时
 * 覆盖扩展目录；checked=1 且 updated 为空表示该扩展已经是最新版本。
 */
export async function updateExtension(
  sessions: SessionsService,
  id: string,
): Promise<UpdateResult> {
  const empty: UpdateResult = { checked: 0, updated: [], failed: [] };
  if (!process.env.ENABLE_EXTENSIONS) {
    tlog(`ext-update: single ${id || '(empty)'} skipped, ENABLE_EXTENSIONS is not set`);
    return empty;
  }
  if (!sessions || !id) {
    tlog(`ext-update: single skipped invalid args id=${id} sessions=${!!sessions}`);
    return empty;
  }
  if (checking) {
    tlog(`ext-update: single ${id} skipped, another update check is running`);
    return empty;
  }

  checking = true;
  lastUpdateCheck = Date.now();
  try {
    const installed = await listInstalledExtensions(true);
    tlog(
      `ext-update: single target=${id} candidates=${installed
        .map((item) => `${item.id}@${item.version}`)
        .join(',')}`,
    );
    const target = installed.find((item) => item.id === id);
    // 本地加载的扩展可能没有可用的更新元数据；对用户而言这仍然是一次
    // 成功检查，只是没有可用更新。
    if (!target) {
      tlog(`ext-update: single ${id} has no eligible update manifest`);
      return { checked: 1, updated: [], failed: [] };
    }

    const update = await checkExtensionUpdate(target);
    if (!update) {
      tlog(`ext-update: single ${id} no update available`);
      return { checked: 1, updated: [], failed: [] };
    }

    tlog(
      `ext-update: single ${id} update available ${update.fromVersion} -> ${update.toVersion} codebase=${update.url}`,
    );

    try {
      const ext = await applyUpdate(sessions, update);
      return {
        checked: 1,
        updated: [{
          id: update.id,
          name: (ext && ext.name) || update.name,
          fromVersion: update.fromVersion,
          toVersion: update.toVersion,
        }],
        failed: [],
      };
    } catch (e: any) {
      return {
        checked: 1,
        updated: [],
        failed: [{
          id: update.id,
          name: update.name,
          error: String(e?.message || e),
        }],
      };
    }
  } catch (e: any) {
    tlog(`ext-update: single ${id} failed`, e);
    return {
      checked: 0,
      updated: [],
      failed: [{ id, name: id, error: String(e?.message || e) }],
    };
  } finally {
    checking = false;
  }
}

/** 点分数字版本比较:a<b 返回 -1,a>b 返回 1,相等返回 0。 */
export function compareVersions(a: string, b: string): number {
  const pa = String(a || '').split('.');
  const pb = String(b || '').split('.');
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = parseInt(pa[i] || '0', 10) || 0;
    const nb = parseInt(pb[i] || '0', 10) || 0;
    if (na !== nb) return na < nb ? -1 : 1;
  }
  return 0;
}

/** 解析 gupdate 的 <updatecheck .../> 属性(无需引入 XML 依赖)。 */
function parseUpdateCheckXml(
  xml: string,
): { status?: string; codebase?: string; version?: string } | null {
  if (!xml) return null;
  const tag = xml.match(/<updatecheck\b([^>]*)>/i);
  if (!tag) return null;
  const attrs = tag[1];
  const decodeXml = (value: string) =>
    value
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  const attr = (name: string) => {
    const m = attrs.match(
      new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'),
    );
    return m ? decodeXml(m[1] ?? m[2] ?? '') : undefined;
  };
  return {
    status: attr('status'),
    codebase: attr('codebase'),
    version: attr('version'),
  };
}

/**
 * 读取 data/extensions/ 下每个目录的 manifest,收集可更新的扩展。
 * 默认跳过停用扩展(供后台/全量更新使用)，单项检查可显式包含停用扩展。
 * 更新服务不再依赖 manifest.update_url；每个扩展 ID 都会请求 Chrome 和 Edge
 * 两个官方接口各一次，再从返回结果中选择最高版本。
 */
async function listInstalledExtensions(includeDisabled = false): Promise<InstalledExt[]> {
  const extensionsPath = getPath('extensions');
  if (!extensionsPath) {
    tlog('ext-update: extensions path unavailable');
    return [];
  }

  let dirs: string[];
  try {
    dirs = await promises.readdir(extensionsPath);
  } catch (e) {
    tlog(`ext-update: cannot read extensions path=${extensionsPath}`, e);
    return [];
  }

  tlog(`ext-update: scanning path=${extensionsPath} dirs=${dirs.length}`);

  const disabled = new Set(
    Application.instance?.settings?.object?.disabledExtensions || [],
  );

  const out: InstalledExt[] = [];
  for (const dir of dirs) {
    if (!includeDisabled && disabled.has(dir)) {
      tlog(`ext-update: skip disabled ${dir}`);
      continue;
    } // 停用的扩展跳过更新
    try {
      const manifestPath = resolve(extensionsPath, dir, 'manifest.json');
      const manifest = JSON.parse(await promises.readFile(manifestPath, 'utf8'));
      if (!manifest?.version) {
        tlog(
          `ext-update: skip ${dir} missing manifest version`,
        );
        continue;
      }
      tlog(
        `ext-update: eligible ${dir} name=${String(manifest?.name || dir)} version=${String(
          manifest.version,
        )} endpoints=${UPDATE_ENDPOINTS.join(',')}`,
      );
      out.push({
        id: dir, // 安装目录以扩展 id 命名
        name: manifest?.name || dir,
        version: manifest.version,
      });
    } catch (e) {
      tlog(`ext-update: skip ${dir} manifest read failed`, e);
      // 跳过坏目录 / 无 manifest 的目录
    }
  }
  return out;
}

/** 向指定更新服务发起一次 gupdate 检查；有更新返回详情，否则 null。 */
async function checkExtensionUpdate(
  ext: InstalledExt,
): Promise<AvailableUpdate | null> {
  const results = await Promise.all(
    UPDATE_ENDPOINTS.map((endpoint) => checkExtensionUpdateAt(ext, endpoint)),
  );
  const available = results.filter(
    (item): item is AvailableUpdate => !!item,
  );
  if (available.length === 0) return null;
  return available.reduce((best, item) =>
    compareVersions(best.toVersion, item.toVersion) >= 0 ? best : item,
  );
}

async function checkExtensionUpdateAt(
  ext: InstalledExt,
  endpoint: string,
): Promise<AvailableUpdate | null> {
  const chromeVer = process.versions.chrome || '120.0';
  // x= 里必须带 v=<当前版本>(参考 PC 端 Java 实现 getCrxUpdateMsg):
  // Edge 商店端点缺 v= 时直接 HTTP 500(逐参数对照实测定位),Google 端点无所谓。
  const x = encodeURIComponent(
    `id=${ext.id}&installsource=ondemand&v=${ext.version}&uc`,
  );
  const sep = endpoint.includes('?') ? '&' : '?';
  const url =
    `${endpoint}${sep}response=updatecheck` +
    `&prodversion=${chromeVer}&acceptformat=crx2,crx3&x=${x}`;

  tlog(
    `ext-update: check start id=${ext.id} version=${ext.version} endpoint=${endpoint} request=${url}`,
  );

  let text: string;
  const res = await fetchWithRetry(url, {tries: 3, timeoutMs: 20000});
  if (!res) {
    tlog(`ext-update: check failed (network) id=${ext.id} endpoint=${endpoint}`);
    return null;
  }
  if (!res.ok) {
    tlog(`ext-update: check http=${res.status} id=${ext.id} endpoint=${endpoint}`);
    return null;
  }
  text = await res.text().catch(() => '');

  tlog(
    `ext-update: check response id=${ext.id} endpoint=${endpoint} http=${res.status} final_url=${res.url} bytes=${text.length} body=${text
      .replace(/[\r\n\t]+/g, ' ')
      .slice(0, 1200)}`,
  );

  const parsed = parseUpdateCheckXml(text);
  tlog(
    `ext-update: check parsed id=${ext.id} endpoint=${endpoint} status=${String(
      parsed?.status,
    )} version=${String(parsed?.version)} codebase=${String(parsed?.codebase)}`,
  );
  if (!parsed || parsed.status !== 'ok' || !parsed.codebase || !parsed.version) {
    tlog(`ext-update: check no usable update id=${ext.id} endpoint=${endpoint}`);
    return null; // noupdate / 解析失败 / 缺 codebase —— 一律视为无更新
  }
  const comparison = compareVersions(ext.version, parsed.version);
  tlog(
    `ext-update: check compare id=${ext.id} endpoint=${endpoint} installed=${ext.version} remote=${parsed.version} result=${comparison}`,
  );
  if (comparison >= 0) {
    return null; // 已是最新或更高
  }

  return {
    id: ext.id,
    name: ext.name,
    fromVersion: ext.version,
    toVersion: parsed.version,
    url: parsed.codebase,
  };
}

/** 下载新 crx 并覆盖安装(仅对启用的扩展调用)。 */
async function applyUpdate(
  sessions: SessionsService,
  update: AvailableUpdate,
): Promise<Electron.Extension> {
  tlog(
    `ext-update: downloading ${update.id} ${update.fromVersion} -> ${update.toVersion}`,
  );
  const res = await fetchWithRetry(update.url, {tries: 3, timeoutMs: 120000});
  if (!res) throw new Error('download failed (network)');
  if (!res.ok) throw new Error(`download http ${res.status}`);
  const crxBuf = Buffer.from(await res.arrayBuffer());
  const crxInfo = parseCrx(crxBuf);
  // 下载完整性:截断的 crx 会在 zip 层抛错或解出不完整目录,先校验 zip 尾部签名。
  if (
    crxInfo?.zip &&
    crxInfo.zip.length > 0 &&
    crxInfo.zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) < 0
  ) {
    throw new Error('download truncated (missing EOCD)');
  }

  // 安全校验:下载到的 crx 必须与目标扩展同一身份(同签名 → 同 id),否则拒绝覆盖,
  // 防止更新服务返回另一扩展的包。
  if (crxInfo.id && crxInfo.id !== update.id) {
    throw new Error(`crx id mismatch: got ${crxInfo.id}, expected ${update.id}`);
  }

  const wasDisabled = new Set(
    Application.instance?.settings?.object?.disabledExtensions || [],
  ).has(update.id);

  sessions.setExtensionTransitioning(update.id, false, true);
  let ext: Electron.Extension;
  try {
    // 先卸掉已加载的旧版本(参考 reloadExtension),再覆盖安装。
    try {
      const extensionApi = (sessions.view as any).extensions || sessions.view;
      await extensionApi.removeExtension(update.id);
    } catch {
      // 理论上启用的扩展都已加载;万一未加载,忽略
    }

    ext = await sessions.installExtensionFromCrxInfo(crxInfo, true);
    // 单项检测允许停用扩展参与检查；更新完成后恢复停用状态，避免更新操作
    // 意外把用户主动停用的扩展重新加载。
    if (wasDisabled) {
      await sessions.setExtensionEnabled(update.id, false);
      tlog(`ext-update: restored disabled state ${update.id}`);
    }
  } finally {
    sessions.setExtensionTransitioning(update.id, false, false);
  }

  // 刷新工具栏图标(与商店安装一致)。
  if (ext && !wasDisabled && !(ext.manifest as any)?.theme) {
    // 这里加载的是普通 session 的扩展实例，不能广播到无痕窗口；否则未获
    // 「在无痕模式下启用」权限的已固定扩展会重新出现在地址栏工具栏。
    for (const window of Application.instance.windows.list.filter(
      (item) => !item.incognito,
    )) {
      window.send('load-browserAction', ext);
    }
  }

  return ext;
}

/**
 * 检查全部已安装扩展并升级有新版本者。手动「检查更新」与后台自动更新共用此入口。
 */
export async function updateAllExtensions(
  sessions: SessionsService,
): Promise<UpdateResult> {
  const empty: UpdateResult = { checked: 0, updated: [], failed: [] };
  if (!process.env.ENABLE_EXTENSIONS) {
    tlog('ext-update: all skipped, ENABLE_EXTENSIONS is not set');
    return empty;
  }
  if (!sessions) {
    tlog('ext-update: all skipped, sessions service unavailable');
    return empty;
  }
  if (checking) {
    tlog('ext-update: already checking, skip');
    return empty;
  }

  checking = true;
  lastUpdateCheck = Date.now();
  const updated: UpdateResult['updated'] = [];
  const failed: UpdateResult['failed'] = [];

  try {
    const installed = await listInstalledExtensions();
    tlog(`ext-update: checking ${installed.length} extension(s)`);

    // 并发检查更新(只读请求),逐个串行安装(避免同时大量下载/解压)。
    const checks = await Promise.all(
      installed.map((ext) =>
        checkExtensionUpdate(ext).catch((e) => {
          tlog(`ext-update: check exception id=${ext.id}`, e);
          return null;
        }),
      ),
    );
    const updates = checks.filter((u): u is AvailableUpdate => !!u);
    tlog(`ext-update: ${updates.length} update(s) available`);

    for (const u of updates) {
      try {
        const ext = await applyUpdate(sessions, u);
        updated.push({
          id: u.id,
          name: (ext && ext.name) || u.name,
          fromVersion: u.fromVersion,
          toVersion: u.toVersion,
        });
        tlog(`ext-update: updated ${u.id} -> ${u.toVersion}`);
      } catch (e: any) {
        failed.push({ id: u.id, name: u.name, error: String(e?.message || e) });
        tlog(`ext-update: FAILED ${u.id}`, e);
      }
    }

    return { checked: installed.length, updated, failed };
  } catch (e) {
    tlog('ext-update: updateAllExtensions error', e);
    return { checked: 0, updated, failed };
  } finally {
    checking = false;
  }
}

/**
 * 安装后台自动更新:启动后延迟首检,之后每 5 小时一次,并在窗口获得焦点时尝试。
 * 受设置开关、系统空闲态、最小间隔三重门控。
 */
export function initExtensionAutoUpdater(sessions: SessionsService): void {
  if (!process.env.ENABLE_EXTENSIONS) return;

  const autoUpdateEnabled = () =>
    Application.instance?.settings?.object?.extensionsAutoUpdate !== false;

  const maybeCheck = () => {
    if (!autoUpdateEnabled()) return;
    try {
      if (powerMonitor.getSystemIdleState(SYSTEM_IDLE_THRESHOLD) !== 'active') return;
    } catch {
      // powerMonitor 在个别平台/早期可能不可用,忽略空闲门控
    }
    if (lastUpdateCheck && Date.now() - lastUpdateCheck < MIN_UPDATE_INTERVAL) return;
    void updateAllExtensions(sessions);
  };

  app.on('browser-window-focus', maybeCheck);
  if (process.platform === 'darwin') app.on('did-become-active', maybeCheck);

  const intervalId = setInterval(maybeCheck, UPDATE_CHECK_INTERVAL);
  const startupTimer = setTimeout(maybeCheck, STARTUP_DELAY);

  app.on('before-quit', () => {
    clearInterval(intervalId);
    clearTimeout(startupTimer);
  });

  tlog('ext-update: auto-updater initialized');
}
