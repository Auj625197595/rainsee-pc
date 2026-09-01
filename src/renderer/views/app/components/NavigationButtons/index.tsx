import { observer } from 'mobx-react-lite';
import * as React from 'react';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowClockwiseIcon,
  XIcon,
} from '@phosphor-icons/react';

import { StyledContainer } from './style';
import store from '../../store';
import { ToolbarButton } from '../ToolbarButton';
import { useActionBubble } from '../../utils/action-bubble';
import { getShellTranslator } from '../../utils/i18n';
import {
  renderClusterButton,
  showToolbarContextMenu,
} from '../Toolbar/ClusterButtons';

const onBackClick = () => {
  store.tabs.selectedTab.callViewMethod('goBack');
};

const onForwardClick = () => {
  store.tabs.selectedTab.callViewMethod('goForward');
};

const onRefreshClick = () => {
  if (store.tabs.selectedTab && store.tabs.selectedTab.loading) {
    store.tabs.selectedTab.callViewMethod('stop');
  } else {
    store.tabs.selectedTab.callViewMethod('reload');
  }
};

export const NavigationButtons = observer(() => {
  const t = getShellTranslator();
  const { selectedTab } = store.tabs;
  const iconColor = store.theme['toolbar.lightForeground']
    ? '#fff'
    : 'rgb(117 128 154)';

  let loading = false;

  if (selectedTab) {
    loading = selectedTab.loading;
  }

  const { show: showBubble, portal: bubblePortal } = useActionBubble();

  // 右键刷新/停止按钮 → 对当前窗口的全部标签页执行"刷新全部 / 停止全部",
  // 并在按钮右侧弹出气泡反馈。动作由按钮当前形态决定(与左键一致)。
  const onRefreshContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const tabs = store.tabs.list;
    if (loading) {
      // 停止全部:仅停止仍在加载的标签页。
      tabs.forEach((tab) => {
        if (tab.loading) {
          tab.callViewMethod('stop');
        }
      });
      showBubble(t('shellStopAll'), e.currentTarget);
    } else {
      // 刷新全部。
      tabs.forEach((tab) => tab.callViewMethod('reload'));
      showBubble(t('shellReloadAll'), e.currentTarget);
    }
  };

  // 地址栏左侧的可定制集群按钮(默认含「主页」),按用户排序、跳过隐藏项渲染。
  const layout = store.settings.toolbarLayout;
  const leftVisible = layout.left.filter((id) => !layout.hidden.includes(id));

  return (
    <StyledContainer
      data-rainsee-part="navigation-buttons"
      onContextMenu={showToolbarContextMenu}
    >
      <ToolbarButton
        rainseeAction="back"
        disabled={!store.navigationState.canGoBack}
        size={20}
        icon={ArrowLeftIcon}
        iconColor={iconColor}
        iconWeight="bold"
        autoInvert={false}
        style={{ marginLeft: 6 }}
        onClick={onBackClick}
      />
      <ToolbarButton
        rainseeAction="forward"
        disabled={!store.navigationState.canGoForward}
        size={20}
        icon={ArrowRightIcon}
        iconColor={iconColor}
        iconWeight="bold"
        autoInvert={false}
        onClick={onForwardClick}
      />
      <ToolbarButton
        rainseeAction="reload"
        size={20}
        icon={loading ? XIcon : ArrowClockwiseIcon}
        iconColor={iconColor}
        iconWeight="bold"
        autoInvert={false}
        onClick={onRefreshClick}
        onContextMenu={onRefreshContextMenu}
      />
      {leftVisible.map((id) => (
        <React.Fragment key={id}>{renderClusterButton(id)}</React.Fragment>
      ))}
      {bubblePortal}
    </StyledContainer>
  );
});
