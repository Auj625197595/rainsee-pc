import * as React from 'react';
import {
  HouseSimpleIcon,
  PuzzlePiece,
  BellSimple,
  Sparkle,
  ShieldCheckIcon,
  Translate,
  ClockCounterClockwiseIcon,
  BookmarksSimpleIcon,
} from '@phosphor-icons/react';

import { ICON_DOWNLOAD, ICON_STAR, ICON_VIDEO } from './icons';

// 工具栏图标统一类型:Phosphor 组件 或 字符串 URL(与 ToolbarButton 的 icon 双类型一致)。
export type ToolbarIcon = string | React.ComponentType<any>;

export interface ClusterButtonMeta {
  id: string;
  label: string;
  area: 'left' | 'right';
  Icon: ToolbarIcon;
  // 默认隐藏:常驻入口(可在自定义工具栏里开启),但新装/升级用户默认不显示。
  defaultHidden?: boolean;
}

export interface SiteButtonMeta {
  id: string;
  label: string;
  Icon: ToolbarIcon;
}

// 集群按钮:可拖拽排序(在所属区域内)。后退/前进/刷新/停止 与 菜单(3-dot)
// 固定不在此列(始终渲染、不可隐藏/移动)。数组顺序即默认顺序。
// defaultHidden 的常驻入口(历史/书签)默认不显示,用户可在「自定义工具栏」开启。
export const CLUSTER_BUTTONS: ClusterButtonMeta[] = [
  { id: 'home', label: '主页', area: 'left', Icon: HouseSimpleIcon },
  { id: 'extensions', label: '扩展', area: 'right', Icon: PuzzlePiece },
  { id: 'downloads', label: '下载', area: 'right', Icon: ICON_DOWNLOAD },
  { id: 'subscribe', label: '订阅', area: 'right', Icon: BellSimple },
  { id: 'ai', label: '雨见 AI', area: 'right', Icon: Sparkle },
  {
    id: 'history',
    label: '历史',
    area: 'right',
    Icon: ClockCounterClockwiseIcon,
    defaultHidden: true,
  },
  {
    id: 'bookmarks',
    label: '书签',
    area: 'right',
    Icon: BookmarksSimpleIcon,
    defaultHidden: true,
  },
];

// 地址栏内图标:仅显隐,不可拖拽(位置固定,跟随页面状态)。
export const SITE_BUTTONS: SiteButtonMeta[] = [
  { id: 'star', label: '书签星标', Icon: ICON_STAR },
  { id: 'shield', label: '广告拦截', Icon: ShieldCheckIcon },
  { id: 'translate', label: '翻译', Icon: Translate },
  { id: 'video', label: '视频', Icon: ICON_VIDEO },
];

export const LEFT_CLUSTER_IDS = CLUSTER_BUTTONS.filter(
  (b) => b.area === 'left',
).map((b) => b.id);

export const RIGHT_CLUSTER_IDS = CLUSTER_BUTTONS.filter(
  (b) => b.area === 'right',
).map((b) => b.id);

export const ALL_TOOLBAR_BUTTON_IDS = [
  ...LEFT_CLUSTER_IDS,
  ...RIGHT_CLUSTER_IDS,
  ...SITE_BUTTONS.map((b) => b.id),
];

// 默认隐藏的按钮 id(常驻入口,需用户在自定义工具栏里手动开启)。
export const DEFAULT_HIDDEN_IDS = CLUSTER_BUTTONS.filter(
  (b) => b.defaultHidden,
).map((b) => b.id);

export interface ToolbarLayout {
  left: string[];
  right: string[];
  hidden: string[];
}

// 默认布局(全新用户/恢复默认用):CLUSTER_BUTTONS 顺序即默认顺序;
// defaultHidden 的按钮(历史/书签)放入 hidden,默认不显示。
export const DEFAULT_TOOLBAR_LAYOUT: ToolbarLayout = {
  left: LEFT_CLUSTER_IDS.slice(),
  right: RIGHT_CLUSTER_IDS.slice(),
  hidden: DEFAULT_HIDDEN_IDS.slice(),
};

// 归一化用户存盘的布局,保证前向兼容:
//  - 丢弃未知 id(老版本残留);
//  - 每个按钮恒属其默认区域(left/right 不跨区,即便用户数组放错也回收到默认区);
//  - 区域内保留用户顺序,随后补齐缺失的已知按钮(新版本新增按钮自动出现在末尾);
//  - hidden 保留用户已隐藏的已知按钮,并自动隐藏「新引入的默认隐藏按钮」
//    (历史/书签对老用户是新增的,首次出现时默认隐藏,而非突然显示)。
// 入参可为空/部分字段(老用户 settings.json 无 toolbarLayout)。
export const resolveToolbarLayout = (layout: any): ToolbarLayout => {
  const raw = layout && typeof layout === 'object' ? layout : {};
  const leftIn = Array.isArray(raw.left) ? raw.left : [];
  const rightIn = Array.isArray(raw.right) ? raw.right : [];
  const hiddenIn = Array.isArray(raw.hidden) ? raw.hidden : [];

  // 归一化单个区域:保留用户顺序的已知 id,再补齐缺失的已知按钮。
  // 返回有序列表 + 本次「新引入」(用户数组里没有)的 id,用于决定是否默认隐藏。
  const normalizeArea = (
    input: string[],
    known: string[],
  ): { out: string[]; appended: string[] } => {
    const seen = new Set<string>();
    const out: string[] = [];
    const appended: string[] = [];
    for (const id of input) {
      if (known.includes(id) && !seen.has(id)) {
        out.push(id);
        seen.add(id);
      }
    }
    for (const id of known) {
      if (!seen.has(id)) {
        out.push(id);
        seen.add(id);
        appended.push(id);
      }
    }
    return { out, appended };
  };

  const leftR = normalizeArea(leftIn, LEFT_CLUSTER_IDS);
  const rightR = normalizeArea(rightIn, RIGHT_CLUSTER_IDS);

  // hidden = 用户隐藏的已知按钮 ∪ 新引入的默认隐藏按钮。
  const hiddenSet = new Set<string>(
    hiddenIn.filter((id) => ALL_TOOLBAR_BUTTON_IDS.includes(id)),
  );
  for (const id of [...leftR.appended, ...rightR.appended]) {
    if (DEFAULT_HIDDEN_IDS.includes(id)) {
      hiddenSet.add(id);
    }
  }

  return {
    left: leftR.out,
    right: rightR.out,
    hidden: [...hiddenSet],
  };
};
