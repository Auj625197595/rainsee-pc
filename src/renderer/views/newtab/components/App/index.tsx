import * as React from 'react';
import { ThemeProvider } from 'styled-components';

import { WebUIStyle } from '~/renderer/mixins/default-styles';
import { getTheme } from '~/utils/themes';
import { getChromeThemeNtpStyle } from '~/common/chrome-theme';
import { ipcRenderer } from '~/common/renderer-ipc';
import { ICON_INCOGNITO } from '~/renderer/constants/icons';
import { getLightweightIconUrl } from '~/utils/favicon';
import { IBookmark, ISettings } from '~/interfaces';
import {
  Frame,
  IncognitoPage,
  IncognitoLogo,
  IncognitoHint,
  IncognitoSearch,
  LocalPage,
  BrandTitle,
  BrandSubtitle,
  SearchRow,
  EngineChips,
  EngineChip,
  ShortcutGrid,
  ShortcutTile,
  TileIconWrap,
  TileLabel,
} from './style';

// 本地新标签页:搜索框(多引擎)、引擎切换、常用书签磁贴,全部本地渲染,
// 不加载任何云端页面。搜索/直达/切引擎通过与主进程的 IPC 完成:
//   - newtab-search            搜索词(可携带引擎下标)
//   - set-search-engine-by-index 引擎 chip 点击
//   - newtab-search-url        URL 直达(主进程二次校验协议)

const URL_PATTERN = /^(https?:\/\/|file:\/\/)/i;

const resolveSettings = (): Partial<ISettings> => {
  try {
    return ipcRenderer.sendSync('get-settings-sync') || {};
  } catch {
    return (window as any).settings || {};
  }
};

const resolveDarkTheme = (settings: Partial<ISettings>) => {
  if (settings.themeAuto === false) return settings.theme === 'wexond-dark';
  return (
    window.matchMedia?.('(prefers-color-scheme: dark)').matches ??
    settings.theme === 'wexond-dark'
  );
};

// 明暗两套设计令牌,以 CSS 变量注入 LocalPage
const paletteFor = (dark: boolean): Record<string, string> =>
  dark
    ? {
        '--ntp-text': '#e8eaed',
        '--ntp-muted': '#9aa0a6',
        '--ntp-panel': '#303134',
        '--ntp-border': '#5f6368',
        '--ntp-accent': '#8ab4f8',
        '--ntp-accent-ring': 'rgba(138, 180, 248, 0.28)',
        '--ntp-accent-chip': 'rgba(138, 180, 248, 0.16)',
        '--ntp-tile-hover': 'rgba(255, 255, 255, 0.07)',
      }
    : {
        '--ntp-text': '#202124',
        '--ntp-muted': '#5f6368',
        '--ntp-panel': '#ffffff',
        '--ntp-border': 'rgba(0, 0, 0, 0.14)',
        '--ntp-accent': '#1a73e8',
        '--ntp-accent-ring': 'rgba(26, 115, 232, 0.22)',
        '--ntp-accent-chip': 'rgba(26, 115, 232, 0.10)',
        '--ntp-tile-hover': 'rgba(0, 0, 0, 0.05)',
      };

// 主屏书签(static === 'main')前 12 条作为快捷入口
const loadShortcuts = async (): Promise<IBookmark[]> => {
  try {
    const bookmarks = await ipcRenderer.invoke('bookmarks-get');
    if (!Array.isArray(bookmarks)) return [];
    return bookmarks
      .filter(
        (b) => b && b.static === 'main' && b.url && !b.isFolder,
      )
      .slice(0, 12);
  } catch {
    return [];
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
  // 无痕 newtab:渲染本地无痕页。
  let isIncognito = false;
  try {
    isIncognito = !!ipcRenderer.sendSync('is-newtab-incognito');
  } catch {
    isIncognito = false;
  }

  const [settings, setSettings] = React.useState<Partial<ISettings>>(
    resolveSettings,
  );
  React.useEffect(() => {
    const onSettingsUpdate = (
      _e: Electron.IpcRendererEvent,
      nextSettings: ISettings,
    ) => setSettings(nextSettings);

    ipcRenderer.on('update-settings', onSettingsUpdate);
    setSettings(resolveSettings());
    return () => {
      ipcRenderer.removeListener('update-settings', onSettingsUpdate);
    };
  }, []);

  // settings.json 加载完成前,theme 可能仍是默认浅色;优先使用系统主题作为
  // 首帧判断,避免暗色窗口先按浅色绘制外壳背景。
  const dark = resolveDarkTheme(settings);
  const theme = getTheme(dark ? 'wexond-dark' : settings.theme);
  const chromeThemeNtp = getChromeThemeNtpStyle(settings.activeChromeTheme);

  const [query, setQuery] = React.useState('');
  const [shortcuts, setShortcuts] = React.useState<IBookmark[]>([]);

  React.useEffect(() => {
    let mounted = true;
    loadShortcuts().then((items) => {
      if (mounted) setShortcuts(items);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const engines = Array.isArray(settings.searchEngines)
    ? settings.searchEngines
    : [];
  const engineIndex =
    typeof settings.searchEngine === 'number' &&
    settings.searchEngine >= 0 &&
    settings.searchEngine < engines.length
      ? settings.searchEngine
      : 0;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = query.trim();
    if (!value) return;
    if (URL_PATTERN.test(value)) {
      ipcRenderer.send('newtab-search-url', value);
    } else {
      ipcRenderer.send('newtab-search', value);
    }
  };

  const onSelectEngine = (index: number) => {
    ipcRenderer.invoke('set-search-engine-by-index', index).catch(() => {});
  };

  const openShortcut = (url?: string) => {
    if (!url || !URL_PATTERN.test(url)) return;
    ipcRenderer.send('newtab-search-url', url);
  };

  if (isIncognito) return <IncognitoNewTab />;

  const background =
    chromeThemeNtp?.backgroundColor || theme['pages.backgroundColor'];

  return (
    <ThemeProvider theme={{ ...theme }}>
      <Frame>
        <WebUIStyle />
        <LocalPage
          style={{
            backgroundColor: background,
            backgroundImage: chromeThemeNtp?.backgroundImage
              ? `url("${chromeThemeNtp.backgroundImage}")`
              : 'none',
            backgroundPosition: chromeThemeNtp?.backgroundPosition,
            backgroundRepeat: chromeThemeNtp?.backgroundRepeat,
            ...paletteFor(dark),
          }}
        >
          <BrandTitle>雨见浏览器</BrandTitle>
          <BrandSubtitle>轻快 · 干净 · 本地优先</BrandSubtitle>

          <SearchRow onSubmit={onSubmit}>
            <input
              value={query}
              onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
              placeholder="搜索，或输入网址直达"
              autoFocus
              spellCheck={false}
            />
            <button type="submit">搜索</button>
          </SearchRow>

          {engines.length > 0 && (
            <EngineChips>
              {engines.map((engine, i) => (
                <EngineChip
                  key={engine.keyword || i}
                  $active={i === engineIndex}
                  onClick={() => onSelectEngine(i)}
                  title={`使用 ${engine.name} 搜索`}
                >
                  {engine.icon && engine.icon !== '' && (
                    <img src={engine.icon} alt="" onError={hideImg} />
                  )}
                  {engine.name}
                </EngineChip>
              ))}
            </EngineChips>
          )}

          {shortcuts.length > 0 && (
            <ShortcutGrid>
              {shortcuts.map((bookmark) => (
                <ShortcutTile
                  key={bookmark._id || bookmark.url}
                  onClick={() => openShortcut(bookmark.url)}
                  title={bookmark.title || bookmark.url}
                >
                  <TileIconWrap>
                    <span className="fallback">
                      {(bookmark.title || bookmark.url || '?')
                        .trim()
                        .charAt(0)
                        .toUpperCase()}
                    </span>
                    <img
                      src={
                        bookmark.favicon ||
                        getLightweightIconUrl(bookmark.url!)
                      }
                      alt=""
                      onError={hideImg}
                    />
                  </TileIconWrap>
                  <TileLabel>{bookmark.title || bookmark.url}</TileLabel>
                </ShortcutTile>
              ))}
            </ShortcutGrid>
          )}
        </LocalPage>
      </Frame>
    </ThemeProvider>
  );
};

function hideImg(e: React.SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.style.display = 'none';
}
