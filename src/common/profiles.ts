export const PROFILE_ARG_PREFIX = '--rainsee-profile=';
export const PROFILE_ONBOARDING_SKIPPED_NOTICE =
  'profile-onboarding-skipped-notice';
export const PROFILE_ONBOARDING_SKIPPED_NOTICE_SHOWN =
  'profile-onboarding-skipped-notice-shown';

import type { MessageKey } from './i18n';

export interface IProfileNameValidation {
  ok: boolean;
  name?: string;
  // 消息 key(由调用方在展示边界翻译;本模块保持无 Electron 依赖)
  error?: MessageKey;
}

export interface IParsedProfileArgument {
  present: boolean;
  name: string | null;
  // 消息 key(由展示边界翻译;launcher 等非 UI 消费方当普通字符串处理)
  error?: MessageKey;
}

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export const validateProfileName = (value: unknown): IProfileNameValidation => {
  if (typeof value !== 'string') {
    return { ok: false, error: 'profileNameRequired' };
  }

  const name = value.trim().normalize('NFC');
  if (!name) return { ok: false, error: 'profileNameRequired' };
  if (Array.from(name).length > 40) {
    return { ok: false, error: 'profileNameTooLong' };
  }
  if (name === '.' || name === '..') {
    return { ok: false, error: 'profileNameDotOnly' };
  }
  if (/^[.]/.test(name)) {
    return { ok: false, error: 'profileNameLeadingDot' };
  }
  if (/[\x00-\x1f\x7f]/.test(name)) {
    return { ok: false, error: 'profileNameControlChars' };
  }
  if (/[\\/:*?"<>|]/.test(name)) {
    return { ok: false, error: 'profileNameForbiddenChars' };
  }
  if (/[. ]$/.test(name)) {
    return { ok: false, error: 'profileNameTrailingDotSpace' };
  }
  if (WINDOWS_RESERVED_NAME.test(name)) {
    return { ok: false, error: 'profileNameReserved' };
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
    return { present: true, name: null, error: 'profileStartupArgCorrupted' };
  }

  const validation = validateProfileName(decoded);
  return validation.ok
    ? { present: true, name: validation.name || null }
    : { present: true, name: null, error: validation.error };
};

export const profileNameKey = (name: string): string =>
  name.normalize('NFC').toLowerCase();
