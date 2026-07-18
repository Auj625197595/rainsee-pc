// 硬件档位检测(仅主进程)。用物理内存判断机器能否吃重 UI / 硬件加速。
//
// 用途:硬件加速默认值(item 5)与 --process-per-site 门控等内存策略,在用户
// 未显式设置时按机器档位给默认。os.totalmem() 只在主进程可用,故本文件不得被
// renderer/constants 引入(src/constants/settings.ts 是共享文件,严禁 import os)。
//
// 阈值 ~8.5GB:标称 8GB 机的 os.totalmem() 实测略低于 8×1024³(硬件保留),用 8.5GB
// 作切点可可靠把 8GB 及以下判为「非重 UI」,而 12/16GB 判为「重 UI」。

import { totalmem } from 'os';

const HEAVY_UI_THRESHOLD_BYTES = 8.5 * 1024 ** 3;

// 物理内存 > ~8.5GB 视为可吃重 UI(默认开硬件加速等)。≤8GB → false。
export const isHeavyUI = (): boolean => {
  try {
    return totalmem() > HEAVY_UI_THRESHOLD_BYTES;
  } catch {
    // 极端情况下取不到内存信息:保守视为重 UI(维持默认开加速的旧行为)。
    return true;
  }
};
