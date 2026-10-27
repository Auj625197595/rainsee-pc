import * as React from 'react';
import { createPortal } from 'react-dom';
import styled, { css } from 'styled-components';
import {
  ArrowsOutSimple,
  ArrowsLeftRight,
  BookmarkSimple,
  Check,
  CaretRight,
  ChatCircle,
  CodeBlock,
  Columns,
  CopySimple,
  EyeSlash,
  FolderSimple,
  ListNumbers,
  MagnifyingGlass,
  Minus,
  Moon,
  MouseSimple,
  Palette,
  SidebarSimple,
  SlidersHorizontal,
  Star,
  Timer,
  Warning,
  XSquare,
  X,
} from '@phosphor-icons/react';

import { ipcRenderer } from '~/common/renderer-ipc';
import {getWebUIContext} from '~/common/webui-context';

const webUIContext = getWebUIContext();
import { Dropdown } from '~/renderer/components/Dropdown';
import { Switch } from '~/renderer/components/Switch';
import {
  Title,
  Row,
  Control,
  SecondaryText,
  SettingCopy,
  SettingGroup,
  SettingGroupBlock,
  SettingGroupLabel,
  SettingIcon,
} from '../App/style';
import store from '../../store';
import { onSwitchChange, getSettingsTranslator } from '../../utils';
import { observer } from 'mobx-react-lite';
import {
  TopBarVariant,
  TabsLayout,
  ITheme,
  TabOverflowBehavior,
  TabHoverActivationBehavior,
  TabCloseSelectionBehavior,
  BookmarkBarDisplay,
  IBookmark,
} from '~/interfaces';
import type { MessageKey, Translator } from '~/common/i18n';
import { NormalButton } from '../App';
import { CustomizeToolbar } from '../CustomizeToolbar';
import ChromeStylePanel from './ChromeStylePanel';
import { getPalette } from '../../utils/palette';
import {
  MAX_CUSTOM_CHROME_CSS_LENGTH,
  MAX_TAB_HOVER_ACTIVATION_DELAY,
  MIN_TAB_HOVER_ACTIVATION_DELAY,
  normalizeTabHoverActivationDelay,
} from '~/constants';
import { normalizeBookmarkBarDisplay } from '~/common/bookmark-bar';

const CustomCssPanel = styled.section`
  width: 100%;
  margin-top: 10px;
  padding: 18px;
  border-radius: 16px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      box-shadow: inset 0 0 0 1px ${p.line}, 0 1px 2px rgba(20, 27, 45, 0.04);
    `;
  }}
`;

const CustomCssHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
`;

const CustomCssEditor = styled.textarea`
  display: block;
  width: 100%;
  min-height: 260px;
  resize: vertical;
  padding: 13px 14px;
  border-radius: 8px;
  outline: none;
  font-family: Consolas, 'SFMono-Regular', monospace;
  font-size: 12.5px;
  line-height: 1.6;
  letter-spacing: 0;
  tab-size: 2;
  transition: border-color 0.16s ease, box-shadow 0.16s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${p.bg};
      border: 1px solid ${p.line};

      &::placeholder {
        color: ${p.textMute};
      }

      &:focus {
        border-color: ${p.primary};
        box-shadow: 0 0 0 3px ${p.primary}1f;
      }
    `;
  }}
`;

const CustomCssActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 12px;
`;

const CustomCssLimit = styled.div`
  flex-shrink: 0;
  font-size: 12px;
  font-variant-numeric: tabular-nums;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

const CustomCssCopyNotice = styled.div<{ visible: boolean }>`
  min-height: 20px;
  margin-top: 7px;
  font-size: 12.5px;
  line-height: 20px;
  text-align: right;
  opacity: ${({ visible }) => (visible ? 1 : 0)};
  transition: opacity 0.16s ease;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const AdvancedEntries = styled.div`
  overflow: hidden;
  border-radius: 18px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      border: 1px solid ${p.line};
    `;
  }}
`;

const DelayInput = styled.input`
  width: 84px;
  height: 34px;
  padding: 0 10px;
  border-radius: 8px;
  outline: none;
  font-family: inherit;
  font-size: 13px;
  text-align: right;
  font-variant-numeric: tabular-nums;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${p.bg};
      border: 1px solid ${p.line};

      &:focus {
        border-color: ${p.primary};
        box-shadow: 0 0 0 3px ${p.primary}1f;
      }

      &:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
    `;
  }}
`;

const DelayUnit = styled.span`
  margin-left: 8px;
  font-size: 13px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const AdvancedEntry = styled.button`
  width: 100%;
  min-height: 72px;
  border: none;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  text-align: left;
  cursor: pointer;
  font: inherit;

  & + & {
    ${({ theme }: { theme?: ITheme }) => css`
      border-top: 1px solid ${getPalette(theme).line};
    `}
  }

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${p.surface};
      &:hover {
        background-color: ${p.hover};
      }
    `;
  }}
`;

const AdvancedEntryCopy = styled.span`
  flex: 1;
  min-width: 0;
`;

const AdvancedEntryTitle = styled.span`
  display: block;
  font-size: 14.5px;
  font-weight: 600;
`;

const AdvancedEntryDesc = styled.span`
  display: block;
  margin-top: 2px;
  font-size: 12.5px;
  line-height: 1.45;
  font-weight: 500;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const ModalLayer = styled.div`
  position: absolute;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 22px;
  background: rgba(24, 27, 42, 0.28);
  backdrop-filter: blur(2px);
`;

const SettingsModal = styled.section<{ $css?: boolean }>`
  width: ${({ $css }) => ($css ? 'min(920px, 100%)' : 'min(860px, 100%)')};
  max-height: 100%;
  overflow: hidden;
  border-radius: 18px;
  display: flex;
  flex-direction: column;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${p.surface};
      border: 1px solid ${p.line};
      box-shadow: 0 24px 60px -28px rgba(26, 34, 76, 0.42);
    `;
  }}
`;

const ModalHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 19px 22px 16px;

  ${({ theme }: { theme?: ITheme }) => css`
    border-bottom: 1px solid ${getPalette(theme).line};
  `}
`;

const ModalTitle = styled.h3`
  margin: 0;
  font-size: 18px;
  font-weight: 600;
`;

const ModalClose = styled.button`
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${theme && theme['pages.lightForeground']
        ? 'rgba(255, 255, 255, 0.07)'
        : '#F4F5FA'};
      &:hover {
        color: ${p.primary};
        background-color: ${p.primarySoft};
      }
    `;
  }}
`;

const ModalBody = styled.div`
  overflow-y: auto;
  padding: 4px 22px 24px;

  ${CustomCssPanel} {
    margin-top: 18px;
  }
`;

const FolderPickerTrigger = styled.button`
  min-width: 190px;
  max-width: 290px;
  min-height: 34px;
  border-radius: 9px;
  padding: 6px 8px 6px 11px;
  display: flex;
  align-items: center;
  gap: 8px;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${p.bg};
      border: 1px solid ${p.line};

      &:hover {
        color: ${p.primary};
        border-color: ${p.primary}66;
        background-color: ${p.primarySoft};
      }
    `;
  }}
`;

const FolderPickerTriggerText = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const FolderPickerSurface = styled.section`
  width: min(540px, 100%);
  max-height: 100%;
  overflow: hidden;
  border-radius: 14px;
  display: flex;
  flex-direction: column;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${p.surface};
      border: 1px solid ${p.line};
      box-shadow: 0 24px 60px -28px rgba(26, 34, 76, 0.42);
    `;
  }}
`;

const FolderPickerHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px 15px;

  ${({ theme }: { theme?: ITheme }) => css`
    border-bottom: 1px solid ${getPalette(theme).line};
  `}
`;

const FolderPickerTitle = styled.h3`
  margin: 0;
  font-size: 16px;
  font-weight: 600;
`;

const FolderPickerBody = styled.div`
  padding: 16px 20px 20px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
`;

const FolderPickerSearch = styled.div`
  position: relative;
`;

const FolderPickerSearchInput = styled.input`
  width: 100%;
  height: 38px;
  padding: 0 12px 0 36px;
  border-radius: 8px;
  outline: none;
  font: inherit;
  font-size: 13px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${p.bg};
      border: 1px solid ${p.line};

      &::placeholder {
        color: ${p.textMute};
      }

      &:focus {
        border-color: ${p.primary};
        box-shadow: 0 0 0 3px ${p.primary}1f;
      }
    `;
  }}
`;

const FolderPickerSearchIcon = styled.span`
  position: absolute;
  left: 11px;
  top: 50%;
  display: inline-flex;
  pointer-events: none;
  transform: translateY(-50%);

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

const FolderPickerToolbar = styled.div`
  min-height: 28px;
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const FolderPickerMeta = styled.span`
  font-size: 12px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const FolderPickerTextButton = styled.button`
  border: none;
  padding: 4px 7px;
  border-radius: 6px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.primary};
      background-color: transparent;

      &:hover {
        background-color: ${p.primarySoft};
      }
    `;
  }}
`;

const FolderPickerTree = styled.div`
  min-height: 224px;
  max-height: min(420px, 50vh);
  margin-top: 8px;
  overflow-y: auto;
  padding: 5px;
  border-radius: 9px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.bg};
      border: 1px solid ${p.line};
    `;
  }}
`;

const FolderPickerTreeRow = styled.div<{ $depth: number; $selected: boolean }>`
  min-height: 36px;
  padding: ${({ $depth }) => `4px 7px 4px ${7 + $depth * 18}px`};
  display: flex;
  align-items: center;
  gap: 7px;
  border-radius: 7px;
  cursor: pointer;

  ${({ $selected, theme }: { $selected: boolean; theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${$selected ? p.primary : p.textMain};
      background-color: ${$selected ? p.primarySoft : 'transparent'};

      &:hover {
        background-color: ${$selected ? p.primarySoft : p.hover};
      }
    `;
  }}
`;

const FolderPickerToggle = styled.button<{ $expanded: boolean }>`
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transform: ${({ $expanded }) => ($expanded ? 'rotate(90deg)' : 'none')};

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textSub};
      background-color: transparent;

      &:hover {
        color: ${p.primary};
        background-color: ${p.primarySoft};
      }
    `;
  }}
`;

const FolderPickerToggleSpacer = styled.span`
  width: 22px;
  height: 22px;
  flex-shrink: 0;
`;

const FolderPickerLabel = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
`;

const FolderPickerCount = styled.span`
  flex-shrink: 0;
  font-size: 11px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

const FolderPickerEmpty = styled.div`
  padding: 56px 18px;
  text-align: center;
  font-size: 13px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const CssModalTabs = styled.div`
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  margin-top: 14px;
  border-radius: 9px;

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${getPalette(theme).hover};
  `}
`;

const CssModalTab = styled.button<{ $active: boolean }>`
  min-height: 29px;
  padding: 0 13px;
  border: none;
  border-radius: 7px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;

  ${({ $active, theme }: { $active: boolean; theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${$active ? p.primary : p.textSub};
      background-color: ${$active ? p.surface : 'transparent'};
      box-shadow: ${$active ? '0 1px 3px rgba(40, 50, 120, 0.1)' : 'none'};
    `;
  }}
`;

const CssModalTabRow = styled.div`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 10px;
`;

const CUSTOM_CSS_EXAMPLE = `/*
 * 雨见浏览器框架 CSS 选择器示例
 * 属性目前均被注释，取消属性前后的注释即可生效。
 */

/* ===== 整体区域 ===== */
:scope[data-rainsee-area="sidebar"] {
  /* background-color: #17191f !important; */
  /* color: #e8eaf0 !important; */
}

:scope[data-rainsee-area="topbar"] {
  /* background-color: #f5f7fd !important; */
  /* color: #202535 !important; */
}

/* ===== 顶部栏结构 ===== */
[data-rainsee-part="titlebar"] {
  /* background-color: #f5f7fd !important; */
}

[data-rainsee-part="toolbar"] {
  /* height: 52px; */
  /* background-color: #ffffff !important; */
  /* border-bottom-color: #dfe3ee !important; */
}

/* LOGO 区域（标题栏最左侧的品牌图标与文字） */
[data-rainsee-part="brand"] { }
[data-rainsee-part="brand-logo"] {
  /* width: 36px !important; */
  /* height: 36px !important; */
  /* border-radius: 12px !important; */
  /* background-color: #ffffff !important; */
}
[data-rainsee-part="brand-logo-icon"] { }
[data-rainsee-part="brand-text"] {
  /* display: none !important; */
}
[data-rainsee-part="brand-title"] { }
[data-rainsee-part="brand-sub"] { }

[data-rainsee-part="address-bar"] {
  /* background-color: #ffffff !important; */
  /* border: 1px solid #d8deeb !important; */
  /* border-radius: 8px !important; */
  /* box-shadow: none !important; */
}

[data-rainsee-part="address-input"] {
  /* font-size: 14px !important; */
  /* caret-color: #3452ff; */
}

[data-rainsee-part="address-input"][data-rainsee-input-visible="true"] {
  /* color: #202535 !important; */
}

[data-rainsee-part="address-input"][data-rainsee-input-visible="false"] {
  /* 必须保持透明，避免与上层分段网址文字重叠 */
  /* color: transparent !important; */
}

[data-rainsee-part="bookmark-bar"] {
  /* background-color: #ffffff !important; */
  /* min-height: 34px; */
}

[data-rainsee-part="bookmark-item"] { }
[data-rainsee-part="bookmark-item"][data-rainsee-kind="folder"] { }
[data-rainsee-part="bookmark-icon"] { }
[data-rainsee-part="bookmark-title"] { }

/* 顶部标签模式 */
[data-rainsee-part="tab-bar"] { }
[data-rainsee-part="tab"] { }
[data-rainsee-part="tab-surface"] { }
[data-rainsee-part="tab-content"] { }
[data-rainsee-part="tab-icon"] { }
[data-rainsee-part="tab-title"] { }
[data-rainsee-part="tab-audio"] { }
[data-rainsee-part="tab-close"] { }
[data-rainsee-part="tab"][data-rainsee-selected="true"] { }
[data-rainsee-part="tab"][data-rainsee-pinned="true"] { }
[data-rainsee-part="tab-group"] { }

/* ===== 所有顶部按钮和图标 ===== */
[data-rainsee-part="toolbar-button"] {
  /* width: 36px; */
  /* height: 36px; */
  /* border-radius: 8px !important; */
  /* color: #59627a !important; */
}

[data-rainsee-part="toolbar-button"]:hover {
  /* background-color: rgba(52, 82, 255, 0.10) !important; */
}

[data-rainsee-part="button-icon"] {
  /* opacity: 1 !important; */
  /* transform: scale(0.95); */
}

[data-rainsee-part="button-badge"] { }

/* 品牌胶囊按钮默认保留产品配色；只有明确需要时才单独修改 */
[data-rainsee-part="brand-action"] { }
[data-rainsee-part="brand-action"][data-rainsee-action="new-tab-search"] { }
[data-rainsee-part="brand-action"][data-rainsee-action="ai"] { }
[data-rainsee-part="brand-action"][data-rainsee-action="update"] { }

/* 导航按钮 */
[data-rainsee-action="back"] { }
[data-rainsee-action="forward"] { }
[data-rainsee-action="reload"] { }
[data-rainsee-action="home"] { }

/* 地址栏内按钮 */
[data-rainsee-action="search-engine"] { }
[data-rainsee-action="autofill"] { }
[data-rainsee-action="zoom"] { }
[data-rainsee-action="translate"] { }
[data-rainsee-action="install-app"] { }
[data-rainsee-action="bookmark-page"] { }
[data-rainsee-action="shield"] { }
[data-rainsee-action="video"] { }

/* 地址栏右侧和功能按钮 */
[data-rainsee-action="extensions"] { }
[data-rainsee-action="extension-action"] { }
[data-rainsee-action="downloads"] { }
[data-rainsee-action="subscribe"] { }
[data-rainsee-action="history"] { }
[data-rainsee-action="bookmarks"] { }
[data-rainsee-action="menu"] { }
[data-rainsee-action="incognito"] { }
[data-rainsee-action="tab-tools"] { }
[data-rainsee-action="recently-closed"] { }
[data-rainsee-action="new-tab"] { }
[data-rainsee-action="bookmark-overflow"] { }
[data-rainsee-action="open-bookmarks"] { }

/* 所有已固定的扩展图标；extension-id 可进一步指定某个扩展 */
[data-rainsee-action="extension-action"] { }
[data-rainsee-extension-id="在这里填写扩展ID"] { }

/* 窗口控制 */
[data-rainsee-part="window-controls"] { }
[data-rainsee-action="window-minimize"] { }
[data-rainsee-action="window-maximize"] { }
[data-rainsee-action="window-close"] {
  /* color: #d93025 !important; */
}

/* ===== 垂直侧边栏 ===== */
[data-rainsee-part="sidebar-header"] { }
[data-rainsee-part="sidebar-brand"] { }
[data-rainsee-part="sidebar-brand-title"] { }
[data-rainsee-action="sidebar-pin"] { }

[data-rainsee-part="sidebar-new-tab"] {
  /* background-color: #3452ff !important; */
  /* color: #ffffff !important; */
  /* border-radius: 8px !important; */
}

[data-rainsee-part="sidebar-tabs"] { }
[data-rainsee-part="sidebar-tab"] { }
[data-rainsee-part="sidebar-tab"][data-rainsee-selected="true"] {
  /* background-color: rgba(52, 82, 255, 0.12) !important; */
}
[data-rainsee-part="sidebar-tab"][data-rainsee-pinned="true"] { }
[data-rainsee-part="sidebar-tab-icon"] { }
[data-rainsee-part="sidebar-tab-title"] { }
[data-rainsee-action="close-tab"] { }

[data-rainsee-part="sidebar-group"] { }
[data-rainsee-part="sidebar-group-section"] { }
[data-rainsee-part="sidebar-group"][data-rainsee-pinned="true"] { }
[data-rainsee-part="sidebar-group-color"] { }
[data-rainsee-part="sidebar-group-title"] { }
[data-rainsee-part="sidebar-group-title-input"] { }
[data-rainsee-part="sidebar-group-count"] { }
[data-rainsee-part="sidebar-group-pin"] { }
[data-rainsee-part="sidebar-group-chevron"] { }`;

const CUSTOM_CSS_CREATION_PROMPT = `你是“雨见浏览器框架 CSS”主题创作专家。用户接下来会告诉你想要的视觉风格，请根据风格要求生成一套完整、可直接粘贴到雨见浏览器“设置 → 外观设置 → 浏览器框架 CSS”编辑器中的 CSS。

## 输出要求

1. 默认只输出最终 CSS，不输出 Markdown 代码围栏、解释、安装步骤或额外文字。
2. 必须同时覆盖顶部栏模式和垂直侧边栏模式，不能只做其中一种。
3. 浏览器会自动把用户 CSS 包在统一的 @scope 中，因此输出中不要再写 @scope。
4. 只能使用下方公开的 data-rainsee-* 选择器，不得依赖 styled-components 生成的 className、标签层级、随机类名或元素 id。
5. CSS 总长度不得超过 ${MAX_CUSTOM_CHROME_CSS_LENGTH.toLocaleString()} 个字符。
6. 不使用 @import、远程字体、远程图片、脚本或可能影响网页内容的选择器。
7. 在文件开头用简短 CSS 注释写明英文主题名、中文主题名和设计方向。

## 作用域与变量

应用已经把 CSS 限制在 [data-rainsee-area="sidebar"] 和 [data-rainsee-area="topbar"] 内，网页内容不会被命中。

建议在两个根节点上定义同一组主题变量：

:scope[data-rainsee-area="topbar"],
:scope[data-rainsee-area="sidebar"] {
  --rs-bg: ...;
  --rs-panel: ...;
  --rs-panel-2: ...;
  --rs-text: ...;
  --rs-muted: ...;
  --rs-line: ...;
  --rs-accent: ...;
  color: var(--rs-text) !important;
  background-color: var(--rs-bg) !important;
  color-scheme: light 或 dark;
}

不要只在根节点设置 color 后期待所有文字自动继承。应用内部部分组件由 styled-components 或内联样式直接着色，地址栏、标签标题、侧栏标签标题、品牌标题、分组标题和数量徽标都应显式设置颜色。

## 地址栏防重影

地址栏使用两层文字：编辑时显示原生 input，失焦展示网址时会把 input 设为透明，并在上层显示分段网址文本。绝对不能对所有 [data-rainsee-part="address-input"] 无条件设置 color: ... !important，否则透明状态会被覆盖，两层网址同时出现并形成文字重影。

通常只需要在 [data-rainsee-part="address-bar"] 上设置文字颜色，让 input 在编辑态自动继承。若确实需要单独设置输入文字颜色，必须使用公开状态：

[data-rainsee-part="address-input"][data-rainsee-input-visible="true"] {
  color: ... !important;
}

[data-rainsee-part="address-input"][data-rainsee-input-visible="false"] {
  color: transparent !important;
}

地址栏聚焦效果应避免同时叠加高亮 border、多层 1px outline 和大半径发光阴影，否则边缘会产生视觉重影。使用单一边框、单层聚焦环或内部强调线即可。

## 正确的顶部标签写法

[data-rainsee-part="tab"] 是负责定位和宽度动画的外壳，真正承载卡片背景的是内部 [data-rainsee-part="tab-surface"]。不要把背景、边框和阴影直接画在 tab 外壳上。

普通标签：
[data-rainsee-part="tab-surface"] { ... }

悬停标签：
[data-rainsee-part="tab"]:hover [data-rainsee-part="tab-surface"] { ... }

选中标签：
[data-rainsee-part="tab"][data-rainsee-selected="true"] [data-rainsee-part="tab-surface"] { ... }

固定标签：
[data-rainsee-part="tab"][data-rainsee-pinned="true"] [data-rainsee-part="tab-surface"] { ... }

标签文字使用 [data-rainsee-part="tab-title"]，关闭按钮使用 [data-rainsee-part="tab-close"]，音频状态使用 [data-rainsee-part="tab-audio"]。

## 垂直侧边栏注意事项

分组外层卡片是 [data-rainsee-part="sidebar-group-section"]，分组标题行是 [data-rainsee-part="sidebar-group"]。暗色主题必须显式给 sidebar-group-section 设置深色 background-color、border-color 和亮色文字，否则当应用基础主题为浅色时可能出现浅灰分组底配浅色文字。

侧栏品牌文字应使用 [data-rainsee-part="sidebar-brand-title"] 显式着色。分组数量、固定图标和箭头分别使用 sidebar-group-count、sidebar-group-pin、sidebar-group-chevron。

选中标签使用：
[data-rainsee-part="sidebar-tab"][data-rainsee-selected="true"] { ... }

固定分组使用：
[data-rainsee-part="sidebar-group"][data-rainsee-pinned="true"] { ... }

## 覆盖规则

1. 对背景色、选中态、边框、阴影、文字颜色、图标 filter 和 border-radius 等容易被组件样式覆盖的属性使用 !important。
2. 工具栏按钮本身带有内联圆角，修改圆角时必须使用 border-radius: ... !important。
3. 不要对 favicon、书签网站图标或整个侧栏统一使用 filter，这会破坏网站图标颜色。暗色主题只对 button-icon、tab-close、tab-audio 或 close-tab 等控制图标做反色。
4. 应同时设计默认、hover、active、selected、pinned 和 focus-within 状态。
5. 地址栏聚焦态使用 [data-rainsee-part="address-bar"]:focus-within。

## 品牌按钮保护

“新标签搜索”“雨见 AI”和“有新版本”是带有固定产品识别色、专属圆角和内部图标布局的品牌胶囊按钮，统一使用 [data-rainsee-part="brand-action"]。不要把它们当作普通 toolbar-button，也不要用普通工具栏按钮规则修改它们的 color、background、border、border-radius、box-shadow、filter、padding 或尺寸。

除非用户明确要求重新设计这些品牌按钮，否则必须保留其原始外观。即使为了兼容旧版浏览器编写普通按钮规则，也必须排除：

[data-rainsee-part="toolbar-button"]:not([data-rainsee-action="new-tab-search"]):not([data-rainsee-action="ai"]):not([data-rainsee-action="update"]) { ... }

用户明确要求修改时，只能通过下列精确选择器分别设计，不能使用模糊的父级或通配选择器：

[data-rainsee-part="brand-action"][data-rainsee-action="new-tab-search"] { ... }
[data-rainsee-part="brand-action"][data-rainsee-action="ai"] { ... }
[data-rainsee-part="brand-action"][data-rainsee-action="update"] { ... }

## 可读性与无障碍

1. 普通文字与背景对比度至少 4.5:1，大号文字和图标至少 3:1。
2. 暗色主题的普通文字不要使用过低透明度；建议正文使用接近浅灰或暖白的实色，弱化文字仍保持清晰。
3. 选中状态不能只依赖颜色变化，至少再配合背景、边框、侧边指示条或阴影中的一种。
4. 聚焦、悬停和按下状态应彼此可区分。
5. 窗口关闭按钮悬停态必须保持足够对比度。

## 布局与性能

1. 不修改工具栏、标题栏、书签栏、侧栏和标签栏的关键高度或整体宽度，避免影响 Electron BrowserView 边界。
2. 可以谨慎调整地址栏、按钮和卡片的圆角、内边距及最小宽度，但不能造成控件重叠或文字溢出。
3. 禁止使用全局通配选择器、无限动画、大面积 backdrop-filter、大面积 blur、复杂持续动画或高成本背景效果。
4. 阴影只用于小面积静态控件，层数应克制。
5. 不使用会引发布局持续变化的 animation。优先复用应用已有的 hover/active 过渡。
6. 不隐藏主要导航、窗口控制、地址栏、标签标题或关闭按钮。

## 创作质量

不要只做简单换色。根据用户描述同时设计：

- 整体背景与面板层级
- 地址栏形状、边框和聚焦态
- 工具栏按钮默认/悬停/按下态
- 顶部标签默认/选中/固定态
- 书签项
- 侧栏新建标签按钮
- 侧栏普通/悬停/选中标签
- 侧栏分组容器、分组头、数量徽标、固定标识和箭头
- 窗口最小化、最大化、关闭按钮
- 徽标和状态色

保持风格统一，同时让信息层级清楚、文字清晰、交互状态完整。

## 公开选择器参考

${CUSTOM_CSS_EXAMPLE}

收到用户的风格描述后，直接生成一份完整 CSS。若用户没有明确暗色或浅色，应根据风格语义自行选择，并确保即使应用基础主题与生成主题明暗相反，关键组件仍然清晰可读。`;

const writeClipboardText = async (text: string) => {
  if (typeof navigator.clipboard?.writeText === 'function') {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    if (!document.execCommand('copy')) {
      throw new Error('Clipboard API is unavailable');
    }
  } finally {
    textarea.remove();
  }
};

const onThemeChange = (value: string) => {
  if (value === 'auto') {
    store.settings.themeAuto = true;
  } else {
    store.settings.themeAuto = false;
    store.settings.theme = value;
  }

  store.save();
};

const ThemeVariant = observer(() => {
  const t = getSettingsTranslator();
  const defaultValue = store.settings.theme;

  return (
    <Row>
      <SettingIcon tone="purple">
        <Palette size={19} weight="fill" />
      </SettingIcon>
      <SettingCopy>
        <Title>{t('themeColor')}</Title>
      </SettingCopy>
      <Control>
        <Dropdown
          defaultValue={store.settings.themeAuto ? 'auto' : defaultValue}
          onChange={onThemeChange}
        >
          <Dropdown.Item value="auto">{t('themeAuto')}</Dropdown.Item>
          <Dropdown.Item value="wexond-light">{t('themeLight')}</Dropdown.Item>
          <Dropdown.Item value="wexond-dark">{t('themeDark')}</Dropdown.Item>
        </Dropdown>
      </Control>
    </Row>
  );
});

const onWebDarkModeChange = (value: string) => {
  store.settings.webDarkMode = value as 'extension' | 'browser' | 'off';
  store.save();
};

// 网页暗色模式实现方式(仅在暗色生效主题下作用于普通网页内容)。
const WebDarkModeVariant = observer(() => {
  const t = getSettingsTranslator();
  const value = store.settings.webDarkMode || 'browser';

  return (
    <Row>
      <SettingIcon tone="blue">
        <Moon size={19} weight="fill" />
      </SettingIcon>
      <SettingCopy>
        <Title>{t('webDarkMode')}</Title>
      </SettingCopy>
      <Control>
        <Dropdown defaultValue={value} onChange={onWebDarkModeChange}>
          <Dropdown.Item value="extension">
            {t('webDarkModeExtension')}
          </Dropdown.Item>
          <Dropdown.Item value="browser">{t('webDarkModeBrowser')}</Dropdown.Item>
          <Dropdown.Item value="off">{t('webDarkModeOff')}</Dropdown.Item>
        </Dropdown>
      </Control>
    </Row>
  );
});

const onTopBarChange = (value: TopBarVariant) => {
  store.settings.topBarVariant = value;
  store.save();
};

const TopBarVariant = observer(() => {
  const t = getSettingsTranslator();

  return (
    <Row>
      <SettingIcon tone="green">
        <SidebarSimple size={19} weight="fill" />
      </SettingIcon>
      <SettingCopy>
        <Title>{t('topTitleBar')}</Title>
      </SettingCopy>
      <Control>
        <Dropdown
          defaultValue={store.settings.topBarVariant}
          onChange={onTopBarChange}
        >
          <Dropdown.Item value="default">{t('topBarSeparated')}</Dropdown.Item>
          <Dropdown.Item value="compact">{t('topBarCompact')}</Dropdown.Item>
        </Dropdown>
      </Control>
    </Row>
  );
});

const onTabsLayoutChange = (value: TabsLayout) => {
  store.settings.tabsLayout = value;
  store.save();
};

const TabsLayoutVariant = observer(() => {
  const t = getSettingsTranslator();

  return (
    <Row>
      <SettingIcon tone="cyan">
        <Columns size={19} weight="fill" />
      </SettingIcon>
      <SettingCopy>
        <Title>{t('tabsPosition')}</Title>
      </SettingCopy>
      <Control>
        <Dropdown
          defaultValue={store.settings.tabsLayout || 'top'}
          onChange={onTabsLayoutChange}
        >
          <Dropdown.Item value="top">{t('tabsPositionTop')}</Dropdown.Item>
          <Dropdown.Item value="left">{t('tabsPositionLeft')}</Dropdown.Item>
          <Dropdown.Item value="right">{t('tabsPositionRight')}</Dropdown.Item>
        </Dropdown>
      </Control>
    </Row>
  );
});

const TabOverflowVariant = observer(() => {
  const t = getSettingsTranslator();

  return (
    <Row>
      <SettingIcon tone="blue">
        <ArrowsOutSimple size={19} weight="fill" />
      </SettingIcon>
      <SettingCopy>
        <Title>{t('tabOverflowTitle')}</Title>
        <SecondaryText>{t('tabOverflowHint')}</SecondaryText>
      </SettingCopy>
      <Control>
        <Dropdown
          defaultValue={store.settings.tabOverflowBehavior || 'shrink'}
          onChange={(value: string) => {
            const behavior = value as TabOverflowBehavior;
            store.settings.tabOverflowBehavior = behavior;
            store.save();
          }}
        >
          <Dropdown.Item value="shrink">{t('tabOverflowShrink')}</Dropdown.Item>
          <Dropdown.Item value="scroll">{t('tabOverflowScroll')}</Dropdown.Item>
        </Dropdown>
      </Control>
    </Row>
  );
});

const TopTabRows = observer(() => {
  const t = getSettingsTranslator();
  const rows = store.settings.topTabRows || 1;

  return (
    <Row>
      <SettingIcon tone="cyan">
        <ListNumbers size={19} weight="fill" />
      </SettingIcon>
      <SettingCopy>
        <Title>{t('topTabRowsTitle')}</Title>
        <SecondaryText>{t('topTabRowsHint', { count: rows })}</SecondaryText>
      </SettingCopy>
      <Control>
        <Dropdown
          defaultValue={String(rows)}
          onChange={(value: string) => {
            store.settings.topTabRows = parseInt(value, 10);
            store.save();
          }}
        >
          {[1, 2, 3, 4, 5].map((count) => (
            <Dropdown.Item key={count} value={String(count)}>
              {t('topTabRowsCount', { count })}
            </Dropdown.Item>
          ))}
        </Dropdown>
      </Control>
    </Row>
  );
});

const TabHoverActivationBehaviorSetting = observer(() => {
  const t = getSettingsTranslator();

  return (
    <Row>
      <SettingIcon tone="green">
        <MouseSimple size={19} weight="fill" />
      </SettingIcon>
      <SettingCopy>
        <Title>{t('tabHoverTitle')}</Title>
        <SecondaryText>{t('tabHoverHint')}</SecondaryText>
      </SettingCopy>
      <Control>
        <Dropdown
          defaultValue={
            store.settings.tabHoverActivationBehavior || 'activate-and-switch'
          }
          onChange={(value: string) => {
            store.settings.tabHoverActivationBehavior =
              value as TabHoverActivationBehavior;
            store.save();
          }}
        >
          <Dropdown.Item value="off">{t('tabHoverOff')}</Dropdown.Item>
          <Dropdown.Item value="activate">{t('tabHoverActivate')}</Dropdown.Item>
          <Dropdown.Item value="activate-and-switch">
            {t('tabHoverActivateAndSwitch')}
          </Dropdown.Item>
        </Dropdown>
      </Control>
    </Row>
  );
});

const TabHoverActivationDelay = observer(() => {
  const t = getSettingsTranslator();
  const configured = normalizeTabHoverActivationDelay(
    store.settings.tabHoverActivationDelay,
  );
  const [value, setValue] = React.useState(String(configured));

  React.useEffect(() => {
    setValue(String(configured));
  }, [configured]);

  const commit = () => {
    const next = normalizeTabHoverActivationDelay(
      value.trim() === '' ? configured : Number(value),
    );
    setValue(String(next));
    if (next === store.settings.tabHoverActivationDelay) return;
    store.settings.tabHoverActivationDelay = next;
    store.save();
  };

  return (
    <Row>
      <SettingIcon tone="cyan">
        <Timer size={19} weight="fill" />
      </SettingIcon>
      <SettingCopy>
        <Title>{t('tabHoverDelayTitle')}</Title>
        <SecondaryText>{t('tabHoverDelayHint')}</SecondaryText>
      </SettingCopy>
      <Control>
        <DelayInput
          value={value}
          inputMode="numeric"
          aria-label={t('tabHoverDelayAria')}
          disabled={store.settings.tabHoverActivationBehavior === 'off'}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            if (/^\d*$/.test(event.target.value)) {
              setValue(event.target.value);
            }
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
          title={`${MIN_TAB_HOVER_ACTIVATION_DELAY}–${MAX_TAB_HOVER_ACTIVATION_DELAY} ${t('millisecondsUnit')}`}
        />
        <DelayUnit>{t('millisecondsUnit')}</DelayUnit>
      </Control>
    </Row>
  );
});

const WarnQuit = observer(() => {
  const t = getSettingsTranslator();
  const { warnOnQuit } = store.settings;

  return (
    <Row onClick={onSwitchChange('warnOnQuit')}>
      <SettingIcon tone="red">
        <Warning size={19} weight="fill" />
      </SettingIcon>
      <SettingCopy>
        <Title>{t('warnOnQuitTitle')}</Title>
      </SettingCopy>
      <Control>
        <Switch value={warnOnQuit} />
      </Control>
    </Row>
  );
});

const CloseTabOnDoubleClick = observer(() => {
  const t = getSettingsTranslator();
  const { closeTabOnDoubleClick } = store.settings;

  return (
    <Row onClick={onSwitchChange('closeTabOnDoubleClick')}>
      <SettingIcon tone="red">
        <XSquare size={19} weight="fill" />
      </SettingIcon>
      <SettingCopy>
        <Title>{t('closeTabOnDoubleClick')}</Title>
      </SettingCopy>
      <Control>
        <Switch value={closeTabOnDoubleClick} />
      </Control>
    </Row>
  );
});

const CloseTabOnRightClick = observer(() => {
  const t = getSettingsTranslator();
  const { closeTabOnRightClick } = store.settings;

  return (
    <Row onClick={onSwitchChange('closeTabOnRightClick')}>
      <SettingIcon tone="blue">
        <MouseSimple size={19} weight="fill" />
      </SettingIcon>
      <SettingCopy>
        <Title>{t('closeTabOnRightClick')}</Title>
        <SecondaryText>{t('closeTabOnRightClickHint')}</SecondaryText>
      </SettingCopy>
      <Control>
        <Switch value={closeTabOnRightClick} />
      </Control>
    </Row>
  );
});

const TabCloseSelection = observer(() => {
  const t = getSettingsTranslator();
  const { tabCloseSelectionBehavior } = store.settings;

  return (
    <Row>
      <SettingIcon tone="cyan">
        <ArrowsLeftRight size={19} weight="bold" />
      </SettingIcon>
      <SettingCopy>
        <Title>{t('tabCloseSelectionTitle')}</Title>
        <SecondaryText>{t('tabCloseSelectionHint')}</SecondaryText>
      </SettingCopy>
      <Control>
        <Dropdown
          defaultValue={tabCloseSelectionBehavior || 'right'}
          onChange={(value: string) => {
            store.settings.tabCloseSelectionBehavior =
              value as TabCloseSelectionBehavior;
            store.save();
          }}
        >
          <Dropdown.Item value="left">{t('tabCloseSelectLeft')}</Dropdown.Item>
          <Dropdown.Item value="right">{t('tabCloseSelectRight')}</Dropdown.Item>
          <Dropdown.Item value="recent">{t('tabCloseSelectRecent')}</Dropdown.Item>
        </Dropdown>
      </Control>
    </Row>
  );
});

const TabCloseButtonDisplay = observer(() => {
  const t = getSettingsTranslator();
  const { tabCloseButtonDisplay } = store.settings;

  return (
    <Row>
      <SettingIcon tone="purple">
        <EyeSlash size={19} weight="fill" />
      </SettingIcon>
      <SettingCopy>
        <Title>{t('tabCloseButtonTitle')}</Title>
      </SettingCopy>
      <Control>
        <Dropdown
          defaultValue={tabCloseButtonDisplay}
          onChange={(value: string) => {
            store.settings.tabCloseButtonDisplay = value as
              | 'always'
              | 'hover'
              | 'never';
            store.save();
          }}
        >
          <Dropdown.Item value="always">{t('tabCloseButtonAlways')}</Dropdown.Item>
          <Dropdown.Item value="hover">{t('tabCloseButtonHover')}</Dropdown.Item>
          <Dropdown.Item value="never">{t('tabCloseButtonNever')}</Dropdown.Item>
        </Dropdown>
      </Control>
    </Row>
  );
});

const CustomChromeCss = observer(() => {
  const t = getSettingsTranslator();
  const savedCss =
    typeof store.settings.customChromeCss === 'string'
      ? store.settings.customChromeCss
      : '';
  const [draft, setDraft] = React.useState(savedCss);
  // 存消息 key 而非文案:6 秒提示期内切换语言也能随 render 重译。
  const [noticeKey, setNoticeKey] = React.useState<MessageKey | null>(null);
  const copyNoticeTimer = React.useRef<number | null>(null);

  React.useEffect(() => {
    setDraft(savedCss);
  }, [savedCss]);

  React.useEffect(
    () => () => {
      if (copyNoticeTimer.current !== null) {
        window.clearTimeout(copyNoticeTimer.current);
      }
    },
    [],
  );

  const apply = () => {
    const normalized = draft.slice(0, MAX_CUSTOM_CHROME_CSS_LENGTH);
    setDraft(normalized);
    store.settings.customChromeCss = normalized;
    store.save();
  };

  const reset = () => {
    setDraft('');
    store.settings.customChromeCss = '';
    store.save();
  };

  const loadExample = () => {
    if (draft.trim() && !window.confirm(t('loadCssExampleConfirm'))) {
      return;
    }
    setDraft(CUSTOM_CSS_EXAMPLE);
  };

  const openCommunity = () => {
    const url = 'https://www.zhso.org/t/t-493c6d6c6e?node=11,1184';
    const wid = webUIContext.windowId;
    // 设置页是 webui(nodeIntegration:false),走 add-tab-${windowId} 在浏览器新标签打开;
    // 取不到 windowId 时退回当前页跳转(view-preload 仅对受信任内置页暴露 windowId)。
    if (typeof wid === 'number' && wid >= 0) {
      ipcRenderer.send(`add-tab-${wid}`, { url, active: true });
    } else {
      window.location.href = url;
    }
  };

  const copyCreationPrompt = async () => {
    try {
      await writeClipboardText(CUSTOM_CSS_CREATION_PROMPT);
      setNoticeKey('cssPromptCopiedNotice');
    } catch {
      setNoticeKey('cssCopyFailedNotice');
    }

    if (copyNoticeTimer.current !== null) {
      window.clearTimeout(copyNoticeTimer.current);
    }
    copyNoticeTimer.current = window.setTimeout(() => {
      setNoticeKey(null);
      copyNoticeTimer.current = null;
    }, 6000);
  };

  return (
    <CustomCssPanel>
      <CustomCssHeader>
        <div>
          <Title>{t('browserFrameCss')}</Title>
          <SecondaryText>{t('browserCssScopeHint')}</SecondaryText>
        </div>
        <CustomCssLimit>
          {draft.length.toLocaleString()} /{' '}
          {MAX_CUSTOM_CHROME_CSS_LENGTH.toLocaleString()}
        </CustomCssLimit>
      </CustomCssHeader>
      <CustomCssEditor
        value={draft}
        maxLength={MAX_CUSTOM_CHROME_CSS_LENGTH}
        placeholder={CUSTOM_CSS_EXAMPLE}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
      />
      <CustomCssActions>
        <NormalButton variant="soft" onClick={openCommunity}>
          <ChatCircle size={16} weight="bold" aria-hidden />
          {t('community')}
        </NormalButton>
        <NormalButton variant="soft" onClick={copyCreationPrompt}>
          <CopySimple size={16} weight="bold" aria-hidden />
          {t('copyCssCreationPrompt')}
        </NormalButton>
        <NormalButton variant="soft" onClick={loadExample}>
          {t('loadCssExample')}
        </NormalButton>
        <NormalButton
          variant="soft"
          disabled={!savedCss && !draft}
          onClick={reset}
        >
          {t('resetToDefault')}
        </NormalButton>
        <NormalButton disabled={draft === savedCss} onClick={apply}>
          {t('apply')}
        </NormalButton>
      </CustomCssActions>
      <CustomCssCopyNotice
        visible={Boolean(noticeKey)}
        role="status"
        aria-live="polite"
      >
        {noticeKey ? t(noticeKey) : '\u00a0'}
      </CustomCssCopyNotice>
    </CustomCssPanel>
  );
});

const MenuAnimations = observer(() => {
  const t = getSettingsTranslator();
  const { animations } = store.settings;

  return (
    <Row onClick={onSwitchChange('animations')}>
      <Title>{t('menuAnimations')}</Title>
      <Control>
        <Switch value={animations} />
      </Control>
    </Row>
  );
});

const BookmarksBar = observer(() => {
  const t = getSettingsTranslator();
  const bookmarksBarDisplay = normalizeBookmarkBarDisplay(
    store.settings.bookmarksBarDisplay,
    store.settings.bookmarksBar,
  );

  const onBookmarksBarDisplayChange = (value: string) => {
    const display = value as BookmarkBarDisplay;
    store.settings.bookmarksBarDisplay = display;
    store.save();
  };

  return (
    <Row>
      <SettingIcon tone="orange">
        <BookmarkSimple size={19} weight="fill" />
      </SettingIcon>
      <SettingCopy>
        <Title>{t('showBookmarksBar')}</Title>
      </SettingCopy>
      <Control>
        <Dropdown
          defaultValue={bookmarksBarDisplay}
          onChange={onBookmarksBarDisplayChange}
        >
          <Dropdown.Item value="always">{t('bookmarksBarAlways')}</Dropdown.Item>
          <Dropdown.Item value="newtab">{t('bookmarksBarNewTab')}</Dropdown.Item>
          <Dropdown.Item value="never">{t('bookmarksBarNever')}</Dropdown.Item>
        </Dropdown>
      </Control>
    </Row>
  );
});

const getBookmarkFolderName = (folder: IBookmark, t: Translator) => {
  if (folder.static === 'main') return t('bookmarkBar');
  if (folder.static === 'mobile') return t('mobileDeviceBookmarks');
  if (folder.static === 'other') return t('bookmarksOtherFolder');
  return folder.title || t('untitledFolder');
};

const getBookmarkFolderPath = (
  folder: IBookmark,
  folders: IBookmark[],
  t: Translator,
) => {
  const parts: string[] = [];
  const visited = new Set<string>();
  let current: IBookmark | undefined = folder;

  while (current?._id && !visited.has(current._id)) {
    visited.add(current._id);
    parts.unshift(getBookmarkFolderName(current, t));
    current = current.parent
      ? folders.find((item) => item._id === current?.parent)
      : undefined;
  }

  return parts.join(' / ');
};

const getBookmarkFolderChildren = (folders: IBookmark[], parentId?: string) =>
  folders
    .filter((folder) =>
      parentId == null ? folder.parent == null : folder.parent === parentId,
    )
    .slice()
    .sort((left, right) => (left.order || 0) - (right.order || 0));

const matchesBookmarkFolder = (
  folder: IBookmark,
  folders: IBookmark[],
  query: string,
  t: Translator,
): boolean => {
  if (query === '') return true;
  if (getBookmarkFolderName(folder, t).toLowerCase().includes(query)) return true;
  return getBookmarkFolderChildren(folders, folder._id).some((child) =>
    matchesBookmarkFolder(child, folders, query, t),
  );
};

type BookmarksBarFolderTreeItemProps = {
  folder: IBookmark;
  folders: IBookmark[];
  selectedFolderId: string;
  expandedFolderIds: string[];
  depth: number;
  query: string;
  t: Translator;
  onToggle: (folderId: string) => void;
  onSelect: (folder: IBookmark) => void;
};

const BookmarksBarFolderTreeItem = ({
  folder,
  folders,
  selectedFolderId,
  expandedFolderIds,
  depth,
  query,
  t,
  onToggle,
  onSelect,
}: BookmarksBarFolderTreeItemProps) => {
  const children = getBookmarkFolderChildren(folders, folder._id);
  const visibleChildren = children.filter((child) =>
    matchesBookmarkFolder(child, folders, query, t),
  );
  const folderId = folder._id || '';
  const selected = selectedFolderId === folderId;
  const expanded = query !== '' || expandedFolderIds.includes(folderId);

  if (!matchesBookmarkFolder(folder, folders, query, t)) return null;

  return (
    <>
      <FolderPickerTreeRow
        $depth={depth}
        $selected={selected}
        onClick={() => onSelect(folder)}
      >
        {children.length > 0 ? (
          <FolderPickerToggle
            type="button"
            $expanded={expanded}
            aria-label={expanded ? t('collapseFolder') : t('expandFolder')}
            onClick={(event) => {
              event.stopPropagation();
              onToggle(folderId);
            }}
          >
            <CaretRight size={14} weight="bold" />
          </FolderPickerToggle>
        ) : (
          <FolderPickerToggleSpacer />
        )}
        <FolderSimple size={17} weight={selected ? 'fill' : 'regular'} />
        <FolderPickerLabel>{getBookmarkFolderName(folder, t)}</FolderPickerLabel>
        <FolderPickerCount>
          {children.length > 0
            ? t('folderChildCount', { count: children.length })
            : ''}
        </FolderPickerCount>
        {selected && <Check size={15} weight="bold" />}
      </FolderPickerTreeRow>
      {expanded &&
        visibleChildren.map((child) => (
          <BookmarksBarFolderTreeItem
            key={child._id}
            folder={child}
            folders={folders}
            selectedFolderId={selectedFolderId}
            expandedFolderIds={expandedFolderIds}
            depth={depth + 1}
            query={query}
            t={t}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ))}
    </>
  );
};

const BookmarksBarFolder = observer(() => {
  const t = getSettingsTranslator();
  const [folders, setFolders] = React.useState<IBookmark[]>([]);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [expandedFolderIds, setExpandedFolderIds] = React.useState<string[]>(
    [],
  );

  React.useEffect(() => {
    let active = true;
    const loadFolders = async () => {
      const nextFolders = await ipcRenderer.invoke(
        'bookmarks-get-folders',
        true,
      );
      if (active) setFolders(nextFolders || []);
    };

    void loadFolders();
    ipcRenderer.on('reload-bookmarks', loadFolders);
    return () => {
      active = false;
      ipcRenderer.removeListener('reload-bookmarks', loadFolders);
    };
  }, []);

  const configuredFolderId = store.settings.bookmarksBarFolderId || '';
  const configuredFolder = folders.find(
    (folder) => folder._id === configuredFolderId && folder.isFolder,
  );
  const mainFolder = folders.find((folder) => folder.static === 'main');
  const selectedFolder = configuredFolder || mainFolder;
  const selectedFolderId = selectedFolder?._id || '';
  const normalizedQuery = query.trim().toLowerCase();
  const rootFolders = getBookmarkFolderChildren(folders).filter((folder) =>
    matchesBookmarkFolder(folder, folders, normalizedQuery, t),
  );
  const matchCount = normalizedQuery
    ? folders.filter((folder) =>
        getBookmarkFolderName(folder, t)
          .toLowerCase()
          .includes(normalizedQuery),
      ).length
    : folders.length;
  const allExpanded =
    folders.length > 0 && expandedFolderIds.length >= folders.length;
  const pickerHost = document.querySelector<HTMLElement>(
    '[data-settings-main]',
  );

  React.useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const openPicker = () => {
    const path: string[] = [];
    let current = selectedFolder;
    const visited = new Set<string>();
    while (current?._id && !visited.has(current._id)) {
      visited.add(current._id);
      if (current.parent) path.push(current.parent);
      current = current.parent
        ? folders.find((folder) => folder._id === current?.parent)
        : undefined;
    }
    setExpandedFolderIds((ids) => Array.from(new Set([...ids, ...path])));
    setQuery('');
    setOpen(true);
  };

  const onFolderSelect = (folder: IBookmark) => {
    if (!folder._id) return;
    store.settings.bookmarksBarFolderId =
      folder.static === 'main' ? '' : folder._id;
    store.save();
    setOpen(false);
    setQuery('');
  };

  const toggleFolder = (folderId: string) => {
    setExpandedFolderIds((ids) =>
      ids.includes(folderId)
        ? ids.filter((id) => id !== folderId)
        : [...ids, folderId],
    );
  };

  return (
    <Row>
      <SettingIcon tone="cyan">
        <FolderSimple size={19} weight="fill" />
      </SettingIcon>
      <SettingCopy>
        <Title>{t('bookmarksBarFolder')}</Title>
      </SettingCopy>
      <Control>
        <FolderPickerTrigger type="button" onClick={openPicker}>
          <FolderPickerTriggerText>
            {selectedFolder
              ? getBookmarkFolderPath(selectedFolder, folders, t)
              : t('bookmarkBar')}
          </FolderPickerTriggerText>
          <CaretRight size={15} />
        </FolderPickerTrigger>
      </Control>
      {open &&
        pickerHost &&
        createPortal(
          <ModalLayer
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <FolderPickerSurface
              role="dialog"
              aria-modal="true"
              aria-labelledby="bookmarks-bar-folder-picker-title"
            >
              <FolderPickerHead>
                <FolderPickerTitle id="bookmarks-bar-folder-picker-title">
                  {t('bookmarksBarFolderPickerTitle')}
                </FolderPickerTitle>
                <ModalClose
                  type="button"
                  title={t('close')}
                  aria-label={t('close')}
                  onClick={() => setOpen(false)}
                >
                  <X size={18} />
                </ModalClose>
              </FolderPickerHead>
              <FolderPickerBody>
                <FolderPickerSearch>
                  <FolderPickerSearchIcon>
                    <MagnifyingGlass size={16} />
                  </FolderPickerSearchIcon>
                  <FolderPickerSearchInput
                    autoFocus
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t('searchFolders')}
                  />
                </FolderPickerSearch>
                <FolderPickerToolbar>
                  <FolderPickerMeta>
                    {normalizedQuery
                      ? t('folderMatchCount', { count: matchCount })
                      : t('folderPickerHint')}
                  </FolderPickerMeta>
                  <FolderPickerTextButton
                    type="button"
                    onClick={() =>
                      setExpandedFolderIds(
                        allExpanded
                          ? getBookmarkFolderChildren(folders).map(
                              (folder) => folder._id || '',
                            )
                          : folders.map((folder) => folder._id || ''),
                      )
                    }
                  >
                    {allExpanded ? t('collapseAll') : t('expandAll')}
                  </FolderPickerTextButton>
                </FolderPickerToolbar>
                <FolderPickerTree>
                  {rootFolders.length > 0 ? (
                    rootFolders.map((folder) => (
                      <BookmarksBarFolderTreeItem
                        key={folder._id}
                        folder={folder}
                        folders={folders}
                        selectedFolderId={selectedFolderId}
                        expandedFolderIds={expandedFolderIds}
                        depth={0}
                        query={normalizedQuery}
                        t={t}
                        onToggle={toggleFolder}
                        onSelect={onFolderSelect}
                      />
                    ))
                  ) : (
                    <FolderPickerEmpty>
                      {folders.length === 0 && normalizedQuery === ''
                        ? t('loadingFolders')
                        : t('noMatchingFolders')}
                    </FolderPickerEmpty>
                  )}
                </FolderPickerTree>
              </FolderPickerBody>
            </FolderPickerSurface>
          </ModalLayer>,
          pickerHost,
        )}
    </Row>
  );
});

const BookmarksBarIconsOnly = observer(() => {
  const t = getSettingsTranslator();
  const { bookmarksBarIconsOnly } = store.settings;

  return (
    <Row onClick={onSwitchChange('bookmarksBarIconsOnly')}>
      <SettingIcon tone="purple">
        <EyeSlash size={19} weight="fill" />
      </SettingIcon>
      <SettingCopy>
        <Title>{t('bookmarksBarIconsOnly')}</Title>
      </SettingCopy>
      <Control>
        <Switch value={bookmarksBarIconsOnly} />
      </Control>
    </Row>
  );
});

const onBookmarksBarRowsChange = (value: string) => {
  store.settings.bookmarksBarRows = parseInt(value, 10);
  store.save();
};

const BookmarksBarRows = observer(() => {
  const t = getSettingsTranslator();
  const { bookmarksBarRows } = store.settings;

  return (
    <Row>
      <SettingIcon tone="cyan">
        <ListNumbers size={19} weight="fill" />
      </SettingIcon>
      <SettingCopy>
        <Title>{t('bookmarksBarRowCountTitle')}</Title>
      </SettingCopy>
      <Control>
        <Dropdown
          defaultValue={String(bookmarksBarRows ?? 1)}
          onChange={onBookmarksBarRowsChange}
        >
          <Dropdown.Item value="1">
            {t('bookmarksBarRowCount', { count: 1 })}
          </Dropdown.Item>
          <Dropdown.Item value="2">
            {t('bookmarksBarRowCount', { count: 2 })}
          </Dropdown.Item>
          <Dropdown.Item value="3">
            {t('bookmarksBarRowCount', { count: 3 })}
          </Dropdown.Item>
        </Dropdown>
      </Control>
    </Row>
  );
});

const ImmersiveBrowsing = observer(() => {
  const t = getSettingsTranslator();
  const { immersiveBrowsing } = store.settings;

  const onImmersiveBrowsingChange = () => {
    const enabling = !store.settings.immersiveBrowsing;
    const verticalTabs = (store.settings.tabsLayout || 'top') !== 'top';

    if (enabling && verticalTabs) {
      alert(t('immersiveNoVerticalTabsAlert'));
      return;
    }

    store.settings.immersiveBrowsing = !store.settings.immersiveBrowsing;
    store.save();
  };

  return (
    <Row onClick={onImmersiveBrowsingChange}>
      <SettingIcon tone="blue">
        <ArrowsOutSimple size={19} weight="fill" />
      </SettingIcon>
      <SettingCopy>
        <Title>{t('immersiveBrowsing')}</Title>
        <SecondaryText>{t('immersiveBrowsingHint')}</SecondaryText>
      </SettingCopy>
      <Control>
        <Switch value={immersiveBrowsing} />
      </Control>
    </Row>
  );
});

// 「显示顶部指示条」从属于沉浸浏览：未开启沉浸浏览时整行隐藏。
const ImmersivePageIndicator = observer(() => {
  const t = getSettingsTranslator();
  const { immersiveBrowsing, immersivePageIndicator } = store.settings;

  if (!immersiveBrowsing) return null;

  return (
    <Row onClick={onSwitchChange('immersivePageIndicator')}>
      <SettingIcon tone="cyan">
        <Minus size={19} weight="bold" />
      </SettingIcon>
      <SettingCopy>
        <Title>{t('immersivePageIndicator')}</Title>
      </SettingCopy>
      <Control>
        <Switch value={immersivePageIndicator} />
      </Control>
    </Row>
  );
});

type AppearanceModal = 'toolbar' | 'address-icons' | 'browser-css' | null;
type CssModalTab = 'visual' | 'code';

export const Appearance = observer(() => {
  const t = getSettingsTranslator();
  const [modal, setModal] = React.useState<AppearanceModal>(null);
  const [cssTab, setCssTab] = React.useState<CssModalTab>('visual');
  const lastTrigger = React.useRef<HTMLButtonElement | null>(null);

  const closeModal = React.useCallback(() => {
    setModal(null);
    window.requestAnimationFrame(() => lastTrigger.current?.focus());
  }, []);

  React.useEffect(() => {
    if (!modal) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeModal();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modal, closeModal]);

  const openModal = (
    type: Exclude<AppearanceModal, null>,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    lastTrigger.current = event.currentTarget;
    if (type === 'browser-css') {
      setCssTab('visual');
      setAskAiOpen(false);
    }
    setModal(type);
  };

  const modalTitle =
    modal === 'toolbar'
      ? t('customizeToolbar')
      : modal === 'address-icons'
      ? t('addressBarIcons')
      : t('browserFrameCss');

  const modalHost = document.querySelector<HTMLElement>('[data-settings-main]');

  return (
    <>
      <SettingGroupBlock>
        <SettingGroupLabel>{t('browserAppearance')}</SettingGroupLabel>
        <SettingGroup>
          {/* <MenuAnimations /> */}
          <ImmersiveBrowsing />
          <ImmersivePageIndicator />
          <WarnQuit />
          <ThemeVariant />
          <WebDarkModeVariant />
        </SettingGroup>
      </SettingGroupBlock>
      <SettingGroupBlock>
        <SettingGroupLabel>{t('tabBarSectionLabel')}</SettingGroupLabel>
        <SettingGroup>
          <TopBarVariant />
          <TabsLayoutVariant />
          <TopTabRows />
          <TabOverflowVariant />
          <TabHoverActivationBehaviorSetting />
          <TabHoverActivationDelay />
          <CloseTabOnDoubleClick />
          <CloseTabOnRightClick />
          <TabCloseSelection />
          <TabCloseButtonDisplay />
        </SettingGroup>
      </SettingGroupBlock>
      <SettingGroupBlock>
        <SettingGroupLabel>{t('bookmarkBar')}</SettingGroupLabel>
        <SettingGroup>
          <BookmarksBar />
          {normalizeBookmarkBarDisplay(
            store.settings.bookmarksBarDisplay,
            store.settings.bookmarksBar,
          ) !== 'never' && (
            <>
              <BookmarksBarFolder />
              <BookmarksBarIconsOnly />
              <BookmarksBarRows />
            </>
          )}
        </SettingGroup>
      </SettingGroupBlock>
      <SettingGroupBlock>
        <SettingGroupLabel>{t('advancedAppearance')}</SettingGroupLabel>
        <AdvancedEntries>
          <AdvancedEntry
            type="button"
            onClick={(event) => openModal('toolbar', event)}
          >
            <SettingIcon tone="purple">
              <SlidersHorizontal size={19} weight="fill" />
            </SettingIcon>
            <AdvancedEntryCopy>
              <AdvancedEntryTitle>{t('customizeToolbar')}</AdvancedEntryTitle>
              <AdvancedEntryDesc>
                {t('customizeToolbarEntryDesc')}
              </AdvancedEntryDesc>
            </AdvancedEntryCopy>
            <CaretRight size={17} color="#B0B0BA" />
          </AdvancedEntry>
          <AdvancedEntry
            type="button"
            onClick={(event) => openModal('address-icons', event)}
          >
            <SettingIcon tone="orange">
              <Star size={19} weight="fill" />
            </SettingIcon>
            <AdvancedEntryCopy>
              <AdvancedEntryTitle>{t('addressBarIcons')}</AdvancedEntryTitle>
              <AdvancedEntryDesc>
                {t('addressBarIconsEntryDesc')}
              </AdvancedEntryDesc>
            </AdvancedEntryCopy>
            <CaretRight size={17} color="#B0B0BA" />
          </AdvancedEntry>
          <AdvancedEntry
            type="button"
            onClick={(event) => openModal('browser-css', event)}
          >
            <SettingIcon tone="cyan">
              <CodeBlock size={19} weight="fill" />
            </SettingIcon>
            <AdvancedEntryCopy>
              <AdvancedEntryTitle>{t('browserFrameCss')}</AdvancedEntryTitle>
              <AdvancedEntryDesc>{t('browserCssEntryDesc')}</AdvancedEntryDesc>
            </AdvancedEntryCopy>
            <CaretRight size={17} color="#B0B0BA" />
          </AdvancedEntry>
        </AdvancedEntries>
      </SettingGroupBlock>
      {modal &&
        modalHost &&
        createPortal(
          <ModalLayer
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeModal();
            }}
          >
            <SettingsModal
              $css={modal === 'browser-css'}
              role="dialog"
              aria-modal="true"
              aria-labelledby="appearance-modal-title"
            >
              <ModalHead>
                <ModalTitle id="appearance-modal-title">
                  {modalTitle}
                </ModalTitle>
                <ModalClose
                  type="button"
                  title={t('close')}
                  aria-label={t('close')}
                  onClick={closeModal}
                >
                  <X size={18} />
                </ModalClose>
              </ModalHead>
              <ModalBody>
                {modal === 'toolbar' && (
                  <CustomizeToolbar embedded mode="toolbar" />
                )}
                {modal === 'address-icons' && (
                  <CustomizeToolbar embedded mode="address-icons" />
                )}
                {modal === 'browser-css' && (
                  <>
                    <CssModalTabRow>
                    <CssModalTabs role="tablist">
                      <CssModalTab
                        role="tab"
                        aria-selected={cssTab === 'visual'}
                        $active={cssTab === 'visual'}
                        onClick={() => setCssTab('visual')}
                      >
                        {t('visualTuning')}
                      </CssModalTab>
                      <CssModalTab
                        role="tab"
                        aria-selected={cssTab === 'code'}
                        $active={cssTab === 'code'}
                        onClick={() => setCssTab('code')}
                      >
                        {t('customCssTab')}
                      </CssModalTab>
                    </CssModalTabs>
                    </CssModalTabRow>
                    {cssTab === 'visual' ? (
                      <ChromeStylePanel />
                    ) : (
                      <CustomChromeCss />
                    )}
                  </>
                )}
              </ModalBody>
            </SettingsModal>
          </ModalLayer>,
          modalHost,
        )}
    </>
  );
});
