import { observer } from 'mobx-react-lite';
import * as React from 'react';

import { Preloader } from '~/renderer/components/Preloader';
import { useI18n } from '~/renderer/components/I18n';
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
import { handleTabContextMenu } from '../../utils/tab-context-menu';
import { getIconByUrlNet } from '~/utils/url';
import { animateTab } from '../../utils/tabs';
import { TAB_MIN_WIDTH, TAB_PINNED_WIDTH } from '../../constants';
import { useTabHoverActivation } from '~/renderer/utils/tab-hover-activation';

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

const onMouseDown = (tab: ITab, cancel: () => void) => (
  e: React.MouseEvent<HTMLDivElement>,
) => {
  cancel();
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

const onMouseEnter = (tab: ITab, schedule: () => void) => (
  e: React.MouseEvent<HTMLDivElement>,
) => {
  if (!store.tabs.isDragging) {
    store.tabs.hoveredTabId = tab.id;
    schedule();
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

const onMouseLeave = (cancel: () => void) => () => {
  cancel();
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

const getTabDensity = (tab: ITab) => {
  if (store.settings.object.tabOverflowBehavior !== 'shrink') return 1;
  const preferredWidth = tab.isPinned ? TAB_PINNED_WIDTH : TAB_MIN_WIDTH;
  return Math.max(0, Math.min(1, tab.width / preferredWidth));
};

const Content = observer(({ tab }: { tab: ITab }) => {
  const t = useI18n();
  const density = getTabDensity(tab);
  // 图标源优先级:本地 favicon(data URL)→ getIconByUrlNet 网络兜底(与书签栏一致)
  // → 地球图标。任一来源解码失败后尝试下一级;tab.url 切换时同步重置失败列表
  // (render 内 setState 是 React
  // 官方推荐的"基于 props/前次渲染派生 state"模式,有条件触发不会循环)。
  const [failedIconSources, setFailedIconSources] = React.useState<string[]>(
    [],
  );
  const prevUrlRef = React.useRef(tab.url);
  if (prevUrlRef.current !== tab.url) {
    setFailedIconSources([]);
    prevUrlRef.current = tab.url;
  }

  const fallbackIconSrc = tab.url ? getIconByUrlNet(tab.url) : undefined;
  const iconSrc = [tab.favicon, fallbackIconSrc].find(
    (src) => src && !failedIconSources.includes(src),
  );

  return (
    <StyledContent $density={density} data-rainsee-part="tab-content">
      {tab.incognito && <StyledIncognitoIcon $density={density} />}
      {!tab.loading && iconSrc && (
        <StyledIcon data-rainsee-part="tab-icon" isIconSet={!!iconSrc}>
          <img
            src={iconSrc}
            width={16}
            height={16}
            draggable={false}
            style={{ display: 'block' }}
            onError={() => {
              setFailedIconSources((sources) =>
                sources.includes(iconSrc) ? sources : [...sources, iconSrc],
              );
            }}
          />
          <PinnedVolume tab={tab} />
        </StyledIcon>
      )}

      {!tab.loading && !iconSrc && !tab.isPinned && (
        <StyledIcon data-rainsee-part="tab-icon" isIconSet>
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
          data-rainsee-part="tab-title"
          isIcon={tab.isIconSet}
          selected={tab.isSelected}
          $density={density}
          incognito={tab.incognito}
        >
          {tab.isSelected && store.isCompact
            ? tab.url
            : tab.title === '新标签页'
            ? t('newTab')
            : tab.title}
        </StyledTitle>
      )}
      <ExpandedVolume tab={tab} density={density} />
      <Close tab={tab} density={density} />
    </StyledContent>
  );
});

const ExpandedVolume = observer(
  ({tab, density}: {tab: ITab; density: number}) => {
    return (
      <StyledAction
        data-rainsee-part="tab-audio"
        $density={density}
        onMouseDown={onVolumeMouseDown}
        onClick={toggleMuteTab(tab)}
        visible={tab.isExpanded && !tab.isPinned && tab.isPlaying}
        icon={tab.isMuted ? ICON_VOLUME_OFF : ICON_VOLUME_HIGH}
      />
    );
  },
);

const PinnedVolume = observer(({ tab }: { tab: ITab }) => {
  return (
    <StyledPinAction
      data-rainsee-part="tab-audio"
      onMouseDown={onVolumeMouseDown}
      onClick={toggleMuteTab(tab)}
      visible={tab.isPinned && tab.isPlaying}
      icon={tab.isMuted ? ICON_VOLUME_OFF : ICON_VOLUME_HIGH}
    />
  );
});

const Close = observer(({tab, density}: {tab: ITab; density: number}) => {
  const display = store.settings.object.tabCloseButtonDisplay;

  return (
    <StyledClose
      data-rainsee-part="tab-close"
      data-rainsee-action="close-tab"
      onMouseDown={onCloseMouseDown}
      onClick={removeTab(tab)}
      // hover 模式不能依赖 isExpanded：滚动/压缩标签栏中它可能为 false，
      // 会让按钮被 display:none 移除，父标签的 :hover 规则无法再展开它。
      visible={
        !tab.isPinned &&
        display !== 'never' &&
        (display === 'hover' || tab.isExpanded)
      }
      hoverOnly={display === 'hover'}
      $density={density}
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
  const hoverActivation = useTabHoverActivation({
    enabled:
      store.settings.object.tabHoverActivationBehavior !== 'off' &&
      (tab.discarded ||
        store.settings.object.tabHoverActivationBehavior ===
          'activate-and-switch'),
    delay: store.settings.object.tabHoverActivationDelay,
    selected: tab.isSelected,
    activate: () =>
      tab.activateOnHover(
        store.settings.object.tabHoverActivationBehavior ===
          'activate-and-switch',
      ),
    blocked: () => store.tabs.isDragging,
  });

  const lightFg = store.theme['toolbar.lightForeground'];

  // Chrome 卡片式:未选中标签透明融入工具栏,仅悬停时给一层淡底;
  // 选中标签用实色卡片(白/深灰)配合阴影明显突出。
  const hoverColor = lightFg
    ? 'rgba(255, 255, 255, 0.08)'
    : 'rgba(20, 32, 72, 0.06)';

  const defaultColor = tab.isHovered
    ? hoverColor
    : store.theme['tab.backgroundColor'] || 'transparent';

  const defaultSelectedColor =
    store.theme['tab.selected.backgroundColor'] ||
    (lightFg ? '#393939' : '#FFFFFF');

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

  const density = getTabDensity(tab);

  return (
    <StyledTab
      data-rainsee-part="tab"
      data-rainsee-selected={tab.isSelected ? 'true' : 'false'}
      data-rainsee-pinned={tab.isPinned ? 'true' : 'false'}
      selected={tab.isSelected}
      onMouseDown={onMouseDown(tab, hoverActivation.cancel)}
      onMouseUp={onMouseUp(tab)}
      onMouseEnter={onMouseEnter(tab, hoverActivation.schedule)}
      onContextMenu={(e: React.MouseEvent) => handleTabContextMenu(e, tab)}
      onClick={onClick(tab)}
      onDoubleClick={onDoubleClick(tab)}
      onMouseLeave={onMouseLeave(hoverActivation.cancel)}
      ref={tab.ref}
    >
      <TabContainer
        data-rainsee-part="tab-surface"
        hasTabGroup={tab.tabGroupId !== -1}
        pinned={tab.isPinned}
        selected={tab.isSelected}
        incognito={tab.incognito}
        $density={density}
        style={{ backgroundColor }}
      >
        <Content tab={tab} />
      </TabContainer>
    </StyledTab>
  );
});
