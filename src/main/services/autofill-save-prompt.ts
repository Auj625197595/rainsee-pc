// 网页提交表单后的「保存地址？」「保存银行卡？」提示协调器。
// 结构对齐 credential-prompt.ts(队列、5s 去重、弹窗 hidden 视为取消),但与密码链路
// 完全独立。卡号明文只停留在主进程的 pending 条目里,弹窗只收到摘要;用户点「保存」
// 才加密入库,取消/关闭即丢弃。
import type { IpcMainEvent } from 'electron';

import {
  IAddressFields,
  IAutofillSaveCandidate,
  IAutofillSavePromptData,
} from '~/interfaces';
import { Application } from '~/main/application';
import type { AutofillSaveDialog } from '~/main/dialogs/autofill-save';
import type { AppWindow } from '~/main/windows';
import {
  detectNetwork,
  findExistingAddress,
  findExistingCard,
  findPageSource,
  isEncryptionAvailable,
  luhnValid,
  normalizeCardNumber,
  saveAddress,
  saveCard,
} from './autofill-profiles';

interface PromptEntry {
  owner: AppWindow;
  sourceWebContentsId: number;
  signature: string;
  data: IAutofillSavePromptData;
  // 仅主进程持有
  existingId?: string;
  address?: IAddressFields;
  cardNumber?: string;
  card?: { expMonth: string; expYear: string; holderName: string };
}

const promptQueue: PromptEntry[] = [];
const recentPrompts = new Map<string, number>();
let activePrompt: PromptEntry | null = null;
let promptSeq = 0;

const getDialog = () => {
  const dialog = Application.instance.dialogs.getPersistent(
    'autofill-save',
  ) as AutofillSaveDialog;
  const marker = dialog as any;
  if (dialog && !marker.__autofillSaveBound) {
    marker.__autofillSaveBound = true;
    dialog.on('hidden', () => {
      if (activePrompt) finishActivePrompt();
    });
  }
  return dialog;
};

const showNextPrompt = async () => {
  if (activePrompt) return;
  let next: PromptEntry | undefined;
  while ((next = promptQueue.shift())) {
    if (!next.owner.win.isDestroyed() && findPageSource(next.sourceWebContentsId)) {
      break;
    }
    next = undefined;
  }
  if (!next) return;

  const dialog = getDialog();
  if (!dialog) return;
  activePrompt = next;
  try {
    if (!(await dialog.show(next.owner.win, true))) return;
    dialog.rearrange();
    dialog.present(next.data);
  } catch (error) {
    console.error('[autofill-save] show dialog failed', error);
    activePrompt = null;
    queueMicrotask(() => void showNextPrompt());
  }
};

const finishActivePrompt = () => {
  const finished = activePrompt;
  if (!finished) return null;
  activePrompt = null;
  getDialog()?.hide();
  queueMicrotask(() => void showNextPrompt());
  return finished;
};

const enqueue = (entry: PromptEntry) => {
  const now = Date.now();
  if (now - (recentPrompts.get(entry.signature) || 0) < 5000) return;
  if (
    activePrompt?.signature === entry.signature ||
    promptQueue.some((item) => item.signature === entry.signature)
  ) {
    return;
  }
  recentPrompts.set(entry.signature, now);
  for (const [signature, timestamp] of recentPrompts) {
    if (now - timestamp > 30_000) recentPrompts.delete(signature);
  }
  promptQueue.push(entry);
  void showNextPrompt();
};

const str = (value: unknown, max = 512) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const sameAddress = (a: IAddressFields, b: IAddressFields) =>
  (Object.keys(b) as (keyof IAddressFields)[]).every(
    (key) => !b[key] || (a[key] || '') === b[key],
  );

const prepare = async (
  owner: AppWindow,
  sourceWebContentsId: number,
  candidate: IAutofillSaveCandidate,
) => {
  const settings = Application.instance.settings.object;
  const id = `af-${Date.now().toString(36)}-${(promptSeq++).toString(36)}`;

  if (candidate?.kind === 'card') {
    if (!settings.autofillPayments || !isEncryptionAvailable()) return;
    const number = normalizeCardNumber(candidate.card?.number);
    if (!luhnValid(number)) return;
    if (await findExistingCard(number)) return;
    const month = str(candidate.card?.expMonth, 4).replace(/\D/g, '');
    const year = str(candidate.card?.expYear, 4).replace(/\D/g, '');
    const card = {
      expMonth: month ? month.padStart(2, '0').slice(-2) : '',
      expYear: year.length === 2 ? `20${year}` : year,
      holderName: str(candidate.card?.holderName, 128),
    };
    enqueue({
      owner,
      sourceWebContentsId,
      signature: `card\n${sourceWebContentsId}\n${number}`,
      cardNumber: number,
      card,
      data: {
        id,
        kind: 'card',
        card: {
          last4: number.slice(-4),
          network: detectNetwork(number),
          ...card,
        },
      },
    });
    return;
  }

  if (candidate?.kind === 'address') {
    if (!settings.autofillAddresses) return;
    const raw = candidate.address || {};
    const address: IAddressFields = {};
    (
      ['name', 'organization', 'street', 'city', 'state', 'postCode', 'country', 'phone', 'email'] as const
    ).forEach((key) => {
      const value = str((raw as any)[key], key === 'street' ? 1024 : 512);
      if (value) address[key] = value;
    });
    if (!address.street || !(address.name || address.phone)) return;
    const existing = await findExistingAddress(address);
    if (existing && sameAddress(existing.fields, address)) return;
    enqueue({
      owner,
      sourceWebContentsId,
      signature: `address\n${sourceWebContentsId}\n${JSON.stringify(address)}`,
      existingId: existing?._id,
      address: existing ? { ...existing.fields, ...address } : address,
      data: {
        id,
        kind: 'address',
        update: !!existing,
        address: existing ? { ...existing.fields, ...address } : address,
      },
    });
  }
};

export const requestAutofillSavePrompt = (
  appWindow: AppWindow,
  event: IpcMainEvent,
  candidate: IAutofillSaveCandidate,
) => {
  const view = appWindow.viewManager.findViewByWebContentsId(event.sender.id);
  // 无痕不保存(对齐 Chrome)
  if (!view || view.incognito) return;
  const url = event.senderFrame?.url || event.sender.getURL();
  if (!/^https?:/i.test(url || '')) return;
  if (activePrompt && activePrompt.owner.win.isDestroyed()) activePrompt = null;
  prepare(appWindow, event.sender.id, candidate).catch((error) =>
    console.error('[autofill-save] prepare failed', error),
  );
};

const isDialogSender = (event: IpcMainEvent, windowId: number, id: string) => {
  const dialog = getDialog();
  return (
    !!activePrompt &&
    activePrompt.owner.id === windowId &&
    activePrompt.data.id === id &&
    !!dialog &&
    !dialog.webContents.isDestroyed() &&
    event.sender.id === dialog.webContents.id
  );
};

export const hideAutofillSavePrompt = (
  event: IpcMainEvent,
  windowId: number,
  id: string,
) => {
  if (!isDialogSender(event, windowId, id)) return;
  finishActivePrompt();
};

export const confirmAutofillSavePrompt = (
  event: IpcMainEvent,
  windowId: number,
  id: string,
  edited: any,
) => {
  if (!isDialogSender(event, windowId, id) || !activePrompt) return;
  const entry = activePrompt;
  finishActivePrompt();
  const task =
    entry.data.kind === 'card'
      ? saveCard({
          number: entry.cardNumber,
          expMonth: entry.card?.expMonth || '',
          expYear: entry.card?.expYear || '',
          holderName: str(edited?.holderName, 128) || entry.card?.holderName || '',
          nickname: str(edited?.nickname, 64),
        })
      : saveAddress(entry.existingId, entry.address);
  task.catch((error) => console.error('[autofill-save] save failed', error));
};
