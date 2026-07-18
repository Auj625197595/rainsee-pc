import * as React from 'react';
import { observer } from 'mobx-react-lite';

import Tab from '../Tab';
import store from '../../store';

export const Tabs = observer(() => {
  return (
    <React.Fragment>
      {/* 组内标签不再作为独立 slot 渲染——它们由所在组的芯片 favicon 行表示。
          固定标签与未分组标签(含关闭动画中的)在此渲染。 */}
      {store.tabs.list
        .filter((tab) => tab.isPinned || tab.tabGroupId === -1)
        .map((item) => (
          <Tab key={item.viewKey} tab={item} />
        ))}
    </React.Fragment>
  );
});
