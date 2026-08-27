export const PROFILE_ARG_PREFIX = '--rainsee-profile=';
export const PROFILE_ONBOARDING_SKIPPED_NOTICE =
  'profile-onboarding-skipped-notice';
export const PROFILE_ONBOARDING_SKIPPED_NOTICE_SHOWN =
  'profile-onboarding-skipped-notice-shown';

export interface IProfileNameValidation {
  ok: boolean;
  name?: string;
  error?: string;
}

export interface IParsedProfileArgument {
  present: boolean;
  name: string | null;
  error?: string;
}

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export const validateProfileName = (value: unknown): IProfileNameValidation => {
  if (typeof value !== 'string') {
    return { ok: false, error: '请输入窗口名' };
  }

  const name = value.trim().normalize('NFC');
  if (!name) return { ok: false, error: '请输入窗口名' };
  if (Array.from(name).length > 40) {
    return { ok: false, error: '窗口名不能超过 40 个字符' };
  }
  if (name === '.' || name === '..') {
    return { ok: false, error: '窗口名不能使用 . 或 ..' };
  }
  if (/^[.]/.test(name)) {
    return { ok: false, error: '窗口名不能以点开头' };
  }
  if (/[\x00-\x1f\x7f]/.test(name)) {
    return { ok: false, error: '窗口名不能包含控制字符' };
  }
  if (/[\\/:*?"<>|]/.test(name)) {
    return { ok: false, error: '窗口名不能包含 \\ / : * ? " < > |' };
  }
  if (/[. ]$/.test(name)) {
    return { ok: false, error: '窗口名不能以点或空格结尾' };
  }
  if (WINDOWS_RESERVED_NAME.test(name)) {
    return { ok: false, error: '该窗口名是系统保留名称' };
  }

  return { ok: true, name };
};

export const getProfileArgument = (name: string): string =>
  `${PROFILE_ARG_PREFIX}${encodeURIComponent(name)}`;

export const parseProfileArgument = (
  argv: string[],
): IParsedProfileArgument => {
  const argument = argv.find((item) => item.startsWith(PROFILE_ARG_PREFIX));
  if (!argument) return { present: false, name: null };

  const encoded = argument.slice(PROFILE_ARG_PREFIX.length);
  let decoded = '';
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    return { present: true, name: null, error: '小号启动参数已损坏' };
  }

  const validation = validateProfileName(decoded);
  return validation.ok
    ? { present: true, name: validation.name || null }
    : { present: true, name: null, error: validation.error };
};

export const profileNameKey = (name: string): string =>
  name.normalize('NFC').toLowerCase();
