import * as React from 'react';
import { observer } from 'mobx-react-lite';
import {
  Browsers,
  DownloadSimple,
  GearSix,
  GlobeHemisphereWest,
  HandPalm,
  Info,
  Key,
  Keyboard,
  LockKey,
  MagnifyingGlass,
  Power,
  ShieldCheck,
  Sun,
  TextAa,
  Translate,
  X,
} from '@phosphor-icons/react';

import { SettingsSection } from '../../store';
import { Appearance } from '../Appearance';
import { AddressBar, ManageSearchEngines } from '../AddressBar';
import { Privacy } from '../Privacy';
import { WebBrowsing } from '../WebBrowsing';
import store from '../../store';
import styled, { ThemeProvider, css } from 'styled-components';
import { ITheme } from '~/interfaces';
import { getPalette } from '../../utils/palette';
import { Autofill } from '../Autofill';
import { OnStartup } from '../Startup';
import { Container } from '~/renderer/components/Pages';
import { GlobalNavigationDrawer } from '~/renderer/components/GlobalNavigationDrawer';
import { Downloads } from '../Downloads';
import { ICON_TRASH, ICON_EDIT } from '~/renderer/constants';
import {
  ContextMenuItem,
  ContextMenu,
} from '~/renderer/components/ContextMenu';
import {
  Nav,
  NavBrand,
  NavLogo,
  NavTitle,
  NavSearch,
  NavSearchInput,
  NavSearchClear,
  NavKeyboardShortcut,
  NavSectionLabel,
  NavList,
  NavItem,
  NavIcon,
  NavLabel,
  NavResults,
  NavResultItem,
  NavResultLabel,
  NavResultSection,
  NavResultEmpty,
  Main,
  MainTopbar,
  Breadcrumb,
  MainContent,
  MainInner,
  PageHeading,
  SeDialog,
  SeDialogHeader,
  SeDialogIcon,
  SeDialogHeading,
  SeDialogSub,
  SeFieldGroup,
  SeHint,
  SeDialogFooter,
  SeField,
  SeFieldLabel,
  SeInput,
  SettingsTone,
} from './style';
import { WebUIStyle } from '~/renderer/mixins/default-styles';
import { About } from '~/renderer/views/settings/components/About';
import { DefaultBrowser } from '~/renderer/views/settings/components/DefaultBrowser';
import { SystemSection } from '~/renderer/views/settings/components/System';
import { Permissions } from '../Permissions';
import { Shortcuts } from '../Shortcuts';
import { MouseGestures } from '../MouseGestures';
import { SelectionTranslate } from '../SelectionTranslate';
import { Language } from '../Language';
import { useI18n } from '~/renderer/components/I18n';
import {getWebUIContext} from '~/common/webui-context';
import type { MessageKey } from '~/common/i18n';

// 开源版：账号卡片与登录入口已移除。

// 设置页统一按钮:蓝底白字(主操作,默认)/ 浅蓝底蓝字(variant="soft",用于取消、
// 次要操作,与主按钮并排时保留视觉层级)。theme 由设置页外层 ThemeProvider 注入,
// getPalette 据深/浅色取配色。换掉旧灰底 NormalButton,统一为现代蓝主题。
const ModernButton = styled.button<{
  variant?: 'primary' | 'soft';
  theme?: ITheme;
}>`
  -webkit-appearance: none;
  appearance: none;
  border: none;
  outline: none;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
  height: 36px;
  min-width: 84px;
  padding: 0 18px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  transition: filter 0.16s ease, box-shadow 0.16s ease,
    background-color 0.16s ease, transform 0.08s ease, color 0.16s ease;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none !important;
    filter: none !important;
  }

  &:focus-visible {
    box-shadow: 0 0 0 3px ${({ theme }) => getPalette(theme).primary}33;
  }

  ${({ variant, theme }) => {
    const p = getPalette(theme);
    if (variant === 'soft') {
      return css`
        color: ${p.primary};
        background-color: ${p.primarySoft};
        box-shadow: inset 0 0 0 1px ${p.primary}26;

        &:hover {
          background-color: ${p.primary}1a;
          box-shadow: inset 0 0 0 1px ${p.primary}40;
        }
        &:active {
          transform: scale(0.97);
        }
      `;
    }
    return css`
      color: #ffffff;
      background-color: ${p.primary};
      box-shadow: 0 1px 2px rgba(20, 27, 45, 0.12),
        0 8px 20px -12px ${p.primary}cc;

      &:hover {
        filter: brightness(1.07);
        box-shadow: 0 2px 5px rgba(20, 27, 45, 0.16),
          0 12px 26px -10px ${p.primary}d9;
      }
      &:active {
        filter: brightness(0.96);
        transform: scale(0.97);
      }
    `;
  }}
`;

export const NormalButton = ({
  children,
  onClick,
  variant,
  style,
  disabled,
  title,
}: {
  children?: any;
  onClick?: any;
  variant?: 'primary' | 'soft';
  style?: any;
  disabled?: boolean;
  title?: string;
}) => {
  return (
    <ModernButton
      type="button"
      variant={variant}
      onClick={onClick}
      style={style}
      disabled={disabled}
      title={title}
    >
      {children}
    </ModernButton>
  );
};

// ===== 设置项搜索索引 =====
// 注意:搜索只匹配本数组里的 label/keywords。新增/改动设置项(UI 里的 Title/Header)
// 务必同步在此登记(写 label + labelKey + 中文同义词/英文别名/拼音首字母),否则设置搜索搜不到。
// label/keywords 仅用于检索(中文/英文/拼音都靠它们命中),展示用 labelKey 经 t() 翻译。

interface ISettingsSearchEntry {
  label: string;
  labelKey: MessageKey;
  section: SettingsSection;
  // 额外匹配词（中文同义词 / 英文别名 / 拼音首字母），仅用于检索，不展示
  keywords?: string;
}

const SETTINGS_SEARCH_INDEX: ISettingsSearchEntry[] = [
  // 语言
  {
    label: '语言',
    labelKey: 'language',
    section: 'language',
    keywords: 'language locale lang yuyan 语言 国际化 internationalization',
  },
  // 外观设置
  {
    label: '外观设置',
    labelKey: 'appearance',
    section: 'appearance',
    keywords: 'appearance personalize wgh 个性化 外观 主题',
  },
  {
    label: '沉浸浏览',
    labelKey: 'immersiveBrowsing',
    section: 'appearance',
    keywords: 'immersive browsing cjll 沉浸 浏览 顶边 顶部 自动隐藏 头部 全屏',
  },
  {
    label: '显示书签栏',
    labelKey: 'showBookmarksBar',
    section: 'appearance',
    keywords: 'bookmarks bar sql 书签',
  },
  {
    label: '关闭多个标签时显示警告',
    labelKey: 'searchWarnCloseTabs',
    section: 'appearance',
    keywords: 'warn quit close 关闭 警告 弹窗 标签',
  },
  {
    label: '主题颜色',
    labelKey: 'themeColor',
    section: 'appearance',
    keywords: 'theme color zt 浅色 深色 暗色 夜间 自动 light dark',
  },
  {
    label: '顶部标题栏',
    labelKey: 'topTitleBar',
    section: 'appearance',
    keywords: 'top bar title 标题栏 分离 融合',
  },
  {
    label: '标签栏位置',
    labelKey: 'tabsPosition',
    section: 'appearance',
    keywords: 'tabs layout bqw 标签 顶部 左侧 右侧 侧边栏',
  },
  {
    label: '鼠标悬停标签自动激活',
    labelKey: 'searchHoverTabActivation',
    section: 'appearance',
    keywords:
      'tab hover activate delay 鼠标 悬停 标签 自动 激活 延迟 毫秒 回收',
  },
  {
    label: '双击关闭标签页',
    labelKey: 'closeTabOnDoubleClick',
    section: 'appearance',
    keywords: 'double click dblclick sj 双击 关闭 标签',
  },
  {
    label: '书签栏行数',
    labelKey: 'bookmarksBarRowCountTitle',
    section: 'appearance',
    keywords: 'bookmarks bar rows sql 行数 书签栏 多行 显示',
  },
  {
    label: '书签栏展示目录',
    labelKey: 'searchBookmarksBarFolder',
    section: 'appearance',
    keywords: 'bookmarks bar folder directory sql 书签栏 展示 目录 移动端 子目录',
  },
  {
    label: '浏览器框架 CSS',
    labelKey: 'browserFrameCss',
    section: 'appearance',
    keywords: 'custom css zdyys 自定义 样式 顶部栏 侧边栏 红框',
  },
  {
    label: '自定义工具栏',
    labelKey: 'customizeToolbar',
    section: 'appearance',
    keywords:
      'customize toolbar zdygjl 工具栏 自定义 按钮 位置 拖拽 排序 主页 下载 订阅 雨见AI 截图 翻译 清理缓存 显示 隐藏',
  },
  // 自动填充和密码
  {
    label: '自动填充和密码',
    labelKey: 'autofill',
    section: 'autofill',
    keywords: 'autofill password mm 密码 填充 密码填充',
  },
  {
    label: '密码自动记忆和填充',
    labelKey: 'searchRememberPassword',
    section: 'autofill',
    keywords: 'autofill password remember 密码 记忆 填充',
  },
  // 启动时
  {
    label: '启动时',
    labelKey: 'startup',
    section: 'startup',
    keywords: 'startup qd 启动 开机',
  },
  {
    label: '打开新标签页',
    labelKey: 'searchOpenNewTabPage',
    section: 'startup',
    keywords: 'new tab 新标签 空白',
  },
  {
    label: '恢复标签页',
    labelKey: 'searchRestoreTabs',
    section: 'startup',
    keywords: 'continue restore 恢复 上次',
  },
  {
    label: '打开特定页面',
    labelKey: 'searchOpenSpecificPages',
    section: 'startup',
    keywords: 'urls specific 特定 指定 页面',
  },
  // 搜索设置
  {
    label: '搜索设置',
    labelKey: 'searchSettings',
    section: 'address-bar',
    keywords: 'address bar dzl 地址栏 地址 搜索',
  },
  {
    label: '展示搜索和网站建议',
    labelKey: 'searchSuggestions',
    section: 'address-bar',
    keywords:
      'suggestions 建议 搜索 网站 提示 联想 标签页 历史 搜索词 书签 剪贴板 来源',
  },
  {
    label: '搜索引擎 AI 建议面板',
    labelKey: 'searchAiSuggestionsPanel',
    section: 'address-bar',
    keywords:
      'search annotator AI ssyq AI 建议 标注 气泡 答案 相关性 角标 智能',
  },
  {
    label: '默认搜索引擎',
    labelKey: 'searchDefaultEngine',
    section: 'address-bar',
    keywords: 'search engine ssyq 搜索引擎',
  },
  {
    label: '双引擎搜索',
    labelKey: 'searchDualEngine',
    section: 'address-bar',
    keywords: 'dual engine syq 双引擎 副引擎 侧边栏 移动',
  },
  {
    label: '副搜索引擎',
    labelKey: 'searchSecondaryEngine',
    section: 'address-bar',
    keywords: 'secondary engine fyq 副引擎 搜索引擎',
  },
  {
    label: '管理搜索引擎',
    labelKey: 'manageSearchEngines',
    section: 'search-engines',
    keywords: 'manage search engines 添加 编辑 搜索引擎',
  },
  // 下载
  {
    label: '下载',
    labelKey: 'downloads',
    section: 'downloads',
    keywords: 'downloads xz 下载',
  },
  {
    label: '下载位置',
    labelKey: 'searchDownloadLocation',
    section: 'downloads',
    keywords: 'download location path 位置 路径 目录',
  },
  {
    label: '下载前询问',
    labelKey: 'searchAskBeforeDownload',
    section: 'downloads',
    keywords: 'ask before download 询问 提示',
  },
  {
    label: '使用外部下载器',
    labelKey: 'searchExternalDownloader',
    section: 'downloads',
    keywords:
      'external downloader idm thunder aria2 迅雷 外部 下载器 自定义 路径 参数 命令行 可执行文件',
  },
  {
    label: '下载器类型',
    labelKey: 'searchDownloaderType',
    section: 'downloads',
    keywords: 'downloader type xlql 下载器 类型 idm 迅雷 aria2 自定义',
  },
  {
    label: '自动接管所有下载',
    labelKey: 'searchAutoInterceptDownloads',
    section: 'downloads',
    keywords: 'auto intercept zdjg 自动 接管 下载 全部',
  },
  // 默认浏览器
  {
    label: '默认浏览器',
    labelKey: 'defaultBrowser',
    section: 'default-browser',
    keywords: 'default browser mrllq 默认 浏览器 设为默认 default',
  },
  {
    label: '设为默认浏览器',
    labelKey: 'searchSetDefaultBrowser',
    section: 'default-browser',
    keywords: 'set default browser 设为默认 默认浏览器',
  },
  // 系统
  {
    label: '系统',
    labelKey: 'system',
    section: 'system',
    keywords:
      'system xt 数据 存储位置 目录 迁移 data location migrate cclw 路径',
  },
  {
    label: '数据存储位置',
    labelKey: 'searchDataLocation',
    section: 'system',
    keywords: 'data location 存储目录 迁移 数据 路径 自定义',
  },
  {
    label: '数据备份',
    labelKey: 'searchDataBackup',
    section: 'system',
    keywords:
      'backup restore beifen huanyuan 数据 备份 还原 zip 压缩包 书签 历史 密码 cookie 扩展',
  },
  {
    label: '硬件加速',
    labelKey: 'searchHardwareAcceleration',
    section: 'system',
    keywords:
      'hardware acceleration gpu yjjs 硬件 加速 gpu 显卡 渲染 花屏 黑屏',
  },
  {
    label: '内存节省',
    labelKey: 'searchMemorySaver',
    section: 'system',
    keywords: 'memory saver ncjs 内存 节省 省内存 冻结 释放 休眠',
  },
  {
    label: 'Flash 支持',
    labelKey: 'searchFlashSupport',
    section: 'system',
    keywords: 'flash ruffle swf 插件 兼容 动画 游戏',
  },
  {
    label: '独立浏览器指纹',
    labelKey: 'searchFingerprint',
    section: 'system',
    keywords:
      'fingerprint fingerprinting zhiwen 指纹 小号 canvas webgl 设备 隔离',
  },
  {
    label: '独立 IP 代理',
    labelKey: 'searchProxyIp',
    section: 'system',
    keywords: 'proxy ip dl 代理 小号 http socks5 出口 网络',
  },
  // 拦截保护
  {
    label: '拦截保护',
    labelKey: 'privacy',
    section: 'privacy',
    keywords: 'privacy ljbh 隐私 拦截 保护 广告',
  },
  {
    label: '广告拦截订阅',
    labelKey: 'searchAdblockSubscriptions',
    section: 'privacy',
    keywords: 'adblock ublock adguard 广告 拦截 订阅 规则',
  },
  // 网站浏览
  {
    label: '网站浏览',
    labelKey: 'webBrowsing',
    section: 'web-browsing',
    keywords: 'web browsing wzll 网站 浏览 数据 cookie 登录',
  },
  {
    label: '清除浏览数据',
    labelKey: 'searchClearBrowsingData',
    section: 'web-browsing',
    keywords: 'browsing data clear 清除 缓存 历史 cookie',
  },
  {
    label: '退出时自动清理',
    labelKey: 'searchClearOnExit',
    section: 'web-browsing',
    keywords:
      'clear on exit tczdql 退出 清理 自动 缓存 cookie 历史 搜索历史 关闭时',
  },
  {
    label: 'Do Not Track 请求',
    labelKey: 'searchDoNotTrack',
    section: 'web-browsing',
    keywords: 'do not track dnt 追踪 隐私',
  },
  {
    label: '无痕模式下阻止第三方 Cookie',
    labelKey: 'searchIncognitoThirdPartyCookies',
    section: 'web-browsing',
    keywords:
      'incognito third party cookie whms 阻止 第三方 cookie 无痕 隐私 拦截',
  },
  {
    label: '重启后保持登录',
    labelKey: 'searchPersistLogin',
    section: 'web-browsing',
    keywords: 'persist session cookie cjbcdl 重启 登录 保持 会话 cookie 落盘 域名 主域名 host 白名单',
  },
  {
    label: '权限管理',
    labelKey: 'permissions',
    section: 'permissions',
    keywords:
      'permissions qxgl 权限 站点 网站 记住 允许 询问 拒绝 外链 跳转 传感器 麦克风 摄像头 定位 通知 新页面 打开 链接 window open',
  },
  {
    label: '弹窗在新标签页打开',
    labelKey: 'searchPopupNewTab',
    section: 'permissions',
    keywords:
      'popup window tab tczxbqydk 弹窗 新标签页 独立窗口 全局设置 网站设置',
  },
  {
    label: '网站权限',
    labelKey: 'searchSitePermissions',
    section: 'permissions',
    keywords: 'site override dlwzsz 独立 网站 设置 覆盖 弹窗 权限',
  },
  {
    label: '所有跳转在新页面打开',
    labelKey: 'searchLinksNewPage',
    section: 'permissions',
    keywords: 'all links new page 所有 跳转 链接 新页面 打开 网站设置',
  },
  {
    label: '网站权限配置',
    labelKey: 'searchPermissionRules',
    section: 'permissions',
    keywords:
      'remember saved permission 已记忆 已保存 权限规则 新页面打开 链接新开 全局 所有链接 站点',
  },
  // 快捷键
  {
    label: '快捷键',
    labelKey: 'shortcuts',
    section: 'shortcuts',
    keywords: 'shortcuts hotkey kjj 快捷键 热键 键盘 keyboard 加速键',
  },
  {
    label: '修改快捷键',
    labelKey: 'searchEditShortcuts',
    section: 'shortcuts',
    keywords: 'rebind change kjj 修改 自定义 快捷键 改键 绑定',
  },
  {
    label: '打开新标签页',
    labelKey: 'searchOpenNewTabPage',
    section: 'shortcuts',
    keywords: 'new tab ctrl t 新标签 快捷键',
  },
  {
    label: '关闭标签页',
    labelKey: 'searchCloseTabShortcut',
    section: 'shortcuts',
    keywords: 'close tab ctrl w 关闭标签 快捷键',
  },
  // 鼠标手势
  {
    label: '鼠标手势',
    labelKey: 'mouseGestures',
    section: 'mouse-gestures',
    keywords: 'mouse gesture sbss 鼠标 手势 右键 左键 长按 拖动 mouse gesture',
  },
  {
    label: '标签栏滚轮事件',
    labelKey: 'searchTabWheel',
    section: 'mouse-gestures',
    keywords:
      'tab wheel 标签栏 标签页 滚轮 滚动 切换 默认 始终切换 水平 垂直',
  },
  {
    label: '启用右键手势',
    labelKey: 'searchRightButtonGestures',
    section: 'mouse-gestures',
    keywords: 'enable right gesture yq右键手势 启用 右键 手势 开关 分开',
  },
  {
    label: '手势轨迹颜色',
    labelKey: 'searchGestureTrailColor',
    section: 'mouse-gestures',
    keywords: 'trail color gjys 轨迹 颜色 手势',
  },
  {
    label: '启用左键拖拽手势',
    labelKey: 'searchLeftDragGestures',
    section: 'mouse-gestures',
    keywords:
      'enable left drag yq左键拖拽 启用 左键 拖拽 手势 面板 链接 图片 拖动',
  },
  {
    label: '滑动距离',
    labelKey: 'searchDragThreshold',
    section: 'mouse-gestures',
    keywords: 'drag threshold hdjl 滑动 距离 阈值 像素 px 触发',
  },
  {
    label: '侧边键设置',
    labelKey: 'searchSideButtons',
    section: 'mouse-gestures',
    keywords: 'side button cbj 侧键 侧边键 后退 前进 mouse button 3 4',
  },
  {
    label: '自定义手势',
    labelKey: 'searchCustomGestures',
    section: 'mouse-gestures',
    keywords: 'custom gesture zdy 自定义 手势 后退 前进 刷新 形状',
  },
  // 文字选择
  {
    label: '文字选择',
    labelKey: 'textSelection',
    section: 'selection-translate',
    keywords: 'text selection wzxz 文字 选择 选中 菜单 划词',
  },
  {
    label: '文字菜单',
    labelKey: 'searchTextMenu',
    section: 'selection-translate',
    keywords: 'text menu wzcd 文字 菜单 复制 搜索 更多 隐藏',
  },
  {
    label: '划词翻译',
    labelKey: 'searchSelectionTranslate',
    section: 'selection-translate',
    keywords: 'selection translate hcfy 划词 翻译 选中 选词 悬浮 卡片',
  },
  {
    label: '显示字数',
    labelKey: 'searchWordCount',
    section: 'selection-translate',
    keywords: 'word count xszs 字数 计数 选中 文字 菜单',
  },
  {
    label: '划词翻译目标语言',
    labelKey: 'searchTranslateTargetLanguage',
    section: 'selection-translate',
    keywords: 'target language mbyy 目标 语言 划词 翻译 中文 英文 日文',
  },
  {
    label: '翻译引擎',
    labelKey: 'searchTranslateEngine',
    section: 'selection-translate',
    keywords:
      'translate engine fyyq 引擎 微软 microsoft 翻译 免费 共用 雨见 大模型 llm gpt 自定义 openai chat completions responses',
  },
  // 关于
  {
    label: '关于',
    labelKey: 'about',
    section: 'about',
    keywords: 'about gy 版本 version 博客',
  },
  {
    label: '官方博客',
    labelKey: 'searchOfficialBlog',
    section: 'about',
    keywords: 'blog 博客 官方',
  },
  {
    label: '检查新版本',
    labelKey: 'searchCheckUpdates',
    section: 'about',
    keywords: 'new version update 更新 版本 下载',
  },
  {
    label: '当前版本',
    labelKey: 'searchCurrentVersion',
    section: 'about',
    keywords: 'current version 版本 chromium 内核',
  },
];

const SECTION_MESSAGE_KEYS: Partial<Record<SettingsSection, MessageKey>> = {
  appearance: 'appearance',
  autofill: 'autofill',
  startup: 'startup',
  'address-bar': 'searchSettings',
  'search-engines': 'manageSearchEngines',
  downloads: 'downloads',
  'web-browsing': 'webBrowsing',
  privacy: 'privacy',
  permissions: 'permissions',
  shortcuts: 'shortcuts',
  'mouse-gestures': 'mouseGestures',
  'selection-translate': 'textSelection',
  language: 'language',
  'default-browser': 'defaultBrowser',
  system: 'system',
  about: 'about',
};

const getLocalizedSectionLabel = (
  section: SettingsSection,
  translate: (key: MessageKey) => string,
) => {
  return translate(SECTION_MESSAGE_KEYS[section] ?? 'settings');
};

const searchSettings = (query: string): ISettingsSearchEntry[] => {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  return SETTINGS_SEARCH_INDEX.filter((entry) => {
    if (entry.section === 'autofill' && !process.env.ENABLE_AUTOFILL) {
      return false;
    }
    return (
      entry.label.toLowerCase().includes(q) ||
      (entry.keywords && entry.keywords.toLowerCase().includes(q))
    );
  });
};

// Settings sections are addressable so users can bookmark/share a specific tab.
// Keep the query-string entry point for existing deep links, but use the hash for
// navigation so changing tabs does not reload the page or discard other params.
const selectSettingsSection = (section: SettingsSection) => {
  store.selectedSection = section;
  if (typeof window !== 'undefined') {
    const url = new URL(window.location.href);
    url.hash = section;
    window.history.pushState({section}, '', url.toString());
  }
};

const NavMenuItem = observer(
  ({
    section,
    subSections,
    children,
    icon,
    tone,
  }: {
    section: SettingsSection;
    subSections?: SettingsSection[];
    children: any;
    icon: React.ReactNode;
    tone: SettingsTone;
  }) => {
    const selected =
      store.selectedSection === section ||
      (subSections && subSections.includes(store.selectedSection));

    return (
      <NavItem
        selected={selected}
        onClick={() => selectSettingsSection(section)}
      >
        <NavIcon selected={selected} tone={tone}>
          {icon}
        </NavIcon>
        <NavLabel selected={selected}>{children}</NavLabel>
      </NavItem>
    );
  },
);

const onBlur = () => {
  store.menuVisible = false;
};

const onMakeDefaultClick = () => {
  store.settings.searchEngine = store.settings.searchEngines.findIndex(
    (x) => x.keyword === store.editedSearchEngine.keyword,
  );
  store.menuVisible = false;
};

const onRemoveClick = () => {
  store.settings.searchEngines = store.settings.searchEngines.filter(
    (x) => x.keyword !== store.editedSearchEngine.keyword,
  );
  store.save();
  store.menuVisible = false;
};

const onEditClick = () => {
  store.menuVisible = false;
  store.dialogVisible = true;
  store.dialogContent = 'edit-search-engine';
  store.searchEngineInputRef.current.value = store.editedSearchEngine.name;
  store.searchEngineKeywordInputRef.current.value =
    store.editedSearchEngine.keyword;
  store.searchEngineUrlInputRef.current.value = store.editedSearchEngine.url;
};

const onSaveClick = () => {
  const name = store.searchEngineInputRef.current.value.trim();
  const keyword = store.searchEngineKeywordInputRef.current.value.trim();
  const url = store.searchEngineUrlInputRef.current.value.trim();

  const item = store.settings.searchEngines.find((x) => x.keyword === keyword);

  if (keyword !== '' && name !== '' && url !== '') {
    if (store.dialogContent === 'edit-search-engine') {
      item.name = name;
      item.keyword = keyword;
      item.url = url;
      store.dialogVisible = false;
    } else if (store.dialogContent === 'add-search-engine') {
      if (!item) {
        store.settings.searchEngines.push({
          name,
          keyword,
          url,
        });
        store.dialogVisible = false;
      }
    }
    store.save();
  }
};

export default observer(() => {
  const { selectedSection } = store;
  const t = useI18n();

  const [searchQuery, setSearchQuery] = React.useState('');
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const searchResults = searchSettings(searchQuery);
  const searching = searchQuery.trim().length > 0;
  const sectionHydratedRef = React.useRef(false);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hashSection = window.location.hash.replace(/^#(?:section=)?/, '');
    const section = hashSection || params.get('section');

    const validSections: SettingsSection[] = [
      'appearance',
      'autofill',
      'address-bar',
      'privacy',
      'web-browsing',
      'permissions',
      'startup',
      'language',
      'shortcuts',
      'mouse-gestures',
      'selection-translate',
      'downloads',
      'system',
      'default-browser',
      'search-engines',
      'customize-toolbar',
      'about',
    ];

    if (section && validSections.includes(section as SettingsSection)) {
      store.selectedSection =
        section === 'customize-toolbar'
          ? 'appearance'
          : (section as SettingsSection);
    }

    if (
      section === 'web-browsing' &&
      params.get('dialog') === 'browsing-data'
    ) {
      store.dialogContent = 'browsing-data';
    }

    // 双引擎搜索告知条「设置」按钮带 ?highlight=<key>:滚动+脉冲高亮该项。
    const highlight = params.get('highlight');
    if (highlight) {
      store.setHighlightedSetting(highlight);
    }

    sectionHydratedRef.current = true;

    const onLocationChange = () => {
      const next = window.location.hash.replace(/^#(?:section=)?/, '');
      if (validSections.includes(next as SettingsSection)) {
        store.selectedSection = next as SettingsSection;
      }
    };
    window.addEventListener('hashchange', onLocationChange);
    window.addEventListener('popstate', onLocationChange);
    return () => {
      window.removeEventListener('hashchange', onLocationChange);
      window.removeEventListener('popstate', onLocationChange);
    };
  }, []);

  // A few settings panels navigate to a sub-section directly through the store.
  // Mirror those changes into the URL as well, without clobbering the initial
  // query-string deep link before it has been read above.
  React.useEffect(() => {
    if (!sectionHydratedRef.current) return;
    if (window.location.hash.replace(/^#(?:section=)?/, '') === selectedSection) return;
    const url = new URL(window.location.href);
    url.hash = selectedSection;
    window.history.replaceState({section: selectedSection}, '', url.toString());
  }, [selectedSection]);

  React.useEffect(() => {
    const onPageKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === '/' &&
        document.activeElement !== searchInputRef.current &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes(
          (document.activeElement as HTMLElement)?.tagName,
        )
      ) {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onPageKeyDown);
    return () => window.removeEventListener('keydown', onPageKeyDown);
  }, []);

  const selectedLabel = getLocalizedSectionLabel(selectedSection, t);

  const onResultClick = (section: SettingsSection) => {
    selectSettingsSection(section);
    setSearchQuery('');
  };


  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchResults.length > 0) {
      onResultClick(searchResults[0].section);
    } else if (e.key === 'Escape') {
      setSearchQuery('');
    }
  };

  let dialogTitleKey: MessageKey | null = null;

  if (store.dialogContent === 'edit-search-engine') {
    dialogTitleKey = 'sdlgEditEngine';
  } else if (store.dialogContent === 'add-search-engine') {
    dialogTitleKey = 'sdlgAddEngine';
  }

  return (
    <ThemeProvider
      theme={{
        ...store.theme,
        dark: store.theme['pages.lightForeground'],
        settingsPage: true,
        settingsAccent: store.theme['pages.lightForeground']
          ? '#7583FF'
          : '#4A5AE9',
        settingsAccentSoft: store.theme['pages.lightForeground']
          ? 'rgba(117, 131, 255, 0.16)'
          : '#EEF0FF',
      }}
    >
      <Container
        onMouseDown={(e) => (store.dialogVisible = false)}
        darken={store.dialogVisible}
      >
        <WebUIStyle />
        <GlobalNavigationDrawer></GlobalNavigationDrawer>
        <ContextMenu
          tabIndex={1}
          ref={store.menuRef}
          onBlur={onBlur}
          style={{
            top: store.menuInfo.top,
            left: store.menuInfo.left,
          }}
          visible={store.menuVisible}
        >
          {store.editedSearchEngine &&
            store.editedSearchEngine.keyword !== store.searchEngine.keyword && (
              <>
                <ContextMenuItem onClick={onMakeDefaultClick} icon=" ">
                  {t('resetToDefault')}
                </ContextMenuItem>
                <ContextMenuItem onClick={onRemoveClick} icon={ICON_TRASH}>
                  {t('remove')}
                </ContextMenuItem>
              </>
            )}
          {store.editedSearchEngine && (
            <ContextMenuItem onClick={onEditClick} icon={ICON_EDIT}>
              {t('edit')}
            </ContextMenuItem>
          )}
        </ContextMenu>
        <SeDialog
          onMouseDown={(e) => e.stopPropagation()}
          visible={store.dialogVisible}
          ref={store.dialogRef}
        >
          <SeDialogHeader>
            <SeDialogIcon>
              <MagnifyingGlass size={22} weight="bold" />
            </SeDialogIcon>
            <div>
              <SeDialogHeading>
                {dialogTitleKey ? t(dialogTitleKey) : ''}
              </SeDialogHeading>
              <SeDialogSub>
                {store.dialogContent === 'edit-search-engine'
                  ? t('sdlgEditSub')
                  : t('sdlgAddSub')}
              </SeDialogSub>
            </div>
          </SeDialogHeader>

          <SeFieldGroup>
            <SeField>
              <SeFieldLabel>{t('sdlgName')}</SeFieldLabel>
              <SeInput
                ref={store.searchEngineInputRef}
                placeholder={t('sdlgNamePlaceholder')}
                spellCheck={false}
                autoComplete="off"
              />
            </SeField>

            <SeField>
              <SeFieldLabel>{t('sdlgKeyword')}</SeFieldLabel>
              <SeInput
                ref={store.searchEngineKeywordInputRef}
                placeholder={t('sdlgKeywordPlaceholder')}
                spellCheck={false}
                autoComplete="off"
              />
            </SeField>

            <SeField>
              <SeFieldLabel>{t('sdlgUrl')}</SeFieldLabel>
              <SeInput
                ref={store.searchEngineUrlInputRef}
                placeholder="https://www.google.com/search?q=%s"
                spellCheck={false}
                autoComplete="off"
              />
              <SeHint>
                {t('sdlgUrlHintBefore')} <code>%s</code>{' '}
                {t('sdlgUrlHintAfter')}{' '}
                <code>https://www.google.com/search?q=%s</code>
              </SeHint>
            </SeField>
          </SeFieldGroup>

          <SeDialogFooter>
            <NormalButton
              variant="soft"
              onClick={() => (store.dialogVisible = false)}
            >
              {t('cancel')}
            </NormalButton>
            <NormalButton onClick={onSaveClick}>{t('save')}</NormalButton>
          </SeDialogFooter>
        </SeDialog>

        <Nav>
          <NavBrand>
            <NavLogo>
              <GearSix size={20} weight="fill" />
            </NavLogo>
            <NavTitle>{t('settings')}</NavTitle>
          </NavBrand>
          <NavSearch>
            <MagnifyingGlass size={15} />
            <NavSearchInput
              ref={searchInputRef}
              value={searchQuery}
              placeholder={t('searchSettings')}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
            />
            {searching && (
              <NavSearchClear
                type="button"
                title={t('clear')}
                onClick={() => setSearchQuery('')}
              >
                <X size={14} weight="bold" />
              </NavSearchClear>
            )}
            {!searching && <NavKeyboardShortcut>/</NavKeyboardShortcut>}
          </NavSearch>
          {searching ? (
            <NavResults>
              {searchResults.length === 0 ? (
                <NavResultEmpty>
                  {t('searchNoResults', { query: searchQuery.trim() })}
                </NavResultEmpty>
              ) : (
                searchResults.map((item, key) => (
                  <NavResultItem
                    key={key}
                    onClick={() => onResultClick(item.section)}
                  >
                    <NavResultLabel>{t(item.labelKey)}</NavResultLabel>
                    {SECTION_MESSAGE_KEYS[item.section] !== item.labelKey && (
                      <NavResultSection>
                        {getLocalizedSectionLabel(item.section, t)}
                      </NavResultSection>
                    )}
                  </NavResultItem>
                ))
              )}
            </NavResults>
          ) : (
            <>
              <NavSectionLabel>{t('allSettings')}</NavSectionLabel>
              <NavList>
                <NavMenuItem
                  icon={<Translate size={16} weight="bold" />}
                  tone="cyan"
                  section="language"
                >
                  {t('language')}
                </NavMenuItem>
                <NavMenuItem
                  icon={<Sun size={16} weight="fill" />}
                  tone="purple"
                  section="appearance"
                >
                  {t('appearance')}
                </NavMenuItem>
                {process.env.ENABLE_AUTOFILL && (
                  <NavMenuItem
                    icon={<Key size={16} weight="fill" />}
                    tone="purple"
                    section="autofill"
                  >
                    {t('autofill')}
                  </NavMenuItem>
                )}
                <NavMenuItem
                  icon={<Power size={16} weight="bold" />}
                  tone="orange"
                  section="startup"
                >
                  {t('startup')}
                </NavMenuItem>
                <NavMenuItem
                  icon={<MagnifyingGlass size={16} weight="bold" />}
                  tone="cyan"
                  section="address-bar"
                  subSections={['search-engines']}
                >
                  {t('searchSettings')}
                </NavMenuItem>
                <NavMenuItem
                  icon={<DownloadSimple size={16} weight="bold" />}
                  tone="orange"
                  section="downloads"
                >
                  {t('downloads')}
                </NavMenuItem>
                <NavMenuItem
                  icon={<GlobeHemisphereWest size={16} weight="fill" />}
                  tone="cyan"
                  section="web-browsing"
                >
                  {t('webBrowsing')}
                </NavMenuItem>
                <NavMenuItem
                  icon={<ShieldCheck size={16} weight="fill" />}
                  tone="blue"
                  section="privacy"
                >
                  {t('privacy')}
                </NavMenuItem>
                <NavMenuItem
                  icon={<LockKey size={16} weight="fill" />}
                  tone="red"
                  section="permissions"
                >
                  {t('permissions')}
                </NavMenuItem>
                <NavMenuItem
                  icon={<Keyboard size={16} weight="fill" />}
                  tone="green"
                  section="shortcuts"
                >
                  {t('shortcuts')}
                </NavMenuItem>
                <NavMenuItem
                  icon={<HandPalm size={16} weight="fill" />}
                  tone="blue"
                  section="mouse-gestures"
                >
                  {t('mouseGestures')}
                </NavMenuItem>
                <NavMenuItem
                  icon={<TextAa size={16} weight="fill" />}
                  tone="purple"
                  section="selection-translate"
                >
                  {t('textSelection')}
                </NavMenuItem>
                <NavMenuItem
                  icon={<GlobeHemisphereWest size={16} weight="fill" />}
                  tone="cyan"
                  section="default-browser"
                >
                  {t('defaultBrowser')}
                </NavMenuItem>
                <NavMenuItem
                  icon={<Browsers size={16} weight="fill" />}
                  tone="orange"
                  section="system"
                >
                  {t('system')}
                </NavMenuItem>
                <NavMenuItem
                  icon={<Info size={16} weight="fill" />}
                  tone="purple"
                  section="about"
                >
                  {t('about')}
                </NavMenuItem>
              </NavList>
            </>
          )}
        </Nav>

        <Main data-settings-main>
          <MainTopbar>
            <Breadcrumb>
              {t('settings')} / <strong>{selectedLabel}</strong>
            </Breadcrumb>
          </MainTopbar>
          <MainContent>
            <MainInner>
              <PageHeading>{selectedLabel}</PageHeading>
              {selectedSection === 'appearance' && <Appearance />}
              {selectedSection === 'language' && <Language />}
              {selectedSection === 'autofill' &&
                process.env.ENABLE_AUTOFILL && <Autofill />}
              {selectedSection === 'address-bar' && <AddressBar />}
              {selectedSection === 'search-engines' && <ManageSearchEngines />}
              {selectedSection === 'startup' && <OnStartup />}
              {selectedSection === 'privacy' && <Privacy />}
              {selectedSection === 'web-browsing' && <WebBrowsing />}
              {selectedSection === 'permissions' && <Permissions />}
              {selectedSection === 'shortcuts' && <Shortcuts />}
              {selectedSection === 'mouse-gestures' && <MouseGestures />}
              {selectedSection === 'selection-translate' && (
                <SelectionTranslate />
              )}
              {selectedSection === 'downloads' && <Downloads />}
              {selectedSection === 'default-browser' && <DefaultBrowser />}
              {selectedSection === 'system' && <SystemSection />}
              {selectedSection === 'about' && <About />}
            </MainInner>
          </MainContent>
        </Main>
      </Container>
    </ThemeProvider>
  );
});
