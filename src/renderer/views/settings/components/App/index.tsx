import * as React from 'react';
import { observer } from 'mobx-react-lite';

import { SettingsSection } from '../../store';
import { Appearance } from '../Appearance';
import { AddressBar, ManageSearchEngines } from '../AddressBar';
import { Privacy } from '../Privacy';
import store from '../../store';
import styled, {ThemeProvider, css} from 'styled-components';
import {ITheme} from '~/interfaces';
import {getPalette} from '../../utils/palette';
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
  NavTitle,
  NavSearch,
  NavSearchInput,
  NavSearchClear,
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
  MainInner,
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
} from './style';
import { WebUIStyle } from '~/renderer/mixins/default-styles';
import { About } from '~/renderer/views/settings/components/About';
import { DefaultBrowser } from '~/renderer/views/settings/components/DefaultBrowser';
import { SystemSection } from '~/renderer/views/settings/components/System';
import { Permissions } from '../Permissions';
import { Shortcuts } from '../Shortcuts';
import { MouseGestures } from '../MouseGestures';
import { SelectionTranslate } from '../SelectionTranslate';
import { CustomizeToolbar } from '../CustomizeToolbar';

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
    box-shadow: 0 0 0 3px ${({theme}) => getPalette(theme).primary}33;
  }

  ${({variant, theme}) => {
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

// ===== 导航图标（内联 SVG，跟随 currentColor）=====

const IconSearch = ({ size = 17 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7"></circle>
    <path d="m20 20-3.5-3.5"></path>
  </svg>
);

const IconClose = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18"></path>
    <path d="m6 6 12 12"></path>
  </svg>
);

const IconPersonalize = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"></circle>
    <path d="M12 2v2"></path>
    <path d="M12 20v2"></path>
    <path d="m4.93 4.93 1.41 1.41"></path>
    <path d="m17.66 17.66 1.41 1.41"></path>
    <path d="M2 12h2"></path>
    <path d="M20 12h2"></path>
    <path d="m6.34 17.66-1.41 1.41"></path>
    <path d="m19.07 4.93-1.41 1.41"></path>
  </svg>
);

const IconAutofill = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="3" width="14" height="18" rx="2"></rect>
    <path d="M9 7h6"></path>
    <path d="M9 11h6"></path>
  </svg>
);

const IconStartup = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9"></circle>
    <path d="M12 16v-4"></path>
    <path d="M12 8h.01"></path>
  </svg>
);

const IconDownload = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v12"></path>
    <path d="m7 10 5 5 5-5"></path>
    <path d="M5 21h14"></path>
  </svg>
);

const IconShield = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
  </svg>
);

const IconPermission = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="11" width="16" height="9" rx="2"></rect>
    <path d="M8 11V8a4 4 0 0 1 8 0v3"></path>
    <circle cx="12" cy="15.5" r="1"></circle>
  </svg>
);

const IconAbout = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9"></circle>
    <path d="M12 16v-4"></path>
    <path d="M12 8h.01"></path>
  </svg>
);

const IconDefaultBrowser = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9"></circle>
    <path d="M3 12h18"></path>
    <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"></path>
  </svg>
);

const IconSystem = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="12" rx="2"></rect>
    <path d="M8 20h8"></path>
    <path d="M12 16v4"></path>
  </svg>
);

const IconShortcuts = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="6" width="20" height="12" rx="2"></rect>
    <path d="M6 10h.01"></path>
    <path d="M10 10h.01"></path>
    <path d="M14 10h.01"></path>
    <path d="M18 10h.01"></path>
    <path d="M7 14h10"></path>
  </svg>
);

const IconMouseGestures = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 11V6a2 2 0 0 1 4 0v5"></path>
    <path d="M13 11V5a2 2 0 1 1 4 0v9a7 7 0 0 1-7 7h-1a6 6 0 0 1-6-6v-2a2 2 0 0 1 4 0v1"></path>
    <path d="m9 11 .5-2"></path>
  </svg>
);

const IconSelectionTranslate = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m5 8 6 6"></path>
    <path d="m4 14 6-6 2-3"></path>
    <path d="M2 5h12"></path>
    <path d="M7 2h1"></path>
    <path d="m22 22-5-10-5 10"></path>
    <path d="M14 18h6"></path>
  </svg>
);

const IconCustomizeToolbar = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="7" x2="20" y2="7"></line>
    <circle cx="9" cy="7" r="2.2" fill="currentColor" stroke="none"></circle>
    <line x1="4" y1="17" x2="20" y2="17"></line>
    <circle cx="15" cy="17" r="2.2" fill="currentColor" stroke="none"></circle>
  </svg>
);

// ===== 设置项搜索索引 =====

const SECTION_LABELS: { [key in SettingsSection]?: string } = {
  appearance: '个性化',
  autofill: '密码填充',
  startup: '启动时',
  'address-bar': '地址栏',
  'search-engines': '管理搜索引擎',
  downloads: '下载',
  privacy: '拦截保护',
  permissions: '权限管理',
  'default-browser': '默认浏览器',
  system: '系统',
  shortcuts: '快捷键',
  'mouse-gestures': '鼠标手势',
  'selection-translate': '划词翻译',
  'customize-toolbar': '自定义工具栏',
  about: '关于',
};

interface ISettingsSearchEntry {
  label: string;
  section: SettingsSection;
  // 额外匹配词（中文同义词 / 英文别名 / 拼音首字母），仅用于检索，不展示
  keywords?: string;
}

const SETTINGS_SEARCH_INDEX: ISettingsSearchEntry[] = [
  // 个性化
  { label: '个性化', section: 'appearance', keywords: 'appearance personalize wgh 外观 主题' },
  { label: '沉浸浏览', section: 'appearance', keywords: 'immersive browsing cjll 沉浸 浏览 顶边 顶部 自动隐藏 头部 全屏' },
  { label: '显示书签栏', section: 'appearance', keywords: 'bookmarks bar sql 书签' },
  { label: '关闭多个标签时显示警告', section: 'appearance', keywords: 'warn quit close 关闭 警告 标签' },
  { label: '主题颜色', section: 'appearance', keywords: 'theme color zt 浅色 深色 暗色 夜间 自动 light dark' },
  { label: '顶部标题栏', section: 'appearance', keywords: 'top bar title 标题栏 分离 融合' },
  { label: '标签栏位置', section: 'appearance', keywords: 'tabs layout bqw 标签 顶部 左侧 右侧 侧边栏' },
  { label: '双击关闭标签页', section: 'appearance', keywords: 'double click dblclick sj 双击 关闭 标签' },
  // 密码填充
  { label: '密码填充', section: 'autofill', keywords: 'autofill password mm 密码 填充' },
  { label: '密码自动记忆和填充', section: 'autofill', keywords: 'autofill password remember 密码 记忆 填充' },
  // 启动时
  { label: '启动时', section: 'startup', keywords: 'startup qd 启动 开机' },
  { label: '打开新标签页', section: 'startup', keywords: 'new tab 新标签 空白' },
  { label: '恢复标签页', section: 'startup', keywords: 'continue restore 恢复 上次' },
  { label: '打开特定页面', section: 'startup', keywords: 'urls specific 特定 指定 页面' },
  // 地址栏
  { label: '地址栏', section: 'address-bar', keywords: 'address bar dzl 地址 搜索' },
  { label: '展示搜索和网站建议', section: 'address-bar', keywords: 'suggestions 建议 搜索 网站 提示' },
  { label: '默认搜索引擎', section: 'address-bar', keywords: 'search engine ssyq 搜索引擎' },
  { label: '双引擎搜索', section: 'address-bar', keywords: 'dual engine syq 双引擎 副引擎 侧边栏 移动' },
  { label: '副搜索引擎', section: 'address-bar', keywords: 'secondary engine fyq 副引擎 搜索引擎' },
  { label: '管理搜索引擎', section: 'search-engines', keywords: 'manage search engines 添加 编辑 搜索引擎' },
  // 下载
  { label: '下载', section: 'downloads', keywords: 'downloads xz 下载' },
  { label: '下载位置', section: 'downloads', keywords: 'download location path 位置 路径 目录' },
  { label: '下载前询问', section: 'downloads', keywords: 'ask before download 询问 提示' },
  // 默认浏览器
  { label: '默认浏览器', section: 'default-browser', keywords: 'default browser mrllq 默认 浏览器 设为默认 default' },
  { label: '设为默认浏览器', section: 'default-browser', keywords: 'set default browser 设为默认 默认浏览器' },
  // 系统
  { label: '系统', section: 'system', keywords: 'system xt 数据 存储位置 目录 迁移 data location migrate cclw 路径' },
  { label: '数据存储位置', section: 'system', keywords: 'data location 存储目录 迁移 数据 路径 自定义' },
  { label: '硬件加速', section: 'system', keywords: 'hardware acceleration gpu yjjs 硬件 加速 gpu 显卡 渲染 花屏 黑屏' },
  { label: 'Flash 支持', section: 'system', keywords: 'flash ruffle swf 插件 兼容 动画 游戏' },
  // 拦截保护
  { label: '拦截保护', section: 'privacy', keywords: 'privacy ljbh 隐私 拦截 保护 广告' },
  { label: '广告拦截订阅', section: 'privacy', keywords: 'adblock ublock adguard 广告 拦截 订阅 规则' },
  { label: '清除浏览数据', section: 'privacy', keywords: 'browsing data clear 清除 缓存 历史 cookie' },
  { label: 'Do Not Track 请求', section: 'privacy', keywords: 'do not track dnt 追踪 隐私' },
  { label: '权限管理', section: 'permissions', keywords: 'permissions qxgl 权限 站点 网站 记住 允许 拒绝 传感器 麦克风 摄像头 定位 通知 新页面 打开 链接 window open' },
  { label: '已记忆权限', section: 'permissions', keywords: 'remember saved permission 已记忆 已保存 权限规则 新页面打开 链接新开' },
  // 快捷键
  { label: '快捷键', section: 'shortcuts', keywords: 'shortcuts hotkey kjj 快捷键 热键 键盘 keyboard 加速键' },
  { label: '修改快捷键', section: 'shortcuts', keywords: 'rebind change kjj 修改 自定义 快捷键 改键 绑定' },
  { label: '打开新标签页', section: 'shortcuts', keywords: 'new tab ctrl t 新标签 快捷键' },
  { label: '关闭标签页', section: 'shortcuts', keywords: 'close tab ctrl w 关闭标签 快捷键' },
  // 鼠标手势
  { label: '鼠标手势', section: 'mouse-gestures', keywords: 'mouse gesture sbss 鼠标 手势 右键 拖动 mouse gesture' },
  { label: '手势轨迹颜色', section: 'mouse-gestures', keywords: 'trail color gjys 轨迹 颜色 手势' },
  { label: '自定义手势', section: 'mouse-gestures', keywords: 'custom gesture zdy 自定义 手势 后退 前进 刷新 形状' },
  // 划词翻译
  { label: '划词翻译', section: 'selection-translate', keywords: 'selection translate hcfy 划词 翻译 选中 选词 悬浮 卡片' },
  { label: '划词翻译目标语言', section: 'selection-translate', keywords: 'target language mbyy 目标 语言 划词 翻译 中文 英文 日文' },
  // 自定义工具栏
  { label: '自定义工具栏', section: 'customize-toolbar', keywords: 'customize toolbar zdygjl 工具栏 自定义 按钮 位置 拖拽 排序 主页 下载 订阅 雨见AI 显示 隐藏' },
  // 关于
  { label: '关于', section: 'about', keywords: 'about gy 版本 version 博客' },
  { label: '官方博客', section: 'about', keywords: 'blog 博客 官方' },
  { label: '检查新版本', section: 'about', keywords: 'new version update 更新 版本 下载' },
  { label: '当前版本', section: 'about', keywords: 'current version 版本 chromium 内核' },
];

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

const NavMenuItem = observer(
  ({
    section,
    subSections,
    children,
    icon,
  }: {
    section: SettingsSection;
    subSections?: SettingsSection[];
    children: any;
    icon: React.ReactNode;
  }) => {
    const selected =
      store.selectedSection === section ||
      (subSections && subSections.includes(store.selectedSection));

    return (
      <NavItem
        selected={selected}
        onClick={() => (store.selectedSection = section)}
      >
        <NavIcon selected={selected}>{icon}</NavIcon>
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

  const [searchQuery, setSearchQuery] = React.useState('');
  const searchResults = searchSettings(searchQuery);
  const searching = searchQuery.trim().length > 0;

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const section = params.get('section');

    if (!section) {
      return;
    }

    const validSections: SettingsSection[] = [
      'appearance',
      'autofill',
      'address-bar',
      'privacy',
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

    if (validSections.includes(section as SettingsSection)) {
      store.selectedSection = section as SettingsSection;
    }

    // 双引擎搜索告知条「设置」按钮带 ?highlight=<key>:滚动+脉冲高亮该项。
    const highlight = params.get('highlight');
    if (highlight) {
      store.setHighlightedSetting(highlight);
    }
  }, []);

  const onResultClick = (section: SettingsSection) => {
    store.selectedSection = section;
    setSearchQuery('');
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchResults.length > 0) {
      onResultClick(searchResults[0].section);
    } else if (e.key === 'Escape') {
      setSearchQuery('');
    }
  };

  let dialogTitle = '';

  if (store.dialogContent === 'edit-search-engine') {
    dialogTitle = '编辑搜索引擎';
  } else if (store.dialogContent === 'add-search-engine') {
    dialogTitle = '添加搜索引擎';
  }

  return (
    <ThemeProvider
      theme={{ ...store.theme, dark: store.theme['pages.lightForeground'] }}
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
                  恢复默认
                </ContextMenuItem>
                <ContextMenuItem onClick={onRemoveClick} icon={ICON_TRASH}>
                  移除
                </ContextMenuItem>
              </>
            )}
          {store.editedSearchEngine && (
            <ContextMenuItem onClick={onEditClick} icon={ICON_EDIT}>
              编辑
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
              <IconSearch size={22} />
            </SeDialogIcon>
            <div>
              <SeDialogHeading>{dialogTitle}</SeDialogHeading>
              <SeDialogSub>
                {store.dialogContent === 'edit-search-engine'
                  ? '修改名称、关键词或搜索地址'
                  : '添加一个新的搜索引擎到列表'}
              </SeDialogSub>
            </div>
          </SeDialogHeader>

          <SeFieldGroup>
            <SeField>
              <SeFieldLabel>搜索引擎名称</SeFieldLabel>
              <SeInput
                ref={store.searchEngineInputRef}
                placeholder="例如 Google"
                spellCheck={false}
                autoComplete="off"
              />
            </SeField>

            <SeField>
              <SeFieldLabel>关键词</SeFieldLabel>
              <SeInput
                ref={store.searchEngineKeywordInputRef}
                placeholder="例如 google.com"
                spellCheck={false}
                autoComplete="off"
              />
            </SeField>

            <SeField>
              <SeFieldLabel>搜索地址 URL</SeFieldLabel>
              <SeInput
                ref={store.searchEngineUrlInputRef}
                placeholder="https://www.google.com/search?q=%s"
                spellCheck={false}
                autoComplete="off"
              />
              <SeHint>
                用 <code>%s</code> 代表搜索关键词，例如{' '}
                <code>https://www.google.com/search?q=%s</code>
              </SeHint>
            </SeField>
          </SeFieldGroup>

          <SeDialogFooter>
            <NormalButton variant="soft" onClick={() => (store.dialogVisible = false)}>
              取消
            </NormalButton>
            <NormalButton onClick={onSaveClick}>保存</NormalButton>
          </SeDialogFooter>
        </SeDialog>

        <Nav>
          <NavTitle>设置</NavTitle>
          <NavSearch>
            <IconSearch size={16} />
            <NavSearchInput
              value={searchQuery}
              placeholder="搜索设置"
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
            />
            {searching && (
              <NavSearchClear
                type="button"
                title="清除"
                onClick={() => setSearchQuery('')}
              >
                <IconClose size={14} />
              </NavSearchClear>
            )}
          </NavSearch>
          {searching ? (
            <NavResults>
              {searchResults.length === 0 ? (
                <NavResultEmpty>未找到“{searchQuery.trim()}”相关设置</NavResultEmpty>
              ) : (
                searchResults.map((item, key) => (
                  <NavResultItem
                    key={key}
                    onClick={() => onResultClick(item.section)}
                  >
                    <NavResultLabel>{item.label}</NavResultLabel>
                    {SECTION_LABELS[item.section] !== item.label && (
                      <NavResultSection>
                        {SECTION_LABELS[item.section]}
                      </NavResultSection>
                    )}
                  </NavResultItem>
                ))
              )}
            </NavResults>
          ) : (
            <NavList>
              <NavMenuItem icon={<IconPersonalize />} section="appearance">
                个性化
              </NavMenuItem>
              <NavMenuItem icon={<IconCustomizeToolbar />} section="customize-toolbar">
                自定义工具栏
              </NavMenuItem>
              {process.env.ENABLE_AUTOFILL && (
                <NavMenuItem icon={<IconAutofill />} section="autofill">
                  密码填充
                </NavMenuItem>
              )}
              <NavMenuItem icon={<IconStartup />} section="startup">
                启动时
              </NavMenuItem>
              <NavMenuItem
                icon={<IconSearch />}
                section="address-bar"
                subSections={['search-engines']}
              >
                地址栏
              </NavMenuItem>
              <NavMenuItem icon={<IconDownload />} section="downloads">
                下载
              </NavMenuItem>
              <NavMenuItem icon={<IconShield />} section="privacy">
                拦截保护
              </NavMenuItem>
              <NavMenuItem icon={<IconPermission />} section="permissions">
                权限管理
              </NavMenuItem>
              <NavMenuItem icon={<IconShortcuts />} section="shortcuts">
                快捷键
              </NavMenuItem>
              <NavMenuItem icon={<IconMouseGestures />} section="mouse-gestures">
                鼠标手势
              </NavMenuItem>
              <NavMenuItem icon={<IconSelectionTranslate />} section="selection-translate">
                划词翻译
              </NavMenuItem>
              <NavMenuItem
                icon={<IconDefaultBrowser />}
                section="default-browser"
              >
                默认浏览器
              </NavMenuItem>
              <NavMenuItem icon={<IconSystem />} section="system">
                系统
              </NavMenuItem>
              <NavMenuItem icon={<IconAbout />} section="about">
                关于
              </NavMenuItem>
            </NavList>
          )}
        </Nav>

        <Main>
          <MainInner>
            {selectedSection === 'appearance' && <Appearance />}
            {selectedSection === 'customize-toolbar' && <CustomizeToolbar />}
            {selectedSection === 'autofill' && process.env.ENABLE_AUTOFILL && (
              <Autofill />
            )}
            {selectedSection === 'address-bar' && <AddressBar />}
            {selectedSection === 'search-engines' && <ManageSearchEngines />}
            {selectedSection === 'startup' && <OnStartup />}
            {selectedSection === 'privacy' && <Privacy />}
            {selectedSection === 'permissions' && <Permissions />}
            {selectedSection === 'shortcuts' && <Shortcuts />}
            {selectedSection === 'mouse-gestures' && <MouseGestures />}
            {selectedSection === 'selection-translate' && <SelectionTranslate />}
            {selectedSection === 'downloads' && <Downloads />}
            {selectedSection === 'default-browser' && <DefaultBrowser />}
            {selectedSection === 'system' && <SystemSection />}
            {selectedSection === 'about' && <About />}
          </MainInner>
        </Main>
      </Container>
    </ThemeProvider>
  );
});
