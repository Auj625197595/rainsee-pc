import * as React from 'react';

import { Wrapper, Box, Label } from './style';

// 勾选标记(白色对勾)。
const Check = () => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#fff"
    strokeWidth="3.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 6 9 17l-5-5"></path>
  </svg>
);

// 受控勾选项:勾选时由调用方让单击/点标题改为「在新标签打开」。
// 点击事件 stopPropagation,避免冒泡触发页面全局 mousedown 监听(关菜单/关弹窗)。
export const OpenInNewTabToggle = ({
  checked,
  onChange,
  title,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  title?: string;
}) => {
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(!checked);
  };

  return (
    <Wrapper
      title={title || '勾选后,单击/点标题在新标签页打开'}
      onClick={toggle}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Box checked={checked} aria-hidden>
        {checked && <Check />}
      </Box>
      <Label>在新页面打开</Label>
    </Wrapper>
  );
};
