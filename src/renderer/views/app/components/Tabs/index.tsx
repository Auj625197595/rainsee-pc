import * as React from 'react';
import { observer } from 'mobx-react-lite';

import Tab from '../Tab';
import store from '../../store';
import { isImmersiveHeaderWindow } from '../../utils/windows';

export const Tabs = observer(() => {
  return (
    <React.Fragment>
      {/* 组内标签不再作为独立 slot 渲染——它们由所在组的芯片 favicon 行表示。
          固定标签与未分组标签(含关闭动画中的)在此渲染。 */}
      {store.tabs.list
        .filter(
          (tab) =>
            // 数据库跨文件写入中断时，tabGroupId 可能暂时找不到对应组。
            // getSlots 会把它当普通 tab slot；这里必须采用同一判定，否则布局
            // 占位而 DOM 被过滤，最终在标签栏留下整块空白。
            (tab.isPinned || tab.tabGroupId === -1 || !tab.tabGroup) &&
            (!isImmersiveHeaderWindow() || !tab.isClosing),
        )
        .map((item) => (
          <Tab key={item.viewKey} tab={item} />
        ))}
    </React.Fragment>
  );
});
