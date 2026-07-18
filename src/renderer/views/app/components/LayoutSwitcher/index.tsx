import { observer } from 'mobx-react-lite';
import * as React from 'react';
import * as remote from '@electron/remote';

import { SwitcherButton } from './style';
import store from '../../store';
import { TabsLayout } from '~/interfaces';
import { getCurrentWindow } from '../../utils/windows';

interface Props {
  // visual variant: 'tab' sits at the end of the top tab strip,
  // 'bar' sits inside a toolbar/right-buttons group.
  variant?: 'tab' | 'bar';
}

const ICON_CONVERT = (
  <svg
    width="17"
    height="17"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.1"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M16 3l4 4-4 4"></path>
    <path d="M20 7H8"></path>
    <path d="M8 21l-4-4 4-4"></path>
    <path d="M4 17h12"></path>
  </svg>
);

const buildMenu = (current: TabsLayout) => {
  const item = (value: TabsLayout, label: string) => ({
    label,
    type: 'checkbox' as const,
    checked: current === value,
    click: () => store.settings.setTabsLayout(value),
  });

  return remote.Menu.buildFromTemplate([
    item('top', '顶部标签栏'),
    item('left', '左侧边栏'),
    item('right', '右侧边栏'),
  ]);
};

export const LayoutSwitcher = observer(({ variant = 'bar' }: Props) => {
  const onMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    buildMenu(store.tabsLayout).popup({
      window: getCurrentWindow(),
    });
  };

  return (
    <SwitcherButton
      variant={variant}
      title="切换标签栏位置（顶部 / 左侧 / 右侧）"
      onMouseDown={onMouseDown}
    >
      {ICON_CONVERT}
    </SwitcherButton>
  );
});
