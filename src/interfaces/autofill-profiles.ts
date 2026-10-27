// Chrome 式「地址及更多」「付款方式」数据模型。
// 存储在 storage scope 'autofillProfiles'(与密码的 formfill 分库)。

export type CardNetwork =
  | 'visa'
  | 'mastercard'
  | 'amex'
  | 'unionpay'
  | 'jcb'
  | 'discover'
  | 'diners'
  | 'unknown';

export interface IAddressFields {
  name?: string;
  organization?: string;
  street?: string;
  city?: string;
  state?: string;
  postCode?: string;
  country?: string;
  phone?: string;
  email?: string;
}

export interface IAddressProfile {
  _id?: string;
  type: 'address';
  createdAt: number;
  updatedAt: number;
  useCount: number;
  lastUsedAt: number;
  fields: IAddressFields;
}

// 仅主进程可见:numberEnc 为 safeStorage 密文(base64),fingerprint 为 HMAC 去重键。
export interface IStoredCard {
  _id?: string;
  type: 'card';
  createdAt: number;
  updatedAt: number;
  useCount: number;
  lastUsedAt: number;
  numberEnc: string;
  fingerprint: string;
  last4: string;
  network: CardNetwork;
  expMonth: string;
  expYear: string;
  holderName: string;
  nickname: string;
}

// 发给渲染进程的银行卡摘要(永不含完整卡号)。
export interface ICardSummary {
  _id: string;
  last4: string;
  network: CardNetwork;
  expMonth: string;
  expYear: string;
  holderName: string;
  nickname: string;
  updatedAt: number;
  // 密文无法解密(换机器/换 Windows 用户),只能删除。
  undecryptable?: boolean;
}

export interface IAutofillProfilesList {
  addresses: IAddressProfile[];
  cards: ICardSummary[];
}

export interface ICardSaveInput {
  _id?: string;
  // 编辑时不传即保留原卡号。
  number?: string;
  expMonth: string;
  expYear: string;
  holderName: string;
  nickname: string;
}

export type AutofillAddressFieldType =
  | 'name'
  | 'given-name'
  | 'family-name'
  | 'organization'
  | 'street'
  | 'address-line1'
  | 'address-line2'
  | 'city'
  | 'state'
  | 'postCode'
  | 'country'
  | 'phone'
  | 'email';

export type AutofillCardFieldType =
  | 'cc-number'
  | 'cc-name'
  | 'cc-exp'
  | 'cc-exp-month'
  | 'cc-exp-year'
  | 'cc-csc';

export type AutofillFieldType = AutofillAddressFieldType | AutofillCardFieldType;

export type AutofillKind = 'address' | 'card';

export interface IAutofillSuggestion {
  id: string;
  kind: AutofillKind;
  label: string;
  sublabel: string;
  network?: CardNetwork;
}

// 网页提交表单后发往主进程的保存候选。
export interface IAutofillSaveCandidate {
  kind: AutofillKind;
  address?: IAddressFields;
  card?: {
    number: string;
    expMonth?: string;
    expYear?: string;
    holderName?: string;
  };
}

// 发给「保存地址/银行卡」弹窗的展示数据(不含完整卡号)。
export interface IAutofillSavePromptData {
  id: string;
  kind: AutofillKind;
  update?: boolean;
  address?: IAddressFields;
  card?: {
    last4: string;
    network: CardNetwork;
    expMonth: string;
    expYear: string;
    holderName: string;
  };
}
