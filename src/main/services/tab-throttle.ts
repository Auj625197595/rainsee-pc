// [内存节省] 后台标签轻量节流(item 2)。仅当「内存节省」(settings.memorySaver,
// 默认开)启用时生效;关闭则空转。
//
// 机制:每 60s 巡检所有窗口的标签,对「非当前、非放音、闲置 > IDLE_LIMIT」的后台标签
// 发 `tab-release-memory`(view-preload 收到后 webFrame.clearCache())。这是「不重载」
// 前提下唯一能实际回收部分渲染进程内存的手段——Electron 对后台标签本就默认
// setBackgroundThrottling(true)(定时器/rAF 已节流),故此处只补「释放内存缓存」这一环。
//
// 诚实预期:内存回收有限(只清内存缓存,不释放页面 DOM/JS 堆),主要收益是解码图片等
// 缓存。要大幅省标签内存需「真销毁式」(销毁 webContents + 占位重载),本服务的巡检骨架
// 可平滑升级到那一档。

import { ipcMain } from 'electron';
import { Application } from '../application';

// 后台标签闲置多久后释放缓存(毫秒)。用户选定 30 分钟。
const IDLE_LIMIT_MS = 30 * 60 * 1000;
// 巡检周期。
const PATROL_INTERVAL_MS = 60 * 1000;
// 同一标签两次释放的最小间隔:仍持续闲置时,每 IDLE_LIMIT_MS 再清一次即可,避免频繁 IPC。
const RE_RELEASE_MS = IDLE_LIMIT_MS;

// 每个标签最近一次被释放缓存的时间戳(按 view.webContents.id)。
const lastReleasedAt = new Map<number, number>();

const memorySaverOn = (): boolean =>
  (Application.instance?.settings?.object as any)?.memorySaver !== false;

const patrol = () => {
  if (!memorySaverOn()) return;

  const now = Date.now();
  const liveIds = new Set<number>();

  for (const appWindow of Application.instance?.windows?.list || []) {
    const vm = appWindow?.viewManager;
    if (!vm) continue;

    for (const [id, view] of vm.views) {
      liveIds.add(id);

      // 跳过当前激活标签。
      if (id === vm.selectedId) continue;

      // 整段包 try:webContents getter 对已销毁/占位 view 可能抛错,绝不能让 60s
      // 巡检定时器抛出未捕获异常。
      try {
        const wc = view?.webContents;
        if (!wc || wc.isDestroyed()) continue;

        // 正在放音/视频的后台标签不动(可能是用户在听的后台音乐/视频)。
        if (wc.isCurrentlyAudible()) continue;

        // 最近活跃时间由 create()(创建即置)/select()(选中刷新)维护。缺失(异常)
        // 时保守跳过。
        const lastActive = vm.lastActiveAt.get(id) || 0;
        if (!lastActive) continue;
        if (now - lastActive < IDLE_LIMIT_MS) continue;

        const released = lastReleasedAt.get(id) || 0;
        if (now - released < RE_RELEASE_MS) continue;

        wc.send('tab-release-memory');
        lastReleasedAt.set(id, now);
      } catch {
        // 单个标签处理失败不影响其它标签与后续巡检
      }
    }
  }

  // 清理已销毁标签的记录,避免 Map 无限增长。
  for (const id of lastReleasedAt.keys()) {
    if (!liveIds.has(id)) lastReleasedAt.delete(id);
  }
};

let timer: NodeJS.Timeout | null = null;

export const setupTabThrottle = () => {
  if (timer) return;
  // 手动触发通道(调试用):立即巡检一次。
  ipcMain.handle('tab-throttle-run-now', () => {
    patrol();
    return true;
  });
  timer = setInterval(patrol, PATROL_INTERVAL_MS);
  // 不因这个定时器而阻止进程退出。
  timer.unref?.();
};
