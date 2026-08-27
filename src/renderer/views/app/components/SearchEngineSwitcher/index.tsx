import { observer } from 'mobx-react-lite';
import * as React from 'react';
import { ipcRenderer } from 'electron';

import store from '../../store';
import { ICON_SEARCH, ICON_TUNE } from '~/renderer/constants';
import { getWebUIURL } from '~/common/webui';
import { IconButton, EngineIcon } from './style';

const isHomePage = (rawUrl: string) => {
  if (!rawUrl || rawUrl === 'about:blank') return true;
  const homeUrl = getWebUIURL('newtab');
  try {
    const current = new URL(rawUrl);
    const home = new URL(homeUrl);
    const normalizePath = (path: string) => path.replace(/\/+$/, '') || '/';
    return (
      current.protocol === home.protocol &&
      current.host === home.host &&
      normalizePath(current.pathname) === normalizePath(home.pathname)
    );
  } catch {
    return rawUrl.startsWith(homeUrl);
  }
};

// 首页显示默认搜索引擎入口;其他页面对齐 Chrome,显示并打开站点信息。
export const SearchEngineSwitcher = observer(() => {
  const btnRef = React.useRef<HTMLDivElement>(null);
  const engine = store.settings.searchEngine;
  const homePage = isHomePage(store.tabs.selectedTab?.url || '');

  const onMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    ipcRenderer.send(
      homePage
        ? `show-search-engines-dialog-${store.windowId}`
        : `show-site-info-dialog-${store.windowId}`,
      rect.left,
      rect.bottom,
    );
  };

  return (
    <IconButton
      data-rainsee-part="toolbar-button"
      data-rainsee-action={homePage ? 'search-engine' : 'site-info'}
      className={`addressbar-action addressbar-action--${
        homePage ? 'engine' : 'site-info'
      }`}
      ref={btnRef}
      title={
        homePage
          ? `搜索引擎: ${engine?.name || ''}（点击切换）`
          : '查看网站信息'
      }
      onMouseDown={onMouseDown}
    >
      {homePage && engine?.icon ? (
        <EngineIcon
          data-rainsee-part="button-icon"
          $monochrome={false}
          style={{ backgroundImage: `url(${engine.icon})` }}
        />
      ) : (
        <EngineIcon
          data-rainsee-part="button-icon"
          $monochrome
          style={{
            backgroundImage: `url(${homePage ? ICON_SEARCH : ICON_TUNE})`,
            transform: homePage ? 'scale(-1,1)' : 'none',
          }}
        />
      )}
    </IconButton>
  );
});
