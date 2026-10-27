import {
  app,
  ipcMain,
  safeStorage,
  session,
  Session,
  webContents,
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
  IProxyRoutingSettings,
  normalizeProfileProxy,
  ProfileProxyMode,
} from '~/common/profile-network';
import { activeProfileName } from './bootstrap-paths';
import { WEBUI_BASE_URL, WEBUI_URL_SUFFIX } from '~/constants/files';
import { getMainTranslator } from './i18n';
import { Application } from './application';
import {
  getEffectiveProxyCredentials,
  getEffectiveProxyState,
  onEffectiveProxyChanged,
  setProfileProxyBaseline,
} from './proxy-coordinator';
import {
  buildGeneratedProxyPacData,
  getProxyRuleStatus,
  onProxyRuleDataChanged,
  startProxyRuleUpdater,
  testProxyRoute,
  updateProxyRuleData,
} from './proxy-rule-service';
import { DEFAULT_GFWLIST_URL } from '~/common/proxy-routing';

// IPC 回执文案按当前设置的语言即时创建翻译器,不缓存。
const profileNetworkTranslator = () =>
  getMainTranslator(Application.instance.settings?.object?.language);

interface IStoredProxy {
  force: boolean;
  mode: ProfileProxyMode;
  host: string;
  port: number;
  username: string;
  passwordEncrypted?: string;
  passwordPlaintext?: string;
  bypass: string;
  pacScript: string;
  routing: IProxyRoutingSettings;
}

interface IStoredProfileNetwork {
  version: 2;
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
  force: false,
  mode: 'system',
  host: '',
  port: 0,
  username: '',
  bypass: '<local>',
  pacScript: '',
  routing: {
    mode: 'global',
    proxyRules: '',
    directRules: '',
    bypassLocal: true,
    gfwListUrl: DEFAULT_GFWLIST_URL,
  },
};

const makeSeed = () => randomBytes(24).toString('hex');

const defaultConfig = (): IStoredProfileNetwork => ({
  version: 2,
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
  const rawRouting = rawProxy.routing || {};
  const legacyBypass =
    typeof rawProxy.bypass === 'string'
      ? rawProxy.bypass
          .split(',')
          .map((item: string) => item.trim())
          .filter(Boolean)
      : [];
  const proxyMode: ProfileProxyMode =
    rawProxy.mode === 'direct' ||
    rawProxy.mode === 'system' ||
    rawProxy.mode === 'http' ||
    rawProxy.mode === 'socks5' ||
    rawProxy.mode === 'pac'
      ? rawProxy.mode
      : fallback.proxy.mode;
  const config: IStoredProfileNetwork = {
    version: 2,
    fingerprint: {
      enabled: parsed?.fingerprint?.enabled !== false,
      seed,
    },
    proxy: {
      force: rawProxy.force === true,
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
      routing: {
        mode:
          rawRouting.mode === 'gfwlist'
            ? 'bypass_mainland'
            : rawRouting.mode === 'proxy_list' ||
              rawRouting.mode === 'direct_list' ||
              rawRouting.mode === 'bypass_mainland' ||
              rawRouting.mode === 'proxy_mainland'
            ? rawRouting.mode
            : 'global',
        proxyRules:
          typeof rawRouting.proxyRules === 'string'
            ? rawRouting.proxyRules
            : '',
        directRules:
          typeof rawRouting.directRules === 'string'
            ? rawRouting.directRules
            : legacyBypass.filter((item: string) => item !== '<local>').join('\n'),
        bypassLocal:
          typeof rawRouting.bypassLocal === 'boolean'
            ? rawRouting.bypassLocal
            : legacyBypass.length === 0 || legacyBypass.includes('<local>'),
        gfwListUrl:
          typeof rawRouting.gfwListUrl === 'string' && rawRouting.gfwListUrl
            ? rawRouting.gfwListUrl
            : DEFAULT_GFWLIST_URL,
      },
    },
  };
  if (
    !parsed ||
    parsed.version !== 2 ||
    seed !== parsed?.fingerprint?.seed ||
    rawRouting.mode === 'gfwlist'
  ) {
    writeConfig(config);
  }
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
  force: config.proxy.force,
  mode: config.proxy.mode,
  host: config.proxy.host,
  port: config.proxy.port,
  username: config.proxy.username,
  password: decryptPassword(),
  bypass: config.proxy.bypass,
  pacScript: config.proxy.pacScript,
  routing: { ...config.proxy.routing },
});

const fixedProxyBypassRules = () => {
  const rules = config.proxy.routing.directRules
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (config.proxy.routing.bypassLocal) rules.unshift('<local>');
  return rules.join(',');
};

const generatedPacScript = () =>
  buildGeneratedProxyPacData(
    config.proxy.mode as 'http' | 'socks5',
    config.proxy.host,
    config.proxy.port,
    config.proxy.routing,
  );

const electronProxyConfig = (): Electron.ProxyConfig => {
  const mode = config.proxy.mode;
  if (mode === 'direct') return { mode: 'direct' };
  if (mode === 'system') return { mode: 'system' };
  if (mode === 'pac') {
    const script = config.proxy.pacScript.trim();
    // http(s)/file 开头视为 PAC URL,否则当作脚本文本封装为 data URI。
    const pacScript = /^https?:\/\/|^file:\/\//i.test(script)
      ? script
      : `data:application/x-ns-proxy-autoconfig;base64,${Buffer.from(
          script,
          'utf8',
        ).toString('base64')}`;
    return { mode: 'pac_script', pacScript };
  }
  if (config.proxy.routing.mode !== 'global') {
    return { mode: 'pac_script', pacScript: generatedPacScript() };
  }
  return {
    mode: 'fixed_servers',
    proxyRules: `${mode}://${config.proxy.host}:${config.proxy.port}`,
    proxyBypassRules: fixedProxyBypassRules(),
  };
};

const chromeProxyValue = (): any => {
  const mode = config.proxy.mode;
  if (mode === 'direct' || mode === 'system') return { mode };
  if (mode === 'pac') {
    const script = config.proxy.pacScript.trim();
    return {
      mode: 'pac_script',
      pacScript: /^https?:\/\/|^file:\/\//i.test(script)
        ? { url: script }
        : { data: script },
    };
  }
  if (config.proxy.routing.mode !== 'global') {
    return { mode: 'pac_script', pacScript: { url: generatedPacScript() } };
  }
  return {
    mode: 'fixed_servers',
    rules: {
      singleProxy: {
        scheme: mode === 'socks5' ? 'socks5' : 'http',
        host: config.proxy.host,
        port: config.proxy.port,
      },
      bypassList: fixedProxyBypassRules().split(',').filter(Boolean),
    },
  };
};

const profileProxyBaseline = () => {
  const password = decryptPassword();
  return {
    force: config.proxy.force,
    value: chromeProxyValue(),
    config: electronProxyConfig(),
    credentials:
      config.proxy.mode !== 'direct' &&
      config.proxy.mode !== 'system' &&
      (config.proxy.username || password)
        ? { username: config.proxy.username, password }
        : null,
  };
};

const applyProxyToSession = async (target: Session, _closeConnections = false) => {
  await setProfileProxyBaseline(target, profileProxyBaseline());
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
    force: proxy.force,
    mode: proxy.mode,
    host: proxy.host,
    port: proxy.port,
    username: proxy.username,
    passwordEncrypted,
    passwordPlaintext,
    bypass: proxy.bypass,
    pacScript: proxy.pacScript,
    routing: { ...proxy.routing },
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

const proxyControlPayload = async () => {
  const target = session.fromPartition('persist:view');
  const effective = await getEffectiveProxyState(target);
  if (effective.source !== 'extension' || !effective.extensionId) {
    return { source: 'profile' as const };
  }
  const extension = target.getExtension(effective.extensionId);
  return {
    source: 'extension' as const,
    extensionId: effective.extensionId,
    extensionName: extension?.name || effective.extensionId,
    // `system`/`direct` are still extension-owned Chrome proxy settings. Pass
    // the effective mode to the settings UI so it can explain that distinction
    // instead of making an extension's "off" option look like an active proxy.
    mode:
      typeof effective.value?.mode === 'string'
        ? effective.value.mode
        : effective.config.mode,
  };
};

const requireSettingsSender = (event: Electron.IpcMainInvokeEvent) => {
  const senderUrl = event.sender.getURL().split(/[?#]/, 1)[0];
  if (senderUrl !== SETTINGS_URL && senderUrl !== `${SETTINGS_URL}/`) {
    throw new Error(profileNetworkTranslator()('pnetErrSettingsOnly'));
  }
};

const broadcastProxyControl = async () => {
  const payload = await proxyControlPayload();
  for (const contents of webContents.getAllWebContents()) {
    if (contents.isDestroyed()) continue;
    const contentsUrl = contents.getURL().split(/[?#]/, 1)[0];
    if (contentsUrl === SETTINGS_URL || contentsUrl === `${SETTINGS_URL}/`) {
      contents.send('profile-proxy-control-changed', payload);
    }
  }
};

export const getActiveProxyCredentials = (target?: Session) =>
  getEffectiveProxyCredentials(target || session.fromPartition('persist:view'));

const testProxy = async (): Promise<{
  ok: boolean;
  ip?: string;
  message?: string;
}> => {
  const t = profileNetworkTranslator();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await session
        .fromPartition('persist:view')
        .fetch('https://api.ipify.org?format=json', {
          signal: controller.signal,
        });
      if (!response.ok)
        throw new Error(
          t('pnetErrDetectStatus', { status: response.status }),
        );
      const body = (await response.json()) as { ip?: unknown };
      const ip = typeof body.ip === 'string' ? body.ip : '';
      if (!ip) throw new Error(t('pnetErrNoIp'));
      return { ok: true, ip };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return {
      ok: false,
      message:
        (error as any)?.name === 'AbortError'
          ? t('pnetErrTimeout')
          : (error as any)?.message || t('pnetErrConnect'),
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

  ipcMain.handle('profile-network-get', async (event) => {
    requireSettingsSender(event);
    return {
      available: true,
      profileName: activeProfileName,
      // 指纹仅对小号开放:主账号使用真实设备指纹。
      fingerprintSupported: Boolean(activeProfileName),
      fingerprint: fingerprintPayload(),
      proxy: publicProxy(),
      proxyControl: await proxyControlPayload(),
      proxyRuleStatus: getProxyRuleStatus(),
    };
  });

  ipcMain.handle(
    'profile-fingerprint-set-enabled',
    (event, enabled: unknown) => {
      requireSettingsSender(event);
      if (!activeProfileName) {
        return {
          ok: false,
          message: profileNetworkTranslator()('pnetErrNotAltWindow'),
        };
      }
      config.fingerprint.enabled = enabled === true;
      writeConfig(config);
      return { ok: true, fingerprint: fingerprintPayload() };
    },
  );

  ipcMain.handle('profile-fingerprint-regenerate', (event) => {
    requireSettingsSender(event);
    if (!activeProfileName) {
      return {
        ok: false,
        message: profileNetworkTranslator()('pnetErrNotAltWindow'),
      };
    }
    config.fingerprint.seed = makeSeed();
    writeConfig(config);
    return { ok: true, fingerprint: fingerprintPayload() };
  });

  ipcMain.handle('profile-proxy-save', async (event, value: unknown) => {
    const t = profileNetworkTranslator();
    requireSettingsSender(event);
    const validation = normalizeProfileProxy(value);
    if (!validation.ok || !validation.settings) {
      // common 模块返回消息 key,此处按当前语言翻译后回传渲染层。
      return {
        ok: false,
        message: validation.error
          ? t(validation.error, {
              line: validation.errorLine || 0,
            })
          : t('pnetErrInvalidProxy'),
      };
    }
    try {
      saveProxy(validation.settings);
      await applyProxyEverywhere(true);
      return {
        ok: true,
        proxy: publicProxy(),
        proxyControl: await proxyControlPayload(),
      };
    } catch (error) {
      return {
        ok: false,
        message: (error as any)?.message || t('sysProxySaveFailed'),
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

  ipcMain.handle('profile-proxy-route-test', (event, input: unknown) => {
    requireSettingsSender(event);
    return testProxyRoute(
      typeof input === 'string' ? input : '',
      config.proxy.routing,
    );
  });

  ipcMain.handle('profile-proxy-rules-update', async (event) => {
    requireSettingsSender(event);
    const status = await updateProxyRuleData(
      config.proxy.routing.gfwListUrl,
      true,
    );
    return { ok: !status.lastError, status, message: status.lastError };
  });
  app.whenReady().then(() => {
    // Electron 43 forbids resolving a Session before app.ready. Install the
    // coordinator listener here rather than during synchronous IPC setup.
    onEffectiveProxyChanged(session.fromPartition('persist:view'), () => {
      void broadcastProxyControl().catch((error) =>
        console.error('[profile-network] 广播代理控制权失败:', error),
      );
    });
    onProxyRuleDataChanged(() => {
      void applyProxyEverywhere(true).catch((error) =>
        console.error('[profile-network] 更新路由规则失败:', error),
      );
    });
    startProxyRuleUpdater(() => config.proxy.routing.gfwListUrl);
    return applyProxyEverywhere().catch((error) =>
      console.error('[profile-network] 初始化代理失败:', error),
    );
  });
};
