import {observer} from 'mobx-react-lite';
import * as React from 'react';
import {TOOLBAR_BUTTON_WIDTH} from '~/constants/design';
import {ToolbarButton} from '../ToolbarButton';
import {BrowserAction} from '../BrowserAction';
import {ICON_INCOGNITO} from '~/renderer/constants/icons';
import {
  Buttons,
  ExtensionActions,
  OTHER_BUTTONS_COMPACT_WIDTH,
  Separator,
} from './style';
import store from '../../store';
import { getShellTranslator } from '../../utils/i18n';
import {SiteButtons} from '../SiteButtons';
import {useDragReorder} from '~/renderer/utils/use-drag-reorder';
import {
  renderClusterButton,
  MenuButton,
  showToolbarContextMenu,
} from '../Toolbar/ClusterButtons';

const TOOLBAR_BUTTON_SLOT_WIDTH = TOOLBAR_BUTTON_WIDTH + 2;
const COMPACT_TABBAR_MIN_WIDTH = 120;

const outerWidth = (element: HTMLElement) => {
  const style = getComputedStyle(element);
  return (
    element.getBoundingClientRect().width +
    parseFloat(style.marginLeft || '0') +
    parseFloat(style.marginRight || '0')
  );
};

const minimumOuterWidth = (element: HTMLElement) => {
  const style = getComputedStyle(element);
  const margin =
    parseFloat(style.marginLeft || '0') +
    parseFloat(style.marginRight || '0');

  if (element.dataset.rainseePart === 'tab-bar') {
    return COMPACT_TABBAR_MIN_WIDTH + margin;
  }

  const minWidth = parseFloat(style.minWidth || '0');
  const boxExtras =
    style.boxSizing === 'border-box'
      ? 0
      : parseFloat(style.paddingLeft || '0') +
        parseFloat(style.paddingRight || '0') +
        parseFloat(style.borderLeftWidth || '0') +
        parseFloat(style.borderRightWidth || '0');
  return minWidth + boxExtras + margin;
};

const useVisibleExtensionCount = (total: number) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = React.useState(total);

  React.useLayoutEffect(() => {
    const extensionContainer = containerRef.current;
    const buttons = extensionContainer?.parentElement;
    const host = buttons?.parentElement;
    if (!extensionContainer || !buttons || !host) return;

    let animationFrame = 0;
    const update = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const hostStyle = getComputedStyle(host);
        const hostContentWidth =
          host.clientWidth -
          parseFloat(hostStyle.paddingLeft || '0') -
          parseFloat(hostStyle.paddingRight || '0');
        const fixedButtonsWidth =
          outerWidth(buttons) - outerWidth(extensionContainer);

        const siblingWidth = Array.from(host.children).reduce(
          (width, child) => {
            if (child === buttons || !(child instanceof HTMLElement)) {
              return width;
            }
            const part = child.dataset.rainseePart;
            if (part === 'address-bar' || part === 'tab-bar') {
              return width + minimumOuterWidth(child);
            }
            return width + outerWidth(child);
          },
          0,
        );

        const availableWidth = Math.max(
          0,
          hostContentWidth - siblingWidth - fixedButtonsWidth,
        );
        const firstAction = extensionContainer.firstElementChild;
        const actionWidth =
          firstAction instanceof HTMLElement
            ? outerWidth(firstAction)
            : TOOLBAR_BUTTON_SLOT_WIDTH;
        const extensionLimitBeforeOtherButtons = Math.max(
          0,
          Math.floor(
            (host.clientWidth - OTHER_BUTTONS_COMPACT_WIDTH) /
              TOOLBAR_BUTTON_SLOT_WIDTH,
          ),
        );
        const nextCount = Math.min(
          total,
          extensionLimitBeforeOtherButtons,
          Math.floor(
            (availableWidth + 0.5) /
              Math.max(actionWidth, TOOLBAR_BUTTON_SLOT_WIDTH),
          ),
        );
        setVisibleCount((current) =>
          current === nextCount ? current : nextCount,
        );
      });
    };

    update();
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(host);
    resizeObserver.observe(buttons);

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, [total]);

  return {containerRef, visibleCount};
};

export const RightButtons = observer(() => {
  // 地址栏右侧的可定制集群按钮(默认顺序 扩展→下载→订阅→雨见AI),按用户排序、
  // 跳过隐藏项渲染。菜单(3-dot)固定在最末,不在可定制列表内。
  const t = getShellTranslator();
  const layout = store.settings.toolbarLayout;
  const rightVisible = layout.right.filter((id) =>
    id === 'downloads'
      ? layout.downloadVisibility !== 'hidden'
      : !layout.hidden.includes(id),
  );
  const extensionsEntryVisible = rightVisible.includes('extensions');
  const selectedTabId = store.tabs.selectedTabId;
  const visibleIds = store.extensions.visibleExtensionIds;
  // 按统一顺序(visibleExtensionIds 已排序)展示,而非 browserActions 的加载顺序。
  const extensionActions = selectedTabId
    ? visibleIds
        .map((id) =>
          store.extensions.browserActions.find(
            (item) => item.tabId === selectedTabId && item.extensionId === id,
          ),
        )
        .filter(Boolean)
    : [];
  const {containerRef, visibleCount} = useVisibleExtensionCount(
    extensionActions.length,
  );
  const shownActions = extensionActions.slice(0, visibleCount);
  // 按住图标左右拖动调整顺序,写回与全部扩展列表共用的 extensionOrder。
  const reorder = useDragReorder<HTMLDivElement>({
    axis: 'x',
    ids: shownActions.map((item) => item.extensionId),
    attr: 'data-rainsee-extension-id',
    onMove: (from, to, after) =>
      store.extensions.moveExtension(from, to, after),
  });
  const setContainerRef = React.useCallback(
    (el: HTMLDivElement) => {
      (containerRef as React.MutableRefObject<HTMLDivElement>).current = el;
      (reorder.containerRef as React.MutableRefObject<HTMLDivElement>).current = el;
    },
    [containerRef, reorder.containerRef],
  );
  const browserActions = (
    <ExtensionActions ref={setContainerRef} onMouseDown={reorder.onMouseDown}>
      {reorder.previewIds.map((id) => {
        const item = shownActions.find((x) => x.extensionId === id);
        if (!item) return null;
        return (
          <BrowserAction
            data={item}
            key={item.extensionId}
            dragging={reorder.draggingId === id}
          />
        );
      })}
    </ExtensionActions>
  );

  return (
    <>
      <Buttons
        data-rainsee-part="right-buttons"
        onContextMenu={showToolbarContextMenu}
      >
        {store.isCompact && (
          <>
            <Separator/>
            <SiteButtons/>
          </>
        )}
        {!extensionsEntryVisible && browserActions}
        {rightVisible.map((id) => (
          <React.Fragment key={id}>
            {id === 'extensions' && browserActions}
            {renderClusterButton(id)}
          </React.Fragment>
        ))}
        {store.isIncognito && (
          <span title={t('shellIncognito')}>
            <ToolbarButton
              rainseeAction="incognito"
              icon={ICON_INCOGNITO}
              size={18}
              autoInvert
            />
          </span>
        )}
        <MenuButton/>
      </Buttons>
    </>
  );
});
