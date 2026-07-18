import { observer } from 'mobx-react-lite';
import * as React from 'react';
import { ipcRenderer } from 'electron';

import store from '../../store';
import { ICON_SEARCH } from '~/renderer/constants';
import { ISearchEngine } from '~/interfaces';
import { IconButton, EngineIcon } from './style';

// 取搜索引擎 URL 的 host(去掉 www. 前缀),用于和当前页 host 比对。
const engineHost = (engineUrl: string): string => {
  try {
    return new URL(engineUrl.replace('%s', '__Q__')).host.replace(/^www\./, '');
  } catch {
    return '';
  }
};

// 当前页是否落在某个已知搜索引擎上;命中返回该引擎,否则返回 null。
const matchEngineByHost = (rawUrl: string): ISearchEngine | null => {
  if (!rawUrl) return null;
  let host: string;
  try {
    host = new URL(rawUrl).host.replace(/^www\./, '');
  } catch {
    return null;
  }
  if (!host) return null;
  const engines = store.settings.object.searchEngines || [];
  return engines.find((e) => engineHost(e.url || '') === host) || null;
};

// 地址栏左侧:仅在当前页落在某个搜索引擎上时显示对应引擎图标,
// 其余页面(普通网站、新标签页等)统一显示放大镜。点击仍弹出引擎切换下拉(独立 BrowserView)。
export const SearchEngineSwitcher = observer(() => {
  const btnRef = React.useRef<HTMLDivElement>(null);
  const engine = store.settings.searchEngine;

  const onMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    ipcRenderer.send(
      `show-search-engines-dialog-${store.windowId}`,
      rect.left,
      rect.bottom,
    );
  };

  // hover 时后台预加载弹窗(不显示),使点击即秒开。已加载则主进程 no-op。
  const onMouseEnter = () => {
    ipcRenderer.send(
      `preload-dialog-on-hover-${store.windowId}`,
      'search-engines',
    );
  };

  const matched = matchEngineByHost(store.tabs.selectedTab?.url || '');

  return (
    <IconButton
      className="addressbar-action addressbar-action--engine"
      ref={btnRef}
      title={`搜索引擎: ${engine?.name || ''}（点击切换）`}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
    >
      {matched?.icon ? (
        <EngineIcon
          $monochrome={false}
          style={{ backgroundImage: `url(${matched.icon})` }}
        />
      ) : (
        <EngineIcon
          $monochrome
          style={{
            backgroundImage: `url(${ICON_SEARCH})`,
            transform: 'scale(-1,1)',
          }}
        />
      )}
    </IconButton>
  );
});
