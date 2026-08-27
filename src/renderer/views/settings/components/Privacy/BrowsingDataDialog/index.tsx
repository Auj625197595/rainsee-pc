import * as React from 'react';
import {observer} from 'mobx-react-lite';
import styled, {css} from 'styled-components';

import {Dialog, Title, Content, Buttons, CloseButton} from '../../Dialog';
import {NormalButton} from '../../App';
import store from '../../../store';
import {saveWebBrowsingSettings} from '../../../utils';
import {ITheme} from '~/interfaces';
import {getPalette} from '~/renderer/views/bookmarks/utils/palette';

// 「立即清除浏览数据」对话框(原占位 alert「此功能开发中」的实现)。
// 复用主进程 performClearOnExit 编排 + 主窗口进度覆盖层:
// 确定后 (window as any).clearBrowsingDataNow(view-preload 注入) → 主进程显示
// 覆盖层、跑清理、完成后隐藏覆盖层(不退出)。

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
  {key: 'history', label: '历史记录'},
  {key: 'cache', label: '网页缓存'},
  {key: 'cookies', label: 'Cookie'},
  {key: 'searchHistory', label: '搜索历史'},
];

export default observer(() => {
  const visible = store.dialogContent === 'browsing-data';
  // 本地选择态会在确认清理时持久化,供工具栏的当前站点/全部站点清理复用。
  const [items, setItems] = React.useState(() => ({
    ...store.settings.clearBrowsingData,
  }));
  const [clearing, setClearing] = React.useState(false);

  React.useEffect(() => {
    if (visible) {
      setItems({...store.settings.clearBrowsingData});
    }
  }, [visible]);

  const toggle = (key: 'cache' | 'cookies' | 'history' | 'searchHistory') => {
    setItems((prev) => ({...prev, [key]: !prev[key]}));
  };

  const onClear = async () => {
    setClearing(true);
    try {
      store.settings.clearBrowsingData = {...items};
      saveWebBrowsingSettings({clearBrowsingData: {...items}});
      // 设置页是 webui(nodeIntegration:false),不能直接用 ipcRenderer;
      // 由 view-preload 注入 (window as any).clearBrowsingDataNow 桥接。
      const fn = (window as any).clearBrowsingDataNow;
      if (typeof fn === 'function') {
        await fn(items);
      }
    } catch (e) {
      console.error('[clear-browsing-data] failed', e);
    } finally {
      setClearing(false);
      store.dialogContent = null;
    }
  };

  return (
    <Dialog visible={visible} style={{width: 344, marginLeft: 'auto'}}>
      <Title>清除浏览数据</Title>
      <Content>
        {ITEMS.map((it) => (
          <Item key={it.key} onClick={() => toggle(it.key)}>
            <Box checked={items[it.key]}>{items[it.key] && <Check />}</Box>
            {it.label}
          </Item>
        ))}
      </Content>
      <Buttons>
        <CloseButton />
        <NormalButton onClick={onClear} disabled={clearing}>
          {clearing ? '清理中…' : '立即清除'}
        </NormalButton>
      </Buttons>
    </Dialog>
  );
});
