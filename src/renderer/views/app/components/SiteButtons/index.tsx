import * as React from 'react';
import {observer} from 'mobx-react-lite';

import {
  ICON_STAR,
  ICON_STAR_FILLED,
  ICON_KEY,
  ICON_MAGNIFY_PLUS,
  ICON_MAGNIFY_MINUS,
  ICON_VIDEO,
} from '~/renderer/constants/icons';
import {
  ShieldCheckIcon,
  ShieldSlashIcon,
  ShieldChevronIcon,
  Translate,
  ArrowSquareOut,
} from '@phosphor-icons/react';
import {ipcRenderer} from 'electron';
import * as remote from '@electron/remote';
import {parse} from 'url';
import store from '../../store';
import {ToolbarButton} from '../ToolbarButton';
import {UpdatePill, NewTabSearchPill} from './style';
import {getAddressBarSearchAnchor} from '../../utils/dialogs';

// 完整按钮至少为网址输入区保留这些空间；不足时按钮收起为图标。
const MIN_ADDRESSBAR_INPUT_WIDTH = 240;

// PWA 安装图标:主图用**网站 manifest 解析出的真实图标**(selectedTab.pwaManifest.icon.src),
// 右下角叠一个蓝色下载角标(蓝底白箭头)。无图标或加载失败时回退到应用窗体线框。
// observer:图标 URL 随选中标签的 manifest 变化自动重渲染。
const PwaSiteIcon = observer(({size = 18}: {size?: number; color?: string}) => {
  const iconUrl = store.tabs.selectedTab?.pwaManifest?.icon?.src || '';
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    setFailed(false);
  }, [iconUrl]);

  const badge = Math.round(size * 0.56);

  return (
    <div
      style={{
        width: size,
        height: size,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {iconUrl && !failed ? (
        <img
          src={iconUrl}
          width={size}
          height={size}
          draggable={false}
          onError={() => setFailed(true)}
          style={{objectFit: 'contain', display: 'block'}}
        />
      ) : (
        // 兜底:无 manifest 图标时画应用窗体线框。
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <rect x="3.5" y="4" width="17" height="16" rx="3" stroke="#3b6fe8" strokeWidth="1.6" />
          <line x1="3.5" y1="8.4" x2="20.5" y2="8.4" stroke="#3b6fe8" strokeWidth="1.6" />
          <circle cx="6.6" cy="6.2" r="0.6" fill="#3b6fe8" />
          <circle cx="8.8" cy="6.2" r="0.6" fill="#3b6fe8" />
        </svg>
      )}
      {/* 右下角下载角标:蓝底白箭头 */}
      <svg
        width={badge}
        height={badge}
        viewBox="0 0 12 12"
        style={{position: 'absolute', right: -1, bottom: -1, display: 'block'}}
      >
        <circle cx="6" cy="6" r="5.6" fill="#3b6fe8" />
        <path d="M6 3.2 V7" stroke="#fff" strokeWidth={1.1} strokeLinecap="round" />
        <path
          d="M4.1 5.4 L6 7.3 L7.9 5.4"
          stroke="#fff"
          strokeWidth={1.1}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
});

const showAddBookmarkDialog = async () => {
  const star = document.getElementById('star');
  const {right, bottom} = star.getBoundingClientRect();
  ipcRenderer.send(`show-add-bookmark-dialog-${store.windowId}`, right, bottom);
};

const showZoomDialog = async () => {
  if (store.zoomFactor != 1) {
    const zoom = document.getElementById('zoom');
    const {right, bottom} = zoom.getBoundingClientRect();
    ipcRenderer.send(`show-zoom-dialog-${store.windowId}`, right, bottom);
  }
};

const onStarClick = (e: React.MouseEvent<HTMLDivElement>) => {
  showAddBookmarkDialog();
};
const onStarHover = () => {
  ipcRenderer.send(`preload-dialog-on-hover-${store.windowId}`, 'add-bookmark');
};
const onBlockClick = async (e: React.MouseEvent<HTMLDivElement>) => {
  const btn = document.getElementById('blocker-btn');
  const {right, bottom} = btn.getBoundingClientRect();
  const {selectedTab} = store.tabs;
  let blockedAds = [];
  let count = 0;
  let domain = '';
  if (selectedTab) {
    blockedAds = selectedTab.blockedAds;
    count = selectedTab.filtersCount;
    try {
      domain = parse(selectedTab.url).hostname || '';
    } catch (err) {
      domain = '';
    }
  }
  if (blockedAds && blockedAds.length) {
    console.log(blockedAds[0].request, blockedAds[0].result);
  }
  let siteEnabled = true;
  if (domain) {
    const whitelisted = await ipcRenderer.invoke('is-site-whitelisted', domain);
    siteEnabled = !whitelisted;
  }
  ipcRenderer.send(`show-block-dialog-${store.windowId}`, right, bottom, {
    data: blockedAds.map(it => ({
      url: it.request,
      filter: it.result
    })), count, domain, siteEnabled
  });
};
const onBlockHover = () => {
  ipcRenderer.send(`preload-dialog-on-hover-${store.windowId}`, 'show-block');
};
const onVideoContextClick = (e: React.MouseEvent<HTMLDivElement>) => {
  const menu = remote.Menu.buildFromTemplate([
    {
      label: '全屏播放',
      click: () => {
        const {selectedTab} = store.tabs;
        if (selectedTab) {
          ipcRenderer.send(`show-full-video-dialog-${selectedTab.id}`);
        }
      },
    },
    {
      label: '悬浮播放',
      click: () => {
        const {selectedTab} = store.tabs;
        if (selectedTab) {
          ipcRenderer.send(`show-float-video-dialog-${selectedTab.id}`);
        }
      },
    },
  ]);

  menu.popup();
};
// 当视频被点击时触发的函数：打开智能播放器独立窗口
const onVideoClick = (e: React.MouseEvent<HTMLDivElement>) => {
  // 发送名为 `show-media-player-${store.windowId}` 的事件，打开屏幕中央的播放器窗口
  ipcRenderer.send(`show-media-player-${store.windowId}`);
};


const onZoomClick = (e: React.MouseEvent<HTMLDivElement>) => {
  showZoomDialog();
};

const onKeyClick = () => {
  ipcRenderer.send(`check-form-autofill-${store.windowId}`);
};

// 翻译图标点击:未翻译则主进程自动开启翻译,并打开语言选择弹窗。
// (主进程 translate-open 同时负责 startTranslation,并把 active/target 传给弹窗。)
const onTranslateClick = () => {
  const btn = document.getElementById('translate-btn');
  if (!btn) return;
  const {right, bottom} = btn.getBoundingClientRect();
  ipcRenderer.send(`translate-open-${store.windowId}`, right, bottom);
};

// PWA 安装图标点击:打开安装确认弹窗(主进程下发 manifest 快照 + 图标 + 发布者)。
const onPwaClick = () => {
  const btn = document.getElementById('pwa-btn');
  if (!btn) return;
  const {right, bottom} = btn.getBoundingClientRect();
  ipcRenderer.send(`pwa-install-open-${store.windowId}`, right, bottom);
};

// 当前页是否在"手动开启过翻译"的站点列表中(取可注册域名比对)。
// 命中则地址栏始终显示翻译图标,即便未被检测为外语页。
const isAutoTranslateSite = (url: string) => {
  try {
    const host = parse(url || '').hostname || '';
    if (!host) return false;
    const parts = host.split('.');
    const domain = parts.length >= 2 ? parts.slice(-2).join('.') : host;
    const list = store.settings.object.autoTranslateSites || [];
    return list.includes(domain);
  } catch (e) {
    return false;
  }
};

ipcRenderer.on('show-add-bookmark-dialog', () => {
  showAddBookmarkDialog();
});

ipcRenderer.on('show-zoom-dialog', () => {
  showZoomDialog();
});

ipcRenderer.on('zoom-factor-updated', (e, zoomFactor, showDialog) => {
  store.zoomFactor = zoomFactor;
  if (!store.dialogsVisibility['zoom'] && showDialog) {
    showZoomDialog();
  }
});

const onShieldContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
  const menu = remote.Menu.buildFromTemplate([
    {
      checked: store.settings.object.shield,
      label: '启用广告拦截',
      type: 'checkbox',
      click: () => {
        store.settings.object.shield = !store.settings.object.shield;
        store.settings.save();
      },
    },
  ]);

  menu.popup();
};

// 点击"有新版本"胶囊, 打开更新弹窗
const onUpdatePillClick = (e: React.MouseEvent<HTMLDivElement>) => {
  const {right, bottom} = e.currentTarget.getBoundingClientRect();
  ipcRenderer.send(`show-update-dialog-${store.windowId}`, right, bottom);
};

// "新标签页搜索"气泡:复用地址栏搜索框, 但搜索结果在新标签页打开。
// 以地址栏的左边界/宽度定位搜索弹窗(与点地址栏时一致), 并透传 openInNewTab 标志。
const openCompactNewTabSearch = () => {
  const {selectedTab} = store.tabs;
  const input = store.inputRef;
  const text = store.addressbarValue || '';

  store.addressbarOpenInNewTab = true;
  store.addressbarShowSuggestionsOnFocus = true;
  store.addressbarTextVisible = false;
  store.addressbarFocused = true;
  store.addressbarEditing = false;
  store.mouseUpped = false;

  if (selectedTab) {
    selectedTab.addressbarFocused = true;
  }

  if (!input) return false;

  // 输入框已在焦点上时,onFocus 不会再次触发,这里直接沿用紧凑地址栏的联想弹窗。
  if (document.activeElement === input) {
    const anchor = getAddressBarSearchAnchor();
    if (!anchor) return false;
    input.focus();
    input.select();
    ipcRenderer.send(`search-show-${store.windowId}`, {
      text,
      cursorPos: text.length,
      selectAll: true,
      ...anchor,
      openInNewTab: true,
    });
    store.addressbarEditing = true;
    return true;
  }

  requestAnimationFrame(() => {
    if (!store.inputRef) return;
    store.inputRef.focus();
    store.inputRef.select();
  });

  return true;
};

const onSearchNewTabClick = (e: React.MouseEvent<HTMLDivElement>) => {
  e.preventDefault();
  e.stopPropagation();

  if (store.isCompact && openCompactNewTabSearch()) {
    return;
  }

  const anchor = getAddressBarSearchAnchor();
  if (!anchor) return;
  const text = store.addressbarValue || '';
  ipcRenderer.send(`search-show-${store.windowId}`, {
    text,
    cursorPos: text.length,
    selectAll: true,
    ...anchor,
    openInNewTab: true,
  });
};

export const SiteButtons = observer(() => {
  const [searchIconOnly, setSearchIconOnly] = React.useState(false);
  const searchPillRef = React.useRef<HTMLDivElement>(null);
  const expandedSearchPillWidth = React.useRef(0);
  const {selectedTab} = store.tabs;
  const lightToolbar = store.theme['toolbar.lightForeground'];
  const defaultIconColor = lightToolbar ? '#fff' : 'rgb(38, 43, 51)';
  const mutedIconColor = lightToolbar
    ? 'rgba(255, 255, 255, 0.68)'
    : 'rgb(149, 152, 154)';

  let hasCredentials = false;
  let blockedAds = [];
  let videoUrls = [];
  let siteWhitelisted = false;

  if (selectedTab) {
    hasCredentials = selectedTab.hasCredentials;
    blockedAds = selectedTab.blockedAds;
    videoUrls = selectedTab.videoUrls;
    siteWhitelisted = selectedTab.siteWhitelisted;
  }

  const dense = !store.isCompact;

  React.useLayoutEffect(() => {
    const pill = searchPillRef.current;
    const addressbar = pill?.closest('#addressbar') as HTMLElement | null;
    const input = addressbar?.querySelector(
      '[data-addressbar-input]',
    ) as HTMLElement | null;

    // 紧凑模式下 SiteButtons 位于地址栏外，保持完整胶囊样式。
    if (!pill || !addressbar || !input) {
      setSearchIconOnly(false);
      return;
    }

    const getOuterWidth = (element: HTMLElement) => {
      const style = window.getComputedStyle(element);
      return (
        element.getBoundingClientRect().width +
        parseFloat(style.marginLeft || '0') +
        parseFloat(style.marginRight || '0')
      );
    };

    const updateSearchPill = () => {
      const currentPillWidth = getOuterWidth(pill);
      if (!searchIconOnly) {
        expandedSearchPillWidth.current = currentPillWidth;
      }

      const fullPillWidth =
        expandedSearchPillWidth.current || currentPillWidth;
      const widthReturnedByIconMode = Math.max(
        0,
        fullPillWidth - currentPillWidth,
      );
      const inputWidthWithFullPill =
        input.getBoundingClientRect().width - widthReturnedByIconMode;

      setSearchIconOnly(
        inputWidthWithFullPill < MIN_ADDRESSBAR_INPUT_WIDTH,
      );
    };

    const resizeObserver = new ResizeObserver(updateSearchPill);
    resizeObserver.observe(addressbar);
    resizeObserver.observe(input);
    updateSearchPill();

    return () => resizeObserver.disconnect();
  }, [searchIconOnly]);

  // 自定义工具栏隐藏的地址栏内图标(star/shield/translate/video)。
  const hidden = store.settings.toolbarLayout.hidden;

  // 盾牌图标三态：
  // - 白名单(本站已暂停拦截): 灰色 ShieldSlash
  // - 有拦截: 绿色 ShieldCheck
  // - 无拦截: 黑色 ShieldChevron
  const shieldActive = store.settings.object.shield;
  let shieldIcon: React.ComponentType<any> = ShieldChevronIcon;
  let shieldColor = defaultIconColor;
  if (!shieldActive || siteWhitelisted) {
    shieldIcon = ShieldSlashIcon;
    shieldColor = mutedIconColor;
  } else if (blockedAds.length > 0) {
    shieldIcon = ShieldCheckIcon;
    shieldColor = 'rgb(40, 163, 122)'; // 绿色
  }

  return (
    <>
      <NewTabSearchPill
        className="addressbar-action addressbar-action--new-tab-search"
        ref={searchPillRef}
        $iconOnly={searchIconOnly}
        title="在新标签页中搜索"
        onMouseDown={onSearchNewTabClick}
      >
        <ArrowSquareOut size={12} weight="bold" />
        <span>新标签搜索</span>
      </NewTabSearchPill>
      {store.updateAvailable && (
        <UpdatePill
          id="update-pill"
          className="addressbar-action addressbar-action--update"
          onClick={onUpdatePillClick}
        >
          {`有新版本 ${store.updateVersion || ''}`.trim()}
        </UpdatePill>
      )}
      {process.env.ENABLE_AUTOFILL && hasCredentials && (
        <ToolbarButton
          className="addressbar-action addressbar-action--autofill"
          dense={dense}
          icon={ICON_KEY}
          size={16}
          onClick={onKeyClick}
        />
      )}
      {(store.dialogsVisibility['zoom'] || store.zoomFactor !== 1) && (
        <ToolbarButton
          className="addressbar-action addressbar-action--zoom"
          id="zoom"
          toggled={store.dialogsVisibility['zoom']}
          icon={store.zoomFactor >= 1 ? ICON_MAGNIFY_PLUS : ICON_MAGNIFY_MINUS}
          size={18}
          dense={dense}
          onMouseDown={onZoomClick}
        />
      )}
      {selectedTab &&
        !hidden.includes('translate') &&
        (selectedTab.canTranslate ||
          selectedTab.translated ||
          isAutoTranslateSite(selectedTab.url)) && (
        <ToolbarButton
          className="addressbar-action addressbar-action--translate"
          id="translate-btn"
          toggled={!!selectedTab?.translated}
          icon={Translate}
          iconColor={selectedTab?.translated ? '#3b6fe8' : defaultIconColor}
          iconWeight="bold"
          size={18}
          dense={dense}
          opacity={0.87}
          autoInvert={false}
          onMouseDown={onTranslateClick}
          title={
            selectedTab?.translated
              ? `已翻译为 ${selectedTab.translateTarget?.toUpperCase()}（点击切换语言 / 显示原文）`
              : selectedTab?.detectedLanguage
                ? `翻译此页（检测：${selectedTab.detectedLanguage.toUpperCase()}）`
                : '翻译此页'
          }
        />
      )}
      {selectedTab?.canInstallPwa && (
        <ToolbarButton
          className="addressbar-action addressbar-action--pwa"
          id="pwa-btn"
          icon={PwaSiteIcon}
          size={18}
          dense={dense}
          autoInvert={false}
          onMouseDown={onPwaClick}
          title={
            selectedTab?.pwaInstalled
              ? `已安装应用${
                  selectedTab?.pwaManifest?.name
                    ? ` · ${selectedTab.pwaManifest.name}`
                    : ''
                }（点击重新打开）`
              : selectedTab?.pwaManifest?.name
                ? `安装应用 · ${selectedTab.pwaManifest.name}`
                : '安装此应用'
          }
        />
      )}
      {!hidden.includes('star') && (
        <ToolbarButton
          className="addressbar-action addressbar-action--star"
          id="star"
          toggled={store.dialogsVisibility['add-bookmark']}
          icon={store.isBookmarked ? ICON_STAR_FILLED : ICON_STAR}
          size={18}
          dense={dense}
          onMouseDown={onStarClick}
          onMouseEnter={onStarHover}
        />
      )}
      {shieldActive && !hidden.includes('shield') && (
        <ToolbarButton
          className="addressbar-action addressbar-action--shield"
          id="blocker-btn"
          size={18}
          divRef={(ref) => (store.adblockBtnRef = ref)}
          badge={!siteWhitelisted && blockedAds.length > 0}
          badgeText={blockedAds.length.toString()}
          icon={shieldIcon}
          iconColor={shieldColor}
          iconWeight="bold"
          opacity={0.87}
          autoInvert={false}
          onContextMenu={onShieldContextMenu}
          onClick={onBlockClick}
          onMouseEnter={onBlockHover}
        />
      )}
      {videoUrls.length > 0 && !hidden.includes('video') && (
        <ToolbarButton
          className="addressbar-action addressbar-action--video"
          id="video-btn"
          size={16}
          badge={videoUrls.length > 0}
          badgeText={videoUrls.length.toString()}
          icon={ICON_VIDEO}
          opacity={0.87}
          onClick={onVideoClick}
          onContextMenu={onVideoContextClick}
        />
      )}
    </>
  );
});
