import { observer } from 'mobx-react-lite';
import * as React from 'react';

import { StyledToolbar } from './style';
import { NavigationButtons } from '../NavigationButtons';

import { AddressBar } from '../AddressBar';
import { RightButtons } from '../RightButtons';
import { WindowControls } from '../WindowControls';
import store from '../../store';

export const Toolbar = observer(() => {
  return (
    <StyledToolbar>
      <NavigationButtons />
      <AddressBar />
      <RightButtons />
      {/* 侧栏模式下没有 Titlebar,窗口控制按钮(最小化/最大化/关闭)改挂到工具栏右端,
          即窗口右上角;顶部模式由 Titlebar 负责渲染,这里不重复。 */}
      {store.isSidebar && <WindowControls />}
    </StyledToolbar>
  );
});
