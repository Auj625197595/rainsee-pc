import {
  app,
  ipcMain,
  safeStorage,
  session,
  Session,
} from 'electron';
import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

import {
  deriveProfileFingerprint,
  IProfileProxySettings,
  normalizeProfileProxy,
  ProfileProxyMode,
} from '~/common/profile-network';
import { activeProfileName } from './bootstrap-paths';
import { WEBUI_BASE_URL, WEBUI_URL_SUFFIX } from '~/constants/files';

interface IStoredProxy {
  mode: ProfileProxyMode;
  host: string;
  port: number;
  username: string;
  passwordEncrypted?: string;
  passwordPlaintext?: string;
  bypass: string;
  pacScript: string;
}

interface IStoredProfileNetwork {
  version: 1;
  fingerprint: {
    enabled: boolean;
    seed: string;
  };
  proxy: IStoredProxy;
}

// 升级配置 key，使已有用户也重新采用系统代理默认值。
const CONFIG_FILE = join(app.getPath('userData'), 'profile-network-v3.json');
const SETTINGS_URL = `${WEBUI_BASE_URL}settings${WEBUI_URL_SUFFIX}`;
const DEFAULT_PROXY: IStoredProxy = {
  mode: 'system',
  host: '',
  port: 0,
  username: '',
  bypass: '<local>',
  pacScript: '',
};

const makeSeed = () => randomBytes(24).toString('hex');

const defaultConfig = (): IStoredProfileNetwork => ({
  version: 1,
  fingerprint: { enabled: true, seed: makeSeed() },
  proxy: { ...DEFAULT_PROXY },
});

const writeConfig = (value: IStoredProfileNetwork) => {
  const temp = `${CONFIG_FILE}.${process.pid}.tmp`;
  const backup = `${CONFIG_FILE}.${process.pid}.backup`;
  writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  rmSync(backup, { force: true });
  if (existsSync(CONFIG_FILE)) renameSync(CONFIG_FILE, backup);
  try {
    renameSync(temp, CONFIG_FILE);
    rmSync(backup, { force: true });
  } catch (error) {
    try {
      rmSync(temp, { force: true });
    } catch {}
    if (existsSync(backup) && !existsSync(CONFIG_FILE)) {
      renameSync(backup, CONFIG_FILE);
    }
    throw error;
  }
};

const loadConfig = (): IStoredProfileNetwork => {
  let parsed: any = null;
  try {
    parsed = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {}

  const fallback = defaultConfig();
  const seed =
    typeof parsed?.fingerprint?.seed === 'string' &&
    /^[a-f0-9]{32,128}$/i.test(parsed.fingerprint.seed)
      ? parsed.fingerprint.seed
      : fallback.fingerprint.seed;
  const rawProxy = parsed?.proxy || {};
  const proxyMode: ProfileProxyMode =
    rawProxy.mode === 'system' ||
    rawProxy.mode === 'http' ||
    rawProxy.mode === 'socks5' ||
    rawProxy.mode === 'pac'
      ? rawProxy.mode
      : fallback.proxy.mode;
  const config: IStoredProfileNetwork = {
    version: 1,
    fingerprint: {
      enabled: parsed?.fingerprint?.enabled !== false,
      seed,
    },
    proxy: {
      mode: proxyMode,
      host: typeof rawProxy.host === 'string' ? rawProxy.host : '',
      port: Number.isInteger(rawProxy.port) ? rawProxy.port : 0,
      username: typeof rawProxy.username === 'string' ? rawProxy.username : '',
      passwordEncrypted:
        typeof rawProxy.passwordEncrypted === 'string'
          ? rawProxy.passwordEncrypted
          : undefined,
      passwordPlaintext:
        typeof rawProxy.passwordPlaintext === 'string'
          ? rawProxy.passwordPlaintext
          : undefined,
      bypass:
        typeof rawProxy.bypass === 'string' ? rawProxy.bypass : '<local>',
      pacScript:
        typeof rawProxy.pacScript === 'string' ? rawProxy.pacScript : '',
    },
  };
  if (!parsed || seed !== parsed?.fingerprint?.seed) writeConfig(config);
  return config;
};

// 代理设置对主账号和小号都持久化:各自的 userData 目录天然隔离,
// 共用同一文件名不会冲突。
let config = loadConfig();

const decryptPassword = (): string => {
  const encrypted = config.proxy.passwordEncrypted;
  if (encrypted && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    } catch (error) {
      console.error('[profile-network] 解密代理密码失败:', error);
    }
  }
  return config.proxy.passwordPlaintext || '';
};

const publicProxy = (): IProfileProxySettings => ({
  mode: config.proxy.mode,
  host: config.proxy.host,
  port: config.proxy.port,
  username: config.proxy.username,
  password: decryptPassword(),
  bypass: config.proxy.bypass,
  pacScript: config.proxy.pacScript,
});

const electronProxyConfig = (): Electron.ProxyConfig => {
  const mode = config.proxy.mode;
  if (mode === 'direct') return { mode: 'direct' };
  if (mode === 'system') return { mode: 'system' };
  const proxyBypassRules = config.proxy.bypass || '<local>';
  if (mode === 'pac') {
    const script = config.proxy.pacScript.trim();
    // http(s)/file 开头视为 PAC URL,否则当作脚本文本封装为 data URI。
    const pacScript = /^https?:\/\/|^file:\/\//i.test(script)
      ? script
      : `data:application/x-ns-proxy-autoconfig;base64,${Buffer.from(
          script,
          'utf8',
        ).toString('base64')}`;
    return { mode: 'pac_script', pacScript, proxyBypassRules };
  }
  return {
    mode: 'fixed_servers',
    proxyRules: `${mode}://${config.proxy.host}:${config.proxy.port}`,
    proxyBypassRules,
  };
};

const applyProxyToSession = async (target: Session, closeConnections = false) => {
  await target.setProxy(electronProxyConfig());
  if (closeConnections) await target.closeAllConnections();
};

const knownSessions = new Set<Session>();

const profileSessions = (): Session[] => {
  const targets = [
    session.defaultSession,
    session.fromPartition('persist:view'),
    session.fromPartition('persist:view_incognito'),
  ];
  const unique = targets.filter((item, index) => targets.indexOf(item) === index);
  unique.forEach((target) => knownSessions.add(target));
  return unique;
};

const applyProxyEverywhere = async (closeConnections = false) => {
  profileSessions();
  await Promise.all(
    Array.from(knownSessions).map((target) =>
      applyProxyToSession(target, closeConnections),
    ),
  );
};

const saveProxy = (proxy: IProfileProxySettings) => {
  let passwordEncrypted: string | undefined;
  let passwordPlaintext: string | undefined;
  if (proxy.password) {
    if (safeStorage.isEncryptionAvailable()) {
      passwordEncrypted = safeStorage.encryptString(proxy.password).toString('base64');
    } else {
      passwordPlaintext = proxy.password;
    }
  }
  config.proxy = {
    mode: proxy.mode,
    host: proxy.host,
    port: proxy.port,
    username: proxy.username,
    passwordEncrypted,
    passwordPlaintext,
    bypass: proxy.bypass,
    pacScript: proxy.pacScript,
  };
  writeConfig(config);
};

const fingerprintPayload = () =>
  activeProfileName
    ? deriveProfileFingerprint(
        config.fingerprint.seed,
        process.platform,
        config.fingerprint.enabled,
      )
    : { enabled: false };

const requireSettingsSender = (event: Electron.IpcMainInvokeEvent) => {
  const senderUrl = event.sender.getURL().split(/[?#]/, 1)[0];
  if (senderUrl !== SETTINGS_URL && senderUrl !== `${SETTINGS_URL}/`) {
    throw new Error('该操作只能从浏览器设置页执行');
  }
};

export const getActiveProxyCredentials = () => {
  if (config.proxy.mode === 'direct' || config.proxy.mode === 'system') {
    return null;
  }
  const password = decryptPassword();
  if (!config.proxy.username && !password) return null;
  return { username: config.proxy.username, password };
};

const testProxy = async (): Promise<{
  ok: boolean;
  ip?: string;
  message?: string;
}> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await session
        .fromPartition('persist:view')
        .fetch('https://api.ipify.org?format=json', {
          signal: controller.signal,
        });
      if (!response.ok) throw new Error(`检测服务返回 ${response.status}`);
      const body = (await response.json()) as { ip?: unknown };
      const ip = typeof body.ip === 'string' ? body.ip : '';
      if (!ip) throw new Error('检测服务未返回出口 IP');
      return { ok: true, ip };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return {
      ok: false,
      message:
        (error as any)?.name === 'AbortError'
          ? '连接超时，请检查代理地址和端口'
          : (error as any)?.message || '无法连接代理',
    };
  }
};

let setupComplete = false;

export const setupProfileNetworkIpc = () => {
  if (setupComplete) return;
  setupComplete = true;

  ipcMain.on('profile-fingerprint-get', (event) => {
    event.returnValue = fingerprintPayload();
  });

  ipcMain.handle('profile-network-get', (event) => {
    requireSettingsSender(event);
    return {
      available: true,
      profileName: activeProfileName,
      // 指纹仅对小号开放:主账号使用真实设备指纹。
      fingerprintSupported: Boolean(activeProfileName),
      fingerprint: fingerprintPayload(),
      proxy: publicProxy(),
    };
  });

  ipcMain.handle('profile-fingerprint-set-enabled', (event, enabled: unknown) => {
    requireSettingsSender(event);
    if (!activeProfileName) return { ok: false, message: '当前不是小号窗口' };
    config.fingerprint.enabled = enabled === true;
    writeConfig(config);
    return { ok: true, fingerprint: fingerprintPayload() };
  });

  ipcMain.handle('profile-fingerprint-regenerate', (event) => {
    requireSettingsSender(event);
    if (!activeProfileName) return { ok: false, message: '当前不是小号窗口' };
    config.fingerprint.seed = makeSeed();
    writeConfig(config);
    return { ok: true, fingerprint: fingerprintPayload() };
  });

  ipcMain.handle('profile-proxy-save', async (event, value: unknown) => {
    requireSettingsSender(event);
    const validation = normalizeProfileProxy(value);
    if (!validation.ok || !validation.settings) {
      return { ok: false, message: validation.error || '代理配置无效' };
    }
    try {
      saveProxy(validation.settings);
      await applyProxyEverywhere(true);
      return { ok: true, proxy: publicProxy() };
    } catch (error) {
      return {
        ok: false,
        message: (error as any)?.message || '保存代理设置失败',
      };
    }
  });

  ipcMain.handle('profile-proxy-test', (event) => {
    requireSettingsSender(event);
    return testProxy();
  });

  // 主账号与小号都需要:启动时把代理应用到所有 session,并抑制 WebRTC 真实 IP 泄漏。
  app.commandLine.appendSwitch(
    'force-webrtc-ip-handling-policy',
    'disable_non_proxied_udp',
  );
  app.on('session-created', (created) => {
    knownSessions.add(created);
    applyProxyToSession(created).catch((error) =>
      console.error('[profile-network] 应用代理失败:', error),
    );
  });
  app.whenReady().then(() =>
    applyProxyEverywhere().catch((error) =>
      console.error('[profile-network] 初始化代理失败:', error),
    ),
  );
};
