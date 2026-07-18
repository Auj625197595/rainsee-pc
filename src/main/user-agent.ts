import {app} from 'electron';

const stripElectronFromUserAgent = (userAgent: string) =>
   userAgent.replace(/\雨见浏览器\//g, 'RainseeBrowser/').replace(/\sElectron\/[^\s]+/g, '').replace(/\s{2,}/g, ' ').trim();

export const ChromeUserAgent = stripElectronFromUserAgent(app.userAgentFallback);
export const ChromeAppVersion = ChromeUserAgent.replace(/^Mozilla\//, '');

// 移动端 UA:双引擎搜索的副引擎侧边栏用它加载,拿到移动版结果页(秘塔/百度等)。
export const MobileUserAgent =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

export const getUserAgentForURL = (userAgent: string, url: string) => {
  void userAgent;
  void url;
  return ChromeUserAgent;
};
