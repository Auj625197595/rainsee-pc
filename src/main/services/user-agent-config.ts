import {
  DEFAULT_USER_AGENT_WHITELIST,
  setUserAgentWhitelist,
} from '../user-agent';

// 开源版无云端配置源，直接使用内置 UA 白名单。
export const runUserAgentConfigService = () => {
  setUserAgentWhitelist(DEFAULT_USER_AGENT_WHITELIST);
};
