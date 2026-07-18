import { nativeTheme } from 'electron';

/**
 * 内容 BrowserView 在网页绘制前的「底色」。跟随生效主题:
 * 暗色给深色底,消除点击链接新标签页打开时的白闪(页面 paint 前露出的默认白底)。
 * 与主窗口启动背景(app.ts STARTUP_DARK_BG)、newtab/main-app.html 的 --startup-bg 保持一致。
 */
export const VIEW_DARK_BG = '#1c1c1c';
export const VIEW_LIGHT_BG = '#ffffff';

/**
 * 当前是否为暗色生效主题。nativeTheme.shouldUseDarkColors 由 Settings 模型
 * (settings.theme / themeAuto → nativeTheme.themeSource)解析后反映,是主进程判断
 * 「此刻是否暗色」的权威源。注意必须在 Settings.load/app 启动设置过 themeSource
 * 之后读取才准确——BrowserView 创建/导航前已满足。
 */
export const isDarkThemeActive = () => nativeTheme.shouldUseDarkColors;

/** 内容 BrowserView 应使用的底色:暗色 #1c1c1c,亮色 #ffffff。 */
export const getViewBackgroundColor = () =>
  isDarkThemeActive() ? VIEW_DARK_BG : VIEW_LIGHT_BG;
