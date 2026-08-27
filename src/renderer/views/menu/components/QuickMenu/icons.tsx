import * as React from 'react';
import {
  User,
  ShareNetwork,
  Gear,
  PuzzlePiece,
  BookmarkSimple,
  DownloadSimple,
  ClockCounterClockwise,
  Star,
  ArrowClockwise,
  ArrowDown,
  Tabs,
  Shield,
  Wrench,
  Plus,
  PlusSquare,
  Browser,
  Detective,
  SquaresFour,
  MagnifyingGlass,
  MagnifyingGlassPlus,
  Minus,
  Printer,
  Translate,
  Camera,
  LockKey,
  Question,
  CaretRight,
  Moon,
  AppWindow,
  UserPlus,
  UserSwitch,
  DotsThree,
  Desktop,
  Trash,
  X,
} from '@phosphor-icons/react';

interface P {
  size?: number;
  color?: string;
}

type PhosphorIcon = React.ComponentType<{
  size?: number;
  color?: string;
  weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';
}>;

// 把 phosphor 图标包一层：固定默认尺寸/字重，color 缺省走 currentColor 继承容器
const wrap = (
  Cmp: PhosphorIcon,
  size: number,
  weight: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone' = 'bold',
  color = 'currentColor',
): React.FC<P> => ({ size: s, color: c }) => (
  <Cmp size={s ?? size} color={c ?? color} weight={weight} />
);

export const IconUser = wrap(User, 20);
export const IconShare = wrap(ShareNetwork, 16);
export const IconSettings = wrap(Gear, 18);

// 拓展：深色磁贴上的白色实心拼图
export const IconExtension = wrap(PuzzlePiece, 24, 'fill', '#fff');

export const IconBookmark = wrap(BookmarkSimple, 24, 'bold', '#3148d9');
export const IconDownload = wrap(DownloadSimple, 24, 'bold', '#4f46e5');
export const IconHistory = wrap(ClockCounterClockwise, 24, 'bold', '#9333ea');

export const IconStar = wrap(Star, 20);
// 开源版：IconAi 已随 AI 功能移除。
export const IconRefresh = wrap(ArrowClockwise, 20);
export const IconScrollDown = wrap(ArrowDown, 20);
export const IconTabs = wrap(Tabs, 20);
export const IconShield = wrap(Shield, 20);
export const IconTools = wrap(Wrench, 20);

export const IconPlus = wrap(Plus, 16);

// —— 列表项图标 ——
export const IconPlusSquare = wrap(PlusSquare, 19);
export const IconBrowser = wrap(Browser, 19);
export const IconDetective = wrap(Detective, 19);
export const IconWindows = wrap(SquaresFour, 19);
export const IconZoom = wrap(MagnifyingGlassPlus, 18);
export const IconFind = wrap(MagnifyingGlass, 19);
export const IconMinus = wrap(Minus, 12);

// —— 二宫格快捷动作 ——
export const IconPrinter = wrap(Printer, 18);
export const IconTranslate = wrap(Translate, 18);
export const IconCamera = wrap(Camera, 18);
export const IconPassword = wrap(LockKey, 18);

export const IconQuestion = wrap(Question, 19);
export const IconCaretRight = wrap(CaretRight, 14);
export const IconMoon = wrap(Moon, 19, 'fill');
export const IconAppWindow = wrap(AppWindow, 19);
export const IconUserPlus = wrap(UserPlus, 19);
export const IconProfile = wrap(UserSwitch, 19);
export const IconMore = wrap(DotsThree, 20);
export const IconDesktop = wrap(Desktop, 17);
export const IconTrash = wrap(Trash, 17);
export const IconClose = wrap(X, 17);
