import * as React from 'react';
import {
  HouseSimpleIcon,
  PuzzlePiece,
  ShieldCheckIcon,
  Translate,
  ArrowSquareOut,
  ClockCounterClockwiseIcon,
  BookmarksSimpleIcon,
  Broom,
  Camera,
} from '@phosphor-icons/react';

import { ICON_DOWNLOAD, ICON_STAR, ICON_VIDEO } from './icons';
import type { MessageKey } from '~/common/i18n';

// 工具栏图标统一类型:Phosphor 组件 或 字符串 URL(与 ToolbarButton 的 icon 双类型一致)。
export type ToolbarIcon = string | React.ComponentType<any>;

export interface ClusterButtonMeta {
  id: string;
  labelKey: MessageKey;
  area: 'left' | 'right';
  Icon: ToolbarIcon;
  // 默认隐藏:常驻入口(可在自定义工具栏里开启),但新装/升级用户默认不显示。
  defaultHidden?: boolean;
}

export interface SiteButtonMeta {
  id: string;
  labelKey: MessageKey;
  Icon: ToolbarIcon;
}

// 集群按钮:可拖拽排序(在所属区域内)。后退/前进/刷新/停止 与 菜单(3-dot)
// 固定不在此列(始终渲染、不可隐藏/移动)。数组顺序即默认顺序。
// defaultHidden 的常驻入口默认不显示,用户可在「自定义工具栏」开启。
export const CLUSTER_BUTTONS: ClusterButtonMeta[] = [
  { id: 'home', labelKey: 'toolbarButtonHome', area: 'left', Icon: HouseSimpleIcon },
  { id: 'extensions', labelKey: 'toolbarButtonExtensions', area: 'right', Icon: PuzzlePiece },
  { id: 'downloads', labelKey: 'toolbarButtonDownloads', area: 'right', Icon: ICON_DOWNLOAD },
  {
    id: 'history',
    labelKey: 'toolbarButtonHistory',
    area: 'right',
    Icon: ClockCounterClockwiseIcon,
    defaultHidden: true,
  },
  {
    id: 'bookmarks',
    labelKey: 'toolbarButtonBookmarks',
    area: 'right',
    Icon: BookmarksSimpleIcon,
    defaultHidden: true,
  },
  {
    id: 'clear-browsing-data',
    labelKey: 'toolbarButtonClearBrowsingData',
    area: 'right',
    Icon: Broom,
    defaultHidden: true,
  },
  {
    id: 'screenshot',
    labelKey: 'toolbarButtonScreenshot',
    area: 'right',
    Icon: Camera,
    defaultHidden: true,
  },
  {
    id: 'translate-page',
    labelKey: 'toolbarButtonTranslatePage',
    area: 'right',
    Icon: Translate,
    defaultHidden: true,
  },
];

// 地址栏内图标:仅显隐,不可拖拽(位置固定,跟随页面状态)。
export const SITE_BUTTONS: SiteButtonMeta[] = [
  { id: 'new-tab-search', labelKey: 'toolbarButtonNewTabSearch', Icon: ArrowSquareOut },
  { id: 'star', labelKey: 'toolbarButtonStar', Icon: ICON_STAR },
  { id: 'shield', labelKey: 'toolbarButtonShield', Icon: ShieldCheckIcon },
  { id: 'translate', labelKey: 'toolbarButtonTranslate', Icon: Translate },
  { id: 'video', labelKey: 'toolbarButtonVideo', Icon: ICON_VIDEO },
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

export type DownloadVisibility = 'always' | 'on-download' | 'hidden';

export interface ToolbarLayout {
  left: string[];
  right: string[];
  hidden: string[];
  downloadVisibility: DownloadVisibility;
}

// 默认布局(全新用户/恢复默认用):CLUSTER_BUTTONS 顺序即默认顺序;
// defaultHidden 的按钮放入 hidden,默认不显示。
export const DEFAULT_TOOLBAR_LAYOUT: ToolbarLayout = {
  left: LEFT_CLUSTER_IDS.slice(),
  right: RIGHT_CLUSTER_IDS.slice(),
  hidden: DEFAULT_HIDDEN_IDS.slice(),
  downloadVisibility: 'on-download',
};

// 归一化用户存盘的布局,保证前向兼容:
//  - 丢弃未知 id(老版本残留);
//  - 每个按钮恒属其默认区域(left/right 不跨区,即便用户数组放错也回收到默认区);
//  - 区域内保留用户顺序,随后补齐缺失的已知按钮(新版本新增按钮自动出现在末尾);
//  - hidden 保留用户已隐藏的已知按钮,并自动隐藏「新引入的默认隐藏按钮」
//    (默认隐藏按钮对老用户首次出现时也保持隐藏,而非突然显示)。
// 入参可为空/部分字段(老用户 settings.json 无 toolbarLayout)。
export const resolveToolbarLayout = (layout: any): ToolbarLayout => {
  const raw = layout && typeof layout === 'object' ? layout : {};
  const stringsOnly = (value: any): string[] =>
    Array.isArray(value)
      ? value.filter((id: unknown): id is string => typeof id === 'string')
      : [];
  const leftIn = stringsOnly(raw.left);
  const rightIn = stringsOnly(raw.right);
  const hiddenIn = stringsOnly(raw.hidden);
  const downloadVisibility: DownloadVisibility =
    raw.downloadVisibility === 'always' ||
    raw.downloadVisibility === 'on-download' ||
    raw.downloadVisibility === 'hidden'
      ? raw.downloadVisibility
      : hiddenIn.includes('downloads')
      ? 'hidden'
      : DEFAULT_TOOLBAR_LAYOUT.downloadVisibility;

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
  // 下载按钮使用独立三态配置。老配置里的 hidden 已在上方迁移，不再重复保存。
  hiddenSet.delete('downloads');
  for (const id of [...leftR.appended, ...rightR.appended]) {
    if (DEFAULT_HIDDEN_IDS.includes(id)) {
      hiddenSet.add(id);
    }
  }

  return {
    left: leftR.out,
    right: rightR.out,
    hidden: [...hiddenSet],
    downloadVisibility,
  };
};
