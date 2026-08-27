import {app} from 'electron';

const stripElectronFromUserAgent = (userAgent: string) =>
   userAgent.replace(/\雨见浏览器\/[^\s]+/g, '').replace(/\s{2,}/g, ' ').replace(/\sElectron\/[^\s]+/g, '').replace(/\s{2,}/g, ' ').trim();

// 必须在 index.ts 设置 app.userAgentFallback 前保存。Google 登录会校验 UA 与
// Chromium 环境的一致性，不能使用浏览器为普通网页伪装过的 UA。
export const DefaultUserAgent = app.userAgentFallback;
export const ChromeUserAgent = stripElectronFromUserAgent(DefaultUserAgent);
export const ChromeAppVersion = ChromeUserAgent.replace(/^Mozilla\//, '');

// 内置配置先立即生效；云端配置服务启动后会异步替换该列表。
export const DEFAULT_USER_AGENT_WHITELIST = ['google.com'];
let userAgentWhitelist = DEFAULT_USER_AGENT_WHITELIST.slice();

// 移动端 UA:双引擎搜索的副引擎侧边栏用它加载,拿到移动版结果页(秘塔/百度等)。
export const MobileUserAgent =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const hostMatches = (hostname: string, entry: string) =>
  hostname === entry || hostname.endsWith(`.${entry}`);

export const setUserAgentWhitelist = (hosts: string[]) => {
  userAgentWhitelist = hosts.filter(Boolean);
};

export const getUserAgentWhitelist = () => userAgentWhitelist.slice();

export const isUserAgentExceptionURL = (url: string) => {
  try {
    const {hostname} = new URL(url);
    const normalized = hostname.toLowerCase();
    return userAgentWhitelist.some((entry) =>
      hostMatches(normalized, entry.toLowerCase()),
    );
  } catch {
    return false;
  }
};

// 兼容现有调用方；白名单配置更新后同样动态生效。
export const isGoogleURL = isUserAgentExceptionURL;

export const getUserAgentForURL = (defaultUserAgent: string, url: string) => {
  return isGoogleURL(url) ? defaultUserAgent : ChromeUserAgent;
};
