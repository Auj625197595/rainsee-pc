import { ipcRenderer } from 'electron';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Monitor } from '@phosphor-icons/react/dist/csr/Monitor';
import { Moon } from '@phosphor-icons/react/dist/csr/Moon';
import { Sun } from '@phosphor-icons/react/dist/csr/Sun';
import { createLocaleTranslator } from '~/common/i18n';

// 独立 PWA 的 Electron 壳层 preload。这里只渲染窗口头部，网页本身运行在
// 下方单独的 BrowserView 中，因此第三方站点不会覆盖或影响这些控件。
const HEADER_HEIGHT = 36;
const WINDOW_CONTROLS_WIDTH = 138;
const THEME_CONTROLS_WIDTH = 38;

type AppThemeMode = 'auto' | 'light' | 'dark';

interface AppShellInfo {
  title: string;
  themeColor: string;
  foregroundColor: string;
  iconDataUrl: string;
  themeMode: AppThemeMode;
  dark: boolean;
}

const install = () => {
  if (document.getElementById('rainsee-pwa-header')) return;

  const style = document.createElement('style');
  style.textContent = `
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body { background: #202124; color: #e8eaed; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; }
    #rainsee-pwa-header {
      position: fixed;
      inset: 0 0 auto 0;
      height: ${HEADER_HEIGHT}px;
      background: #202124;
      -webkit-app-region: drag;
      user-select: none;
    }
    #rainsee-pwa-title {
      height: ${HEADER_HEIGHT}px;
      padding: 0 ${WINDOW_CONTROLS_WIDTH + 38 + THEME_CONTROLS_WIDTH + 8}px 0 12px;
      overflow: hidden;
      color: #e8eaed;
      font-size: 13px;
      line-height: ${HEADER_HEIGHT}px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #rainsee-pwa-header.has-icon #rainsee-pwa-title { padding-left: 36px; }
    #rainsee-pwa-icon {
      position: absolute;
      top: 10px;
      left: 12px;
      display: none;
      width: 16px;
      height: 16px;
      object-fit: contain;
      pointer-events: none;
    }
    #rainsee-pwa-header.has-icon #rainsee-pwa-icon { display: block; }
    #rainsee-pwa-theme-controls {
      position: absolute;
      top: 0;
      right: ${WINDOW_CONTROLS_WIDTH + 38}px;
      width: ${THEME_CONTROLS_WIDTH}px;
      height: ${HEADER_HEIGHT}px;
      -webkit-app-region: no-drag;
    }
    #rainsee-pwa-theme-button {
      display: grid;
      width: ${THEME_CONTROLS_WIDTH}px;
      height: ${HEADER_HEIGHT}px;
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
      place-items: center;
      appearance: none;
      -webkit-tap-highlight-color: transparent;
    }
    #rainsee-pwa-theme-button:hover,
    #rainsee-pwa-theme-button:focus-visible { background: var(--pwa-control-hover, rgba(255,255,255,.12)); }
    #rainsee-pwa-theme-button:active { background: var(--pwa-control-active, rgba(255,255,255,.18)); }
    #rainsee-pwa-theme-button:focus-visible { outline: 2px solid #8ab4f8; outline-offset: -2px; }
    #rainsee-pwa-more {
      position: absolute;
      top: 0;
      right: ${WINDOW_CONTROLS_WIDTH}px;
      display: grid;
      width: 38px;
      height: ${HEADER_HEIGHT}px;
      padding: 0;
      place-items: center;
      border: 0;
      border-radius: 0;
      background: transparent;
      color: #e8eaed;
      cursor: pointer;
      appearance: none;
      transition: background-color 80ms ease;
      -webkit-tap-highlight-color: transparent;
      -webkit-app-region: no-drag;
    }
    #rainsee-pwa-more:hover { background: var(--pwa-control-hover, rgba(255,255,255,.12)); }
    #rainsee-pwa-more:active { background: var(--pwa-control-active, rgba(255,255,255,.18)); }
    #rainsee-pwa-more:focus-visible { outline: 2px solid #8ab4f8; outline-offset: -2px; }
  `;
  document.head.appendChild(style);

  const header = document.createElement('header');
  header.id = 'rainsee-pwa-header';

  const icon = document.createElement('img');
  icon.id = 'rainsee-pwa-icon';
  icon.alt = '';

  // 壳层文案按 --lang 基线(navigator.language)翻译;每次 install 重建,不缓存。
  const t = createLocaleTranslator(undefined);

  const title = document.createElement('div');
  title.id = 'rainsee-pwa-title';
  title.textContent = document.title || t('iaAppFallback');

  const themeControls = document.createElement('div');
  themeControls.id = 'rainsee-pwa-theme-controls';
  const themeButton = document.createElement('button');
  themeButton.id = 'rainsee-pwa-theme-button';
  themeButton.type = 'button';
  themeButton.setAttribute('aria-haspopup', 'menu');
  const themeLabels: Array<[AppThemeMode, string]> = [
    ['light', t('pwaThemeDay')],
    ['dark', t('pwaThemeNight')],
    ['auto', t('pwaThemeAuto')],
  ];
  const themeIcons = { light: Sun, dark: Moon, auto: Monitor } as const;
  let browserIsDark = false;
  const updateThemeButtons = (mode: AppThemeMode, dark = browserIsDark) => {
    // Automatic mode reflects the effective browser theme: sun in light mode,
    // moon in dark mode. Explicit modes always keep their matching icon.
    const Icon = mode === 'auto' ? (dark ? Moon : Sun) : themeIcons[mode];
    themeButton.innerHTML = renderToStaticMarkup(
      React.createElement(Icon, { size: 18, weight: 'regular', 'aria-hidden': true }),
    );
    themeButton.title = themeLabels.find(([key]) => key === mode)?.[1] || '';
    themeButton.setAttribute('aria-label', themeButton.title);
  };
  themeButton.addEventListener('click', () => {
    void ipcRenderer.invoke('pwa-app-theme-menu-open').catch(() => false);
  });
  themeControls.appendChild(themeButton);
  updateThemeButtons('auto');

  const more = document.createElement('button');
  more.id = 'rainsee-pwa-more';
  more.type = 'button';
  more.title = t('stMore');
  more.setAttribute('aria-label', t('amMoreOptions'));
  more.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="3.5" cy="9" r="1.25" fill="currentColor"/><circle cx="9" cy="9" r="1.25" fill="currentColor"/><circle cx="14.5" cy="9" r="1.25" fill="currentColor"/></svg>';
  more.addEventListener('click', () => {
    void ipcRenderer.invoke('pwa-app-menu-open').catch(() => false);
  });

  ipcRenderer.on('pwa-app-title', (_event, value: unknown) => {
    if (typeof value === 'string' && value.trim()) title.textContent = value;
  });

  header.append(icon, title, themeControls, more);
  document.body.appendChild(header);

  const applyThemeState = (raw: unknown) => {
    const state = raw as {mode?: unknown; dark?: unknown} | null;
    if (state?.mode === 'dark' || state?.mode === 'light' || state?.mode === 'auto') {
      browserIsDark = state.dark === true;
      updateThemeButtons(state.mode, browserIsDark);
    }
  };
  ipcRenderer.on('pwa-app-theme-state', (_event, state: unknown) => {
    applyThemeState(state);
  });

  void ipcRenderer
    .invoke('pwa-app-shell-info')
    .then((raw: unknown) => {
      const info = raw as AppShellInfo | null;
      if (!info) return;
      applyThemeState(info);
      if (info.title) title.textContent = info.title;
      if (info.themeColor) {
        document.body.style.backgroundColor = info.themeColor;
        header.style.backgroundColor = info.themeColor;
      }
      if (info.foregroundColor) {
        header.style.color = info.foregroundColor;
        title.style.color = info.foregroundColor;
        more.style.color = info.foregroundColor;
        themeButton.style.color = info.foregroundColor;
        const lightControls = info.foregroundColor.toLowerCase() !== '#202124';
        header.style.setProperty(
          '--pwa-control-hover',
          lightControls ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.08)',
        );
        header.style.setProperty(
          '--pwa-control-active',
          lightControls ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.14)',
        );
      }
      if (info.iconDataUrl) {
        icon.addEventListener('load', () => header.classList.add('has-icon'), {
          once: true,
        });
        icon.src = info.iconDataUrl;
      }
    })
    .catch(() => undefined);
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true });
} else {
  install();
}
