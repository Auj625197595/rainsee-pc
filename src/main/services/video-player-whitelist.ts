// 内置智能播放器白名单：命中 host 不嗅探视频、地址栏不显示播放器图标。
const BUILTIN_HOSTS: string[] = [
  'bilibili.com',
  'youtube.com',
  'youku.com',
  'iqiyi.com',
  'v.qq.com',
  'douyin.com',
  'tiktok.com',
  'netflix.com',
  'primevideo.com',
  'disneyplus.com',
];

// 当前生效的白名单 host（小写）。filterVideo / addVideoUrl 据此判定是否抑制嗅探。
let activeHosts: string[] = BUILTIN_HOSTS.slice();

// 当前页 host 是否命中白名单：精确相等，或 host 为白名单某项的子域
// （填主域 bilibili.com 时，www.bilibili.com / m.bilibili.com 均命中）。
export const isVideoPlayerWhitelistedHost = (
  host: string | null | undefined,
): boolean => {
  const h = (host || '').toLowerCase().trim();
  if (!h) return false;
  for (const entry of activeHosts) {
    if (!entry) continue;
    if (h === entry) return true;
    if (h.endsWith('.' + entry)) return true;
  }
  return false;
};

// 暴露当前生效列表（调试 / 设置页将来可读）。
export const getVideoPlayerWhitelist = (): string[] => activeHosts.slice();

export const runVideoPlayerWhitelistService = () => {
  // 开源版白名单为内置常量，无需启动同步。
};
