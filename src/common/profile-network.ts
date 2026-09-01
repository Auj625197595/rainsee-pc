export type ProfileProxyMode = 'direct' | 'system' | 'http' | 'socks5' | 'pac';

export interface IProfileProxySettings {
  mode: ProfileProxyMode;
  host: string;
  port: number;
  username: string;
  password: string;
  bypass: string;
  pacScript: string;
}

export interface IProfileFingerprint {
  enabled: boolean;
  id: string;
  hardwareConcurrency: number;
  deviceMemory: number;
  canvasSalt: number;
  webglVendor: string;
  webglRenderer: string;
}

export interface IProxyValidationResult {
  ok: boolean;
  settings?: IProfileProxySettings;
  // 消息 key(由调用方在展示边界翻译;本模块保持无 Electron 依赖)
  error?: import('./i18n').MessageKey;
}

const hashText = (value: string): number => {
  let hash = 2166136261;
  for (const character of Array.from(value)) {
    hash ^= character.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
};

const pick = <T>(values: T[], hash: number, shift: number): T =>
  values[(hash >>> shift) % values.length];

export const deriveProfileFingerprint = (
  seed: string,
  platform: string,
  enabled = true,
): IProfileFingerprint => {
  const hash = hashText(seed || 'rainsee-profile');
  const gpu =
    platform === 'darwin'
      ? pick(
          [
            ['Apple Inc.', 'Apple M1'],
            ['Apple Inc.', 'Apple M2'],
            ['Apple Inc.', 'Apple M3'],
          ],
          hash,
          6,
        )
      : platform === 'linux'
      ? pick(
          [
            ['Google Inc. (Intel)', 'ANGLE (Intel, Mesa Intel(R) Graphics)'],
            ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon Graphics)'],
            ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce Graphics)'],
          ],
          hash,
          6,
        )
      : pick(
          [
            ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11)'],
            ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11)'],
            ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX Direct3D11)'],
            ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX Direct3D11)'],
          ],
          hash,
          6,
        );

  return {
    enabled,
    id: hash.toString(16).padStart(8, '0').toUpperCase(),
    hardwareConcurrency: pick([4, 8, 12, 16], hash, 2),
    deviceMemory: pick([4, 8, 16], hash, 4),
    canvasSalt: hash || 1,
    webglVendor: gpu[0],
    webglRenderer: gpu[1],
  };
};

export const normalizeProfileProxy = (
  value: unknown,
): IProxyValidationResult => {
  if (!value || typeof value !== 'object') {
    return { ok: false, error: 'pnetErrInvalidProxy' };
  }
  const raw = value as Record<string, unknown>;
  const mode = raw.mode;
  if (
    mode !== 'direct' &&
    mode !== 'system' &&
    mode !== 'http' &&
    mode !== 'socks5' &&
    mode !== 'pac'
  ) {
    return { ok: false, error: 'pnetErrInvalidType' };
  }
  if (mode === 'system') {
    return {
      ok: true,
      settings: {
        mode,
        host: '',
        port: 0,
        username: '',
        password: '',
        bypass: '<local>',
        pacScript: '',
      },
    };
  }

  if (mode === 'direct') {
    return {
      ok: true,
      settings: {
        mode,
        host: typeof raw.host === 'string' ? raw.host.trim() : '',
        port: Number.isInteger(Number(raw.port)) ? Number(raw.port) : 0,
        username:
          typeof raw.username === 'string' ? raw.username.trim() : '',
        password: typeof raw.password === 'string' ? raw.password : '',
        bypass:
          typeof raw.bypass === 'string' ? raw.bypass.trim() : '<local>',
        pacScript: '',
      },
    };
  }

  if (mode === 'pac') {
    const pacScript =
      typeof raw.pacScript === 'string' ? raw.pacScript.trim() : '';
    if (!pacScript) {
      return { ok: false, error: 'pnetErrPacRequired' };
    }
    const isUrl = /^https?:\/\/|^file:\/\//i.test(pacScript);
    // 非_URL 时必须是含 FindProxyForURL 的脚本文本。
    if (!isUrl && !/FindProxyForURL/.test(pacScript)) {
      return { ok: false, error: 'pnetErrPacMissingFn' };
    }
    if (pacScript.length > 200000) {
      return { ok: false, error: 'pnetErrPacTooLong' };
    }
    const bypass =
      typeof raw.bypass === 'string' ? raw.bypass.trim() : '<local>';
    if (bypass.length > 1000 || /[\r\n]/.test(bypass)) {
      return { ok: false, error: 'pnetErrBypassInvalid' };
    }
    return {
      ok: true,
      settings: {
        mode,
        host: '',
        port: 0,
        username: '',
        password: '',
        bypass,
        pacScript,
      },
    };
  }

  const host = typeof raw.host === 'string' ? raw.host.trim() : '';
  if (!host) return { ok: false, error: 'pnetErrHostRequired' };
  if (host.length > 253 || /\s|:\/\/|[/?#@]/.test(host)) {
    return { ok: false, error: 'pnetErrHostInvalid' };
  }
  if (host.includes(':') && !/^\[[0-9a-f:]+\]$/i.test(host)) {
    return { ok: false, error: 'pnetErrIpv6Brackets' };
  }

  const port = Number(raw.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: 'pnetErrPortRange' };
  }

  const username = typeof raw.username === 'string' ? raw.username.trim() : '';
  const password = typeof raw.password === 'string' ? raw.password : '';
  const bypass = typeof raw.bypass === 'string' ? raw.bypass.trim() : '';
  if (username.length > 200 || password.length > 200) {
    return { ok: false, error: 'pnetErrCredentialTooLong' };
  }
  if (bypass.length > 1000 || /[\r\n]/.test(bypass)) {
    return { ok: false, error: 'pnetErrBypassInvalid' };
  }

  return {
    ok: true,
    settings: { mode, host, port, username, password, bypass, pacScript: '' },
  };
};
