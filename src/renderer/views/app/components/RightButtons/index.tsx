import {observer} from 'mobx-react-lite';
import * as React from 'react';
import {ToolbarButton} from '../ToolbarButton';
import {BrowserAction} from '../BrowserAction';
import {ICON_INCOGNITO} from '~/renderer/constants/icons';
import {Buttons, Separator} from './style';
import store from '../../store';
import {SiteButtons} from '../SiteButtons';
import {
  renderClusterButton,
  MenuButton,
  showToolbarContextMenu,
} from '../Toolbar/ClusterButtons';

const BrowserActions = observer(() => {
  const {selectedTabId} = store.tabs;
  const visible = store.extensions.visibleExtensionIds;

  return (
    <>
      {selectedTabId &&
        store.extensions.browserActions.map((item) => {
          if (
            item.tabId === selectedTabId &&
            visible.includes(item.extensionId)
          ) {
            return <BrowserAction data={item} key={item.extensionId}/>;
          }
          return null;
        })}
    </>
  );
});

export const RightButtons = observer(() => {
  // 地址栏右侧的可定制集群按钮(默认顺序 扩展→下载→订阅→雨见AI),按用户排序、
  // 跳过隐藏项渲染。菜单(3-dot)固定在最末,不在可定制列表内。
  const layout = store.settings.toolbarLayout;
  const rightVisible = layout.right.filter((id) => !layout.hidden.includes(id));
  const extensionsEntryVisible = rightVisible.includes('extensions');

  return (
    <>
      <Buttons onContextMenu={showToolbarContextMenu}>
        {store.isCompact && (
          <>
            <Separator/>
            <SiteButtons/>
          </>
        )}
        {!extensionsEntryVisible && <BrowserActions/>}
        {rightVisible.map((id) => (
          <React.Fragment key={id}>
            {id === 'extensions' && <BrowserActions/>}
            {renderClusterButton(id)}
          </React.Fragment>
        ))}
        {store.isIncognito && (
          <span title="无痕模式">
            <ToolbarButton icon={ICON_INCOGNITO} size={18} autoInvert />
          </span>
        )}
        <MenuButton/>
      </Buttons>
    </>
  );
});
