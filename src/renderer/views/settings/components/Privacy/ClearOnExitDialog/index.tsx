import * as React from 'react';
import {observer} from 'mobx-react-lite';
import styled, {css} from 'styled-components';

import {Dialog, Title, Content, Buttons, CloseButton} from '../../Dialog';
import {NormalButton} from '../../App';
import store from '../../../store';
import {saveWebBrowsingSettings} from '../../../utils';
import {ITheme} from '~/interfaces';
import {getPalette} from '~/renderer/views/bookmarks/utils/palette';

// 「退出时自动清理」多选对话框:勾选项双向绑定 store.settings.clearOnExit.*,
// 确定后 store.save() 持久化。「立即清除」(BrowsingDataDialog)复用同样的勾选 UI,
// 但走本地 state + IPC,本组件不复用(保持局部、互不耦合)。

const Item = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 4px;
  cursor: pointer;
  font-size: 14px;

  ${({theme}: {theme: ITheme}) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

const Box = styled.div<{checked: boolean}>`
  width: 18px;
  height: 18px;
  border-radius: 5px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  border: 2px solid rgba(127, 127, 127, 0.4);

  ${({theme, checked}: {theme: ITheme; checked: boolean}) => css`
    background: ${checked ? getPalette(theme).primary : 'transparent'};
    border-color: ${checked ? getPalette(theme).primary : 'rgba(127,127,127,0.4)'};
  `}
`;

const Check = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
    <path
      d="M2 6.5L4.5 9L10 3"
      stroke="#fff"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ITEMS: {key: 'cache' | 'cookies' | 'history' | 'searchHistory'; label: string}[] = [
  {key: 'cache', label: '网页缓存'},
  {key: 'cookies', label: 'Cookie'},
  {key: 'history', label: '历史记录'},
  {key: 'searchHistory', label: '搜索历史'},
];

export default observer(() => {
  const visible = store.dialogContent === 'clear-on-exit';
  // settings.clearOnExit 始终存在(主进程 load 校验补全),这里防御性兜底。
  const coe = store.settings.clearOnExit || {
    cache: false,
    cookies: false,
    history: false,
    searchHistory: false,
  };

  const toggle = (key: 'cache' | 'cookies' | 'history' | 'searchHistory') => {
    store.settings.clearOnExit = {
      ...coe,
      [key]: !coe[key],
    };
  };

  const onConfirm = () => {
    saveWebBrowsingSettings({clearOnExit: {...coe}});
    store.dialogContent = null;
  };

  return (
    <Dialog visible={visible} style={{width: 344}}>
      <Title>退出时自动清理</Title>
      <Content>
        {ITEMS.map((it) => (
          <Item key={it.key} onClick={() => toggle(it.key)}>
            <Box checked={coe[it.key]}>{coe[it.key] && <Check />}</Box>
            {it.label}
          </Item>
        ))}
      </Content>
      <Buttons>
        <CloseButton />
        <NormalButton onClick={onConfirm}>确定</NormalButton>
      </Buttons>
    </Dialog>
  );
});
