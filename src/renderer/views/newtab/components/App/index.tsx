import * as React from 'react';
import { ThemeProvider } from 'styled-components';

import { WebUIStyle } from '~/renderer/mixins/default-styles';
import { getTheme } from '~/utils/themes';
import { appendDeviceParams, IDeviceParams } from '~/common/newtab-url';
import { ipcRenderer } from '~/common/renderer-ipc';
import { ICON_INCOGNITO } from '~/renderer/constants/icons';
import { Frame, IncognitoPage, IncognitoLogo, IncognitoHint, IncognitoSearch } from './style';

// 新标签页直接全屏内嵌 pcapp.rainsee.cn,并拼接设备参数(ck/devid/prod/lang)。
// deviceParams 由 view-preload 在页面加载时注入到 window。
const NEWTAB_BASE_URL = 'https://pcapp.rainsee.cn/?hulianpc=true#/';
const NEWTAB_ORIGIN = new URL(NEWTAB_BASE_URL).origin;

const postHomepageItems = (items: any[], frame: HTMLIFrameElement | null) => {
  if (!frame?.contentWindow || !Array.isArray(items) || items.length === 0) {
    return;
  }

  frame.contentWindow.postMessage(
    {
      type: 'homepageItems',
      data: items,
    },
    '*',
  );
};

const buildSrc = (params: IDeviceParams | null | undefined) =>
  appendDeviceParams(NEWTAB_BASE_URL, params || null);

// 同步尽力获取最新 deviceParams:优先 view-preload 已注入到 window 的值
// (preload IIFE 用 await webFrame.executeJavaScript 异步注入,存在晚于首渲染的 race);
// 没有就同步向主进程拉一次。newtab 是 sandbox:false + contextIsolation:false 的 webui
// 页,view-preload 顶部同步 (window).electron = electronRenderer 在 bundle 执行前完成,
// 故 ipcRenderer.sendSync 在首渲染时即可用(plan 已列为实测验证项)。
const resolveDeviceParams = (): IDeviceParams | null | undefined => {
  const fromWindow = (window as any).deviceParams;
  if (fromWindow) return fromWindow;
  try {
    return ipcRenderer.sendSync('get-device-params') as IDeviceParams;
  } catch {
    // ipcRenderer 尚未桥接或 sendSync 不可用,退回无参 URL(pcapp 走未登录态)。
    return null;
  }
};

const IncognitoNewTab = () => {
  const [q, setQ] = React.useState('');
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    if (query) ipcRenderer.send('newtab-search', query);
  };
  return (
    <ThemeProvider theme={{ ...getTheme((window as any).settings?.theme) }}>
      <IncognitoPage>
        <WebUIStyle />
        <IncognitoLogo>
          <img src={ICON_INCOGNITO} alt="" />
          <span>无痕模式</span>
        </IncognitoLogo>
        <IncognitoHint>
          关闭所有无痕窗口后，雨见不会保留浏览记录、Cookie、站点数据及表单信息。下载的文件与新增书签仍会保留。您的活动仍可能对访问的网站、所在单位或网络服务提供商可见。
        </IncognitoHint>
        <IncognitoSearch onSubmit={onSubmit}>
          <input
            value={q}
            onChange={(e) => setQ((e.target as HTMLInputElement).value)}
            placeholder="在网络上搜索"
            autoFocus
          />
        </IncognitoSearch>
      </IncognitoPage>
    </ThemeProvider>
  );
};

export default () => {
  // 无痕 newtab:不加载 pcapp iframe(避免带 cookie 请求泄漏),渲染本地无痕页。
  let isIncognito = false;
  try {
    isIncognito = !!ipcRenderer.sendSync('is-newtab-incognito');
  } catch {
    isIncognito = false;
  }
  if (isIncognito) return <IncognitoNewTab />;

  const theme = getTheme((window as any).settings?.theme);
  const frameRef = React.useRef<HTMLIFrameElement>(null);
  // iframe 首次 onLoad 后即锁定:此后任何来源都不再改动 src,避免重载 iframe 导致
  // pcapp 整页重新加载(双加载比单次更慢)。ck 的后续变化由 pcapp 内部处理。
  const loadedRef = React.useRef(false);

  // 首渲染即尽力带 ck(resolveDeviceParams 同步取),iframe 只加载这一次。
  // 这从根上消除"先无 ck 加载、再带 ck 重载"的 deviceParams race 双加载。
  const [src] = React.useState<string>(() => buildSrc(resolveDeviceParams()));

  React.useEffect(() => {
    const onHomepageItems = (_e: Electron.IpcRendererEvent, items: any[]) => {
      postHomepageItems(items, frameRef.current);
    };

    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== frameRef.current?.contentWindow ||
        event.origin !== NEWTAB_ORIGIN
      ) {
        return;
      }

      const data = event.data;
      if (!data) return;

      if (data.type === 'showPcSearch') {
        ipcRenderer.send(
          `newtab-search-show-${(window as any).windowId}`,
          data.data,
        );
        return;
      }

      if (data.type === 'removeDownHomepageItems') {
        ipcRenderer.send('remove-down-homepage-items', data.data || []);
      }
    };

    ipcRenderer.on('homepage-items', onHomepageItems);
    window.addEventListener('message', onMessage);

    return () => {
      ipcRenderer.removeListener('homepage-items', onHomepageItems);
      window.removeEventListener('message', onMessage);
    };
  }, []);

  const onFrameLoad = React.useCallback(async () => {
    loadedRef.current = true;
    const items = await ipcRenderer.invoke('get-pending-homepage-items');
    postHomepageItems(items, frameRef.current);
  }, []);

  return (
    <ThemeProvider theme={{ ...theme }}>
      <>
        <WebUIStyle />
        <Frame
          ref={frameRef}
          src={src}
          allow="clipboard-read; clipboard-write"
          onLoad={onFrameLoad}
        />
      </>
    </ThemeProvider>
  );
};
