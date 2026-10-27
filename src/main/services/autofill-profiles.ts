// Chrome 式「地址及更多」「付款方式」主进程服务。
//
// 数据落在 storage scope 'autofillProfiles'(与密码 formfill 分库,不触发密码云同步)。
// 银行卡号只以 safeStorage(DPAPI)密文存储;渲染进程永远只拿到摘要(后四位/卡组织/
// 有效期/持卡人),明文只在「设置页显示卡号(需 Windows 验证)」与「网页填充」两处
// 由主进程临时解密。CVC 不保存。
import { createHmac, randomBytes } from 'crypto';
import { safeStorage } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';

import {
  AutofillFieldType,
  AutofillKind,
  CardNetwork,
  IAddressFields,
  IAddressProfile,
  IAutofillProfilesList,
  IAutofillSuggestion,
  ICardSaveInput,
  ICardSummary,
  IFormFillData,
  IStoredCard,
} from '~/interfaces';
import { Application } from '~/main/application';
import { getMainTranslator } from '~/main/i18n';
import { verifyWindowsUser } from '~/main/utils/windows-user-verification';
import { getTrustedWebUIHost } from '~/common/webui-bridge-policy';

const SCOPE = 'autofillProfiles';
const MAX_FIELD_LENGTH = 512;

const ADDRESS_KEYS: (keyof IAddressFields)[] = [
  'name',
  'organization',
  'street',
  'city',
  'state',
  'postCode',
  'country',
  'phone',
  'email',
];

const storage = () => Application.instance.storage;
const settings = () => Application.instance.settings.object;
const translator = () => getMainTranslator(settings()?.language);

// ── 卡号工具 ──

export const normalizeCardNumber = (value: unknown) =>
  typeof value === 'string' ? value.replace(/[\s-]/g, '') : '';

export const luhnValid = (num: string) => {
  if (!/^\d{12,19}$/.test(num)) return false;
  let sum = 0;
  let double = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let digit = num.charCodeAt(i) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
};

export const detectNetwork = (num: string): CardNetwork => {
  if (/^62/.test(num)) return 'unionpay';
  if (/^4/.test(num)) return 'visa';
  if (/^3[47]/.test(num)) return 'amex';
  if (/^35(2[89]|[3-8])/.test(num)) return 'jcb';
  if (/^3(0[0-5]|[689])/.test(num)) return 'diners';
  if (/^(6011|65|64[4-9])/.test(num)) return 'discover';
  if (/^5[1-5]/.test(num)) return 'mastercard';
  const prefix4 = Number(num.slice(0, 4));
  if (prefix4 >= 2221 && prefix4 <= 2720) return 'mastercard';
  return 'unknown';
};

const NETWORK_LABELS: Record<CardNetwork, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  unionpay: 'UnionPay',
  jcb: 'JCB',
  discover: 'Discover',
  diners: 'Diners Club',
  unknown: '',
};

const encryptionAvailable = () => {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
};

const encrypt = (value: string) =>
  safeStorage.encryptString(value).toString('base64');

const decrypt = (value: string): string | null => {
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'));
  } catch {
    return null;
  }
};

// 指纹盐:随机生成后以 safeStorage 密文存于同库 meta 文档,用于卡号去重。
let saltPromise: Promise<Buffer | null> | null = null;
const getSalt = () => {
  saltPromise ??= (async () => {
    if (!encryptionAvailable()) return null;
    const meta = await storage().findOne<{ _id?: string; saltEnc?: string }>({
      scope: SCOPE,
      query: { type: 'meta' },
    });
    if (meta?.saltEnc) {
      const plain = decrypt(meta.saltEnc);
      if (plain) return Buffer.from(plain, 'base64');
    }
    const salt = randomBytes(32);
    const saltEnc = encrypt(salt.toString('base64'));
    if (meta?._id) {
      await storage().update({ scope: SCOPE, query: { _id: meta._id }, value: { saltEnc } });
    } else {
      await storage().insert({ scope: SCOPE, item: { type: 'meta', saltEnc } });
    }
    return salt;
  })().catch((error) => {
    saltPromise = null;
    throw error;
  });
  return saltPromise;
};

const fingerprintOf = async (num: string) => {
  const salt = await getSalt();
  if (!salt) return '';
  return createHmac('sha256', salt).update(num).digest('hex');
};

// ── 归一化 ──

const clean = (value: unknown, max = MAX_FIELD_LENGTH) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const sanitizeAddress = (input: any): IAddressFields => {
  const fields: IAddressFields = {};
  for (const key of ADDRESS_KEYS) {
    const value = clean(input?.[key], key === 'street' ? 1024 : MAX_FIELD_LENGTH);
    if (value) fields[key] = value;
  }
  return fields;
};

const hasAddressContent = (fields: IAddressFields) =>
  ADDRESS_KEYS.some((key) => !!fields[key]);

const normalizeExpMonth = (value: unknown) => {
  const n = Number(String(value || '').replace(/\D/g, ''));
  return n >= 1 && n <= 12 ? String(n).padStart(2, '0') : '';
};

const normalizeExpYear = (value: unknown) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 2) return `20${digits}`;
  if (digits.length === 4 && digits.startsWith('20')) return digits;
  return '';
};

const addressKey = (fields: IAddressFields) =>
  [fields.name, fields.street, fields.phone]
    .map((value) => (value || '').toLowerCase().replace(/[\s,，.。-]/g, ''))
    .join('|');

const toSummary = (card: IStoredCard): ICardSummary => ({
  _id: card._id || '',
  last4: card.last4,
  network: card.network,
  expMonth: card.expMonth,
  expYear: card.expYear,
  holderName: card.holderName,
  nickname: card.nickname,
  updatedAt: card.updatedAt,
  undecryptable: decrypt(card.numberEnc) === null,
});

const byFrecency = <T extends { useCount: number; lastUsedAt: number; updatedAt: number }>(
  a: T,
  b: T,
) =>
  (b.useCount || 0) - (a.useCount || 0) ||
  (b.lastUsedAt || 0) - (a.lastUsedAt || 0) ||
  (b.updatedAt || 0) - (a.updatedAt || 0);

// ── 读写 ──

const findAddresses = () =>
  storage().find<IAddressProfile>({ scope: SCOPE, query: { type: 'address' } });

const findCards = () =>
  storage().find<IStoredCard>({ scope: SCOPE, query: { type: 'card' } });

export const listProfiles = async (): Promise<IAutofillProfilesList> => {
  const [addresses, cards] = await Promise.all([findAddresses(), findCards()]);
  return {
    addresses: addresses.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
    cards: cards
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .map(toSummary),
  };
};

const notifySettingsViews = () => {
  for (const owner of Application.instance.windows.list) {
    const settingsView = owner.viewManager.settingsView;
    if (settingsView && !settingsView.webContents.isDestroyed()) {
      settingsView.webContents.send('autofill-profiles-changed');
    }
  }
};

export const saveAddress = async (
  id: string | undefined,
  input: any,
): Promise<{ ok: boolean; msg?: string; id?: string }> => {
  const fields = sanitizeAddress(input);
  if (!hasAddressContent(fields)) return { ok: false, msg: 'empty' };
  const now = Date.now();
  if (id) {
    const replaced = await storage().update({
      scope: SCOPE,
      query: { _id: id, type: 'address' },
      value: { fields, updatedAt: now },
    });
    if (!replaced) return { ok: false, msg: 'not-found' };
    notifySettingsViews();
    return { ok: true, id };
  }
  const doc = await storage().insert<IAddressProfile>({
    scope: SCOPE,
    item: {
      type: 'address',
      createdAt: now,
      updatedAt: now,
      useCount: 0,
      lastUsedAt: 0,
      fields,
    },
  });
  notifySettingsViews();
  return { ok: true, id: doc?._id };
};

export const saveCard = async (
  input: ICardSaveInput,
): Promise<{ ok: boolean; msg?: string; id?: string }> => {
  const t = translator();
  const expMonth = normalizeExpMonth(input?.expMonth);
  const expYear = normalizeExpYear(input?.expYear);
  const holderName = clean(input?.holderName, 128);
  const nickname = clean(input?.nickname, 64);
  const number = normalizeCardNumber(input?.number);
  const now = Date.now();

  if (number && !luhnValid(number)) {
    return { ok: false, msg: t('autofillCardInvalid') };
  }
  if (number && !encryptionAvailable()) {
    return { ok: false, msg: t('autofillEncryptionUnavailable') };
  }

  const id = typeof input?._id === 'string' ? input._id : '';
  if (id) {
    const value: Partial<IStoredCard> = {
      expMonth,
      expYear,
      holderName,
      nickname,
      updatedAt: now,
    };
    if (number) {
      value.numberEnc = encrypt(number);
      value.fingerprint = await fingerprintOf(number);
      value.last4 = number.slice(-4);
      value.network = detectNetwork(number);
    }
    const replaced = await storage().update({
      scope: SCOPE,
      query: { _id: id, type: 'card' },
      value,
    });
    if (!replaced) return { ok: false, msg: 'not-found' };
    notifySettingsViews();
    return { ok: true, id };
  }

  if (!number) return { ok: false, msg: t('autofillCardInvalid') };
  const fingerprint = await fingerprintOf(number);
  const existing = fingerprint
    ? await storage().findOne<IStoredCard>({
        scope: SCOPE,
        query: { type: 'card', fingerprint },
      })
    : null;
  if (existing?._id) {
    await storage().update({
      scope: SCOPE,
      query: { _id: existing._id },
      value: {
        expMonth: expMonth || existing.expMonth,
        expYear: expYear || existing.expYear,
        holderName: holderName || existing.holderName,
        nickname: nickname || existing.nickname,
        updatedAt: now,
      },
    });
    notifySettingsViews();
    return { ok: true, id: existing._id };
  }

  const doc = await storage().insert<IStoredCard>({
    scope: SCOPE,
    item: {
      type: 'card',
      createdAt: now,
      updatedAt: now,
      useCount: 0,
      lastUsedAt: 0,
      numberEnc: encrypt(number),
      fingerprint,
      last4: number.slice(-4),
      network: detectNetwork(number),
      expMonth,
      expYear,
      holderName,
      nickname,
    },
  });
  notifySettingsViews();
  return { ok: true, id: doc?._id };
};

export const removeProfile = async (id: string) => {
  if (typeof id !== 'string' || !id) return false;
  const removed = await storage().remove({
    scope: SCOPE,
    query: { _id: id, type: { $in: ['address', 'card'] } },
  });
  if (removed) notifySettingsViews();
  return removed > 0;
};

// 保存提示判重:地址按 姓名+详细地址+电话 归一比对;卡按指纹。
export const findExistingAddress = async (fields: IAddressFields) => {
  const key = addressKey(fields);
  return (await findAddresses()).find((item) => addressKey(item.fields) === key);
};

export const findExistingCard = async (number: string) => {
  const fingerprint = await fingerprintOf(number);
  if (!fingerprint) return null;
  return storage().findOne<IStoredCard>({
    scope: SCOPE,
    query: { type: 'card', fingerprint },
  });
};

export const isEncryptionAvailable = encryptionAvailable;

// ── 网页建议与填充 ──

const ADDRESS_FIELD_SOURCE: Partial<Record<AutofillFieldType, keyof IAddressFields>> = {
  name: 'name',
  organization: 'organization',
  street: 'street',
  'address-line1': 'street',
  city: 'city',
  state: 'state',
  postCode: 'postCode',
  country: 'country',
  phone: 'phone',
  email: 'email',
};

const splitName = (name: string) => {
  const value = name.trim();
  if (!value) return { given: '', family: '' };
  // 中文姓名:首字为姓(复姓不做猜测);西文姓名:末段为姓。
  if (/^[一-龥]{2,4}$/.test(value)) {
    return { family: value.slice(0, 1), given: value.slice(1) };
  }
  const parts = value.split(/\s+/);
  if (parts.length === 1) return { given: value, family: '' };
  return { given: parts.slice(0, -1).join(' '), family: parts[parts.length - 1] };
};

const addressValueFor = (fields: IAddressFields, type: AutofillFieldType) => {
  if (type === 'given-name') return splitName(fields.name || '').given;
  if (type === 'family-name') return splitName(fields.name || '').family;
  if (type === 'address-line2') return '';
  const key = ADDRESS_FIELD_SOURCE[type];
  return key ? fields[key] || '' : '';
};

const addressSublabel = (fields: IAddressFields, focused: AutofillFieldType) => {
  const parts = [fields.state, fields.city, fields.street].filter(Boolean).join(' ');
  if (focused === 'phone') return fields.name ? `${fields.name} ${parts}` : parts;
  return parts || fields.phone || fields.email || '';
};

export const getSuggestions = async (
  kind: AutofillKind,
  focused: AutofillFieldType,
  prefix: string,
): Promise<IAutofillSuggestion[]> => {
  const query = clean(prefix, 128).toLowerCase();
  if (kind === 'address') {
    if (!settings().autofillAddresses) return [];
    const addresses = (await findAddresses()).sort(byFrecency);
    return addresses
      .map((item) => {
        const value = addressValueFor(item.fields, focused) || item.fields.name || '';
        return {
          id: item._id || '',
          kind,
          label: value,
          sublabel: addressSublabel(item.fields, focused),
        };
      })
      .filter((item) => item.label && (!query || item.label.toLowerCase().startsWith(query)))
      .slice(0, 6);
  }

  if (!settings().autofillPayments) return [];
  const cards = (await findCards()).sort(byFrecency);
  return cards
    .filter((card) => decrypt(card.numberEnc) !== null)
    .map((card) => {
      const networkLabel = NETWORK_LABELS[card.network] || '';
      const masked = `•••• ${card.last4}`;
      const head = card.nickname || networkLabel;
      const exp =
        card.expMonth && card.expYear
          ? `${card.expMonth}/${card.expYear.slice(-2)}`
          : '';
      return {
        id: card._id || '',
        kind,
        label: head ? `${head} ${masked}` : masked,
        sublabel: [card.holderName, exp].filter(Boolean).join(' · '),
        network: card.network,
      };
    })
    .slice(0, 6);
};

export const getFillValues = async (
  kind: AutofillKind,
  id: string,
  types: AutofillFieldType[],
): Promise<Partial<Record<AutofillFieldType, string>> | null> => {
  const wanted = Array.isArray(types)
    ? types.filter((type) => typeof type === 'string').slice(0, 64)
    : [];
  const values: Partial<Record<AutofillFieldType, string>> = {};

  if (kind === 'address') {
    if (!settings().autofillAddresses) return null;
    const item = await storage().findOne<IAddressProfile>({
      scope: SCOPE,
      query: { _id: id, type: 'address' },
    });
    if (!item) return null;
    for (const type of wanted) {
      const value = addressValueFor(item.fields, type);
      if (value) values[type] = value;
    }
    void bumpUsage(id);
    return values;
  }

  if (!settings().autofillPayments) return null;
  const card = await storage().findOne<IStoredCard>({
    scope: SCOPE,
    query: { _id: id, type: 'card' },
  });
  if (!card) return null;
  for (const type of wanted) {
    switch (type) {
      case 'cc-number': {
        const number = decrypt(card.numberEnc);
        if (number) values[type] = number;
        break;
      }
      case 'cc-name':
        if (card.holderName) values[type] = card.holderName;
        break;
      case 'cc-exp':
        if (card.expMonth && card.expYear) {
          values[type] = `${card.expMonth}/${card.expYear.slice(-2)}`;
        }
        break;
      case 'cc-exp-month':
        if (card.expMonth) values[type] = card.expMonth;
        break;
      case 'cc-exp-year':
        if (card.expYear) values[type] = card.expYear;
        break;
      default:
        // cc-csc 等不填
        break;
    }
  }
  void bumpUsage(id);
  return values;
};

const bumpUsage = async (id: string) => {
  try {
    const item = await storage().findOne<{ useCount?: number }>({
      scope: SCOPE,
      query: { _id: id },
    });
    if (!item) return;
    await storage().update({
      scope: SCOPE,
      query: { _id: id },
      value: { useCount: (item.useCount || 0) + 1, lastUsedAt: Date.now() },
    });
  } catch {
    // 使用计数仅影响排序
  }
};

// ── 迁移旧 formfill 地址 ──

const migrateLegacyAddresses = async () => {
  const legacy = await storage().find<IFormFillData>({
    scope: 'formfill',
    query: { type: 'address' },
  });
  if (!legacy.length) return;
  const now = Date.now();
  for (const item of legacy) {
    const f = item.fields || {};
    const fields = sanitizeAddress({
      name: f.name,
      street: f.address,
      postCode: f.postCode,
      city: f.city,
      phone: f.phone,
      email: f.email,
      country: f.country,
    });
    if (hasAddressContent(fields)) {
      await storage().insert({
        scope: SCOPE,
        item: {
          type: 'address',
          createdAt: item.updatedAt || now,
          updatedAt: item.updatedAt || now,
          useCount: 0,
          lastUsedAt: 0,
          fields,
        },
      });
    }
  }
  await storage().remove({ scope: 'formfill', query: { type: 'address' }, multi: true });
};

// ── IPC ──

const isSettingsSender = (event: IpcMainInvokeEvent | IpcMainEvent) => {
  try {
    return getTrustedWebUIHost(event.sender.getURL()) === 'settings';
  } catch {
    return false;
  }
};

export const findPageSource = (webContentsId: number) => {
  for (const owner of Application.instance.windows.list) {
    const view = owner.viewManager.findViewByWebContentsId(webContentsId);
    if (view) return { owner, view };
  }
  return null;
};

const isPageSender = (event: IpcMainInvokeEvent | IpcMainEvent) => {
  const source = findPageSource(event.sender.id);
  if (!source) return false;
  const url = event.senderFrame?.url || event.sender.getURL();
  return /^https?:/i.test(url || '');
};

let registered = false;

export const registerAutofillProfilesIpc = (
  ipc: {
    handle: (
      channel: string,
      listener: (event: IpcMainInvokeEvent, ...args: any[]) => any,
    ) => void;
  },
) => {
  if (registered) return;
  registered = true;

  setTimeout(() => {
    migrateLegacyAddresses().catch((error) =>
      console.error('[autofill-profiles] migrate legacy addresses failed', error),
    );
  }, 3000);

  ipc.handle('autofill-profiles-list', async (event) => {
    if (!isSettingsSender(event)) return { addresses: [], cards: [] };
    return listProfiles();
  });

  ipc.handle('autofill-address-save', async (event, id: string, fields: any) => {
    if (!isSettingsSender(event)) return { ok: false };
    return saveAddress(typeof id === 'string' ? id : undefined, fields);
  });

  ipc.handle('autofill-card-save', async (event, input: ICardSaveInput) => {
    if (!isSettingsSender(event)) return { ok: false };
    return saveCard(input);
  });

  ipc.handle('autofill-profile-remove', async (event, id: string) => {
    if (!isSettingsSender(event)) return false;
    return removeProfile(id);
  });

  ipc.handle('autofill-card-reveal', async (event, id: string) => {
    if (!isSettingsSender(event)) return { ok: false, number: '', msg: '' };
    const card = await storage().findOne<IStoredCard>({
      scope: SCOPE,
      query: { _id: id, type: 'card' },
    });
    if (!card) return { ok: false, number: '', msg: '' };
    const verification = await verifyWindowsUser(
      translator()('autofillCardRevealVerify'),
    );
    if (!verification.ok) return { ok: false, number: '', msg: verification.msg };
    const number = decrypt(card.numberEnc);
    if (!number) {
      return { ok: false, number: '', msg: translator()('autofillCardUndecryptable') };
    }
    return { ok: true, number, msg: '' };
  });

  ipc.handle(
    'autofill-suggestions',
    async (event, kind: AutofillKind, focused: AutofillFieldType, prefix: string) => {
      if (!isPageSender(event)) return [];
      if (kind !== 'address' && kind !== 'card') return [];
      return getSuggestions(kind, focused, prefix);
    },
  );

  ipc.handle(
    'autofill-fill-values',
    async (event, kind: AutofillKind, id: string, types: AutofillFieldType[]) => {
      if (!isPageSender(event)) return null;
      if (kind !== 'address' && kind !== 'card') return null;
      if (typeof id !== 'string' || !id) return null;
      return getFillValues(kind, id, types);
    },
  );
};
