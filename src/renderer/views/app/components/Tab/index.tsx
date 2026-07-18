import { observer } from 'mobx-react-lite';
import * as React from 'react';

import { Preloader } from '~/renderer/components/Preloader';
import {
  StyledTab,
  StyledContent,
  StyledIcon,
  StyledTitle,
  StyledClose,
  StyledAction,
  StyledPinAction,
  StyledIncognitoIcon,
  TabContainer,
} from './style';
import { ICON_VOLUME_HIGH, ICON_VOLUME_OFF } from '~/renderer/constants';
import { ITab } from '../../models';
import store from '../../store';
import { ipcRenderer } from 'electron';
import { COMPACT_TAB_MARGIN_TOP } from '~/constants/design';
import { showTabContextMenu } from '../../utils/tab-context-menu';
import { getIconByUrlNet } from '~/utils/url';
import { animateTab } from '../../utils/tabs';

// 无法解析图标时的默认地球图标,与书签栏保持一致
const GlobeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="8.5" stroke="#5F6368" strokeWidth="1.6" />
    <path
      d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.4 3.5 8.5S14.3 18.1 12 20.5C9.7 18.1 8.5 15.1 8.5 12S9.7 5.9 12 3.5Z"
      stroke="#5F6368"
      strokeWidth="1.6"
    />
  </svg>
);

const removeTab = (tab: ITab) => (e: React.MouseEvent<HTMLDivElement>) => {
  e.stopPropagation();
  tab.close();
};

const toggleMuteTab = (tab: ITab) => (e: React.MouseEvent<HTMLDivElement>) => {
  e.stopPropagation();
  tab.isMuted ? store.tabs.unmuteTab(tab) : store.tabs.muteTab(tab);
};

const onCloseMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
  e.stopPropagation();
};

const onVolumeMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
  e.stopPropagation();
};

const onMouseDown = (tab: ITab) => (e: React.MouseEvent<HTMLDivElement>) => {
  const { pageX, button } = e;

  console.log("onMouseDown", store.addressbarEditing);
  if (store.addressbarEditing) {
    store.inputRef.focus();
  }

  if (button === 0) {
    if (!tab.isSelected) {
      tab.select();
    } else {
      store.canOpenSearch = true;
    }

    store.tabs.lastMouseX = 0;
    store.tabs.isDragging = true;
    store.tabs.mouseStartX = pageX;
    store.tabs.tabStartX = tab.left;

    store.tabs.lastScrollLeft = store.tabs.containerRef.current.scrollLeft;
  }

  ipcRenderer.send(`hide-tab-preview-${store.windowId}`);
};

const onMouseEnter = (tab: ITab) => (e: React.MouseEvent<HTMLDivElement>) => {
  if (!store.tabs.isDragging) {
    store.tabs.hoveredTabId = tab.id;
  }

  const { bottom, left } = tab.ref.current.getBoundingClientRect();

  const x = left + 8;
  const y = store.isCompact ? bottom - COMPACT_TAB_MARGIN_TOP : bottom;

  if (store.tabs.canShowPreview && !store.tabs.isDragging) {
    ipcRenderer.send(`show-tab-preview-${store.windowId}`, {
      id: tab.id,
      x,
      y,
    });
  }
};

const onMouseLeave = () => {
  store.tabs.hoveredTabId = -1;
  ipcRenderer.send(`hide-tab-preview-${store.windowId}`);
  store.tabs.canShowPreview = true;
};

const onClick = (tab: ITab) => (e: React.MouseEvent<HTMLDivElement>) => {
  if (e.button === 4) {
    tab.close();
    return;
  }

  if (store.isCompact && e.button === 0 && store.canOpenSearch) {
    store.inputRef.focus();
    store.canOpenSearch = false;
  }
};

const onMouseUp = (tab: ITab) => (e: React.MouseEvent<HTMLDivElement>) => {
  if (e.button === 1) {
    tab.close();
  }
};

const onDoubleClick = (tab: ITab) => (e: React.MouseEvent<HTMLDivElement>) => {
  if (store.settings.object.closeTabOnDoubleClick) {
    tab.close();
  }
};

const Content = observer(({ tab }: { tab: ITab }) => {
  // 图标源优先级:本地 favicon(data URL)→ getIconByUrlNet 网络兜底(与书签栏一致)
  // → 地球图标。网络图标加载失败(onError)置 iconFailed 回退地球;tab.url 切换时
  // 同步重置 iconFailed,避免新页沿用上一页的失败标记(render 内 setState 是 React
  // 官方推荐的"基于 props/前次渲染派生 state"模式,有条件触发不会循环)。
  const [iconFailed, setIconFailed] = React.useState(false);
  const prevUrlRef = React.useRef(tab.url);
  if (prevUrlRef.current !== tab.url) {
    setIconFailed(false);
    prevUrlRef.current = tab.url;
  }

  const iconSrc =
    tab.favicon ||
    (!iconFailed && tab.url ? getIconByUrlNet(tab.url) : undefined);

  return (
    <StyledContent>
      {tab.incognito && <StyledIncognitoIcon />}
      {!tab.loading && iconSrc && (
        <StyledIcon isIconSet={!!iconSrc}>
          <img
            src={iconSrc}
            width={16}
            height={16}
            draggable={false}
            style={{ display: 'block' }}
            onError={() => {
              // 仅网络兜底图标失败时回退;本地 data URL 几乎不会失败。
              if (!tab.favicon) setIconFailed(true);
            }}
          />
          <PinnedVolume tab={tab} />
        </StyledIcon>
      )}

      {!tab.loading && !iconSrc && !tab.isPinned && (
        <StyledIcon isIconSet>
          <GlobeIcon />
        </StyledIcon>
      )}

      {tab.loading && (
        <Preloader
          color={store.theme.accentColor}
          thickness={6}
          size={16}
          indeterminate
          style={{ minWidth: 16 }}
        />
      )}
      {!tab.isPinned && (
        <StyledTitle
          isIcon={tab.isIconSet}
          selected={tab.isSelected}
          incognito={tab.incognito}
        >
          {tab.isSelected && store.isCompact ? tab.url : tab.title}
        </StyledTitle>
      )}
      <ExpandedVolume tab={tab} />
      <Close tab={tab} />
    </StyledContent>
  );
});

const ExpandedVolume = observer(({ tab }: { tab: ITab }) => {
  return (
    <StyledAction
      onMouseDown={onVolumeMouseDown}
      onClick={toggleMuteTab(tab)}
      visible={tab.isExpanded && !tab.isPinned && tab.isPlaying}
      icon={tab.isMuted ? ICON_VOLUME_OFF : ICON_VOLUME_HIGH}
    />
  );
});

const PinnedVolume = observer(({ tab }: { tab: ITab }) => {
  return (
    <StyledPinAction
      onMouseDown={onVolumeMouseDown}
      onClick={toggleMuteTab(tab)}
      visible={tab.isPinned && tab.isPlaying}
      icon={tab.isMuted ? ICON_VOLUME_OFF : ICON_VOLUME_HIGH}
    />
  );
});

const Close = observer(({ tab }: { tab: ITab }) => {
  return (
    <StyledClose
      onMouseDown={onCloseMouseDown}
      onClick={removeTab(tab)}
      visible={tab.isExpanded && !tab.isPinned}
    />
  );
});

export default observer(({ tab }: { tab: ITab }) => {
  // 挂载即把模型当前的 width/left 落到 DOM(瞬时,无动画)。
  // 修复:侧栏→顶部栏切换时 <Tab> 重新挂载(DOM 回到 CSS 默认 width:0),而固定
  // 标签的模型 width 恰仍是 40 → 随后 setWidth(40,true) 因 model===value 短路、
  // 不写 DOM → 固定标签卡在 0 宽(新建标签不触发,仅 resize 的 animation=false
  // 路径才修)。挂载时强制 snap 绕过短路,任意重挂/重排路径都自愈。
  React.useLayoutEffect(() => {
    const el = tab.ref.current;
    if (!el) return;
    animateTab('width', tab.width, el, false);
    animateTab('translateX', tab.left, el, false);
  }, [tab]);

  const lightFg = store.theme['toolbar.lightForeground'];

  // Chrome 卡片式:未选中标签透明融入工具栏,仅悬停时给一层淡底;
  // 选中标签用实色卡片(白/深灰)配合阴影明显突出。
  const hoverColor = lightFg
    ? 'rgba(255, 255, 255, 0.08)'
    : 'rgba(20, 32, 72, 0.06)';

  const defaultColor = tab.isHovered ? hoverColor : 'transparent';

  const defaultSelectedColor = lightFg ? '#393939' : '#FFFFFF';

  const incognitoSelectedColor = '#3c4043';
  const incognitoColor = tab.isHovered
    ? 'rgba(255, 255, 255, 0.08)'
    : 'transparent';

  const backgroundColor = tab.incognito
    ? tab.isSelected
      ? incognitoSelectedColor
      : incognitoColor
    : tab.isSelected
    ? defaultSelectedColor
    : defaultColor;

  return (
    <StyledTab
      selected={tab.isSelected}
      onMouseDown={onMouseDown(tab)}
      onMouseUp={onMouseUp(tab)}
      onMouseEnter={onMouseEnter(tab)}
      onContextMenu={() => showTabContextMenu(tab)}
      onClick={onClick(tab)}
      onDoubleClick={onDoubleClick(tab)}
      onMouseLeave={onMouseLeave}
      ref={tab.ref}
    >
      <TabContainer
        hasTabGroup={tab.tabGroupId !== -1}
        pinned={tab.isPinned}
        selected={tab.isSelected}
        incognito={tab.incognito}
        style={{ backgroundColor }}
      >
        <Content tab={tab} />
      </TabContainer>
    </StyledTab>
  );
});
