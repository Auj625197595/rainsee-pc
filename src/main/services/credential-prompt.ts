import type { IpcMainEvent } from 'electron';

import { IFormFillData } from '~/interfaces';
import { Application } from '~/main/application';
import { CredentialsDialog } from '~/main/dialogs/credentials';
import type { AppWindow } from '~/main/windows';
import { hasSameHostname, hostMatches } from '~/utils/url';

interface CredentialCapture {
  username: string;
  password: string;
  url: string;
  credentialId?: string;
  sourceWebContentsId: number;
  strictHost?: boolean;
}

interface CredentialPromptPayload extends CredentialCapture {
  content: 'save' | 'update';
  credentialId: string;
}

interface PromptEntry {
  owner: AppWindow;
  payload: CredentialPromptPayload;
  signature: string;
}

const promptQueue: PromptEntry[] = [];
const recentPrompts = new Map<string, number>();
let activePrompt: PromptEntry | null = null;
let requestQueue = Promise.resolve();
let saveQueue = Promise.resolve();

const parseHttpUrl = (value: unknown): URL | null => {
  if (typeof value !== 'string' || value.length > 8192) return null;
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url : null;
  } catch {
    return null;
  }
};

const findSource = (webContentsId: number) => {
  for (const owner of Application.instance.windows.list) {
    const view = owner.viewManager.findViewByWebContentsId(webContentsId);
    if (view) return { owner, view };
  }
  return null;
};

const getDialog = () => {
  const dialog = Application.instance.dialogs.getPersistent(
    'credentials',
  ) as CredentialsDialog;
  const marker = dialog as any;
  if (dialog && !marker.__credentialPromptCoordinatorBound) {
    marker.__credentialPromptCoordinatorBound = true;
    dialog.on('hidden', () => {
      if (activePrompt) finishActivePrompt(true);
    });
  }
  return dialog;
};

const notifyPromptDismissed = (entry: PromptEntry) => {
  const source = findSource(entry.payload.sourceWebContentsId);
  if (source && !source.view.webContents.isDestroyed()) {
    source.view.webContents.send('credentials-prompt-dismissed');
  }
};

const showNextPrompt = async () => {
  if (activePrompt) return;

  let next: PromptEntry | undefined;
  while ((next = promptQueue.shift())) {
    if (
      !next.owner.win.isDestroyed() &&
      findSource(next.payload.sourceWebContentsId)
    ) {
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
    dialog.present(next.payload);
  } catch (error) {
    console.error('[autofill] show credentials dialog failed', error);
    activePrompt = null;
    queueMicrotask(() => void showNextPrompt());
  }
};

const enqueuePrompt = (entry: PromptEntry) => {
  const now = Date.now();
  const lastAt = recentPrompts.get(entry.signature) || 0;
  if (now - lastAt < 5000) return;
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

const preparePrompt = async (capture: CredentialCapture) => {
  if (!Application.instance.settings.object.autofill) return;
  const source = findSource(Number(capture.sourceWebContentsId) || 0);
  if (!source || source.view.incognito) return;

  const capturedUrl = parseHttpUrl(capture.url);
  const username = typeof capture.username === 'string' ? capture.username : '';
  const password = typeof capture.password === 'string' ? capture.password : '';
  if (!capturedUrl || !password) return;

  const credentials = await Application.instance.storage.find<IFormFillData>({
    scope: 'formfill',
    query: { type: 'password' },
  });
  const hostname = capturedUrl.hostname;
  const explicitId =
    typeof capture.credentialId === 'string' ? capture.credentialId : '';
  const matched = credentials.filter((item) =>
    capture.strictHost
      ? hasSameHostname(item.url, hostname)
      : hostMatches(item.url, hostname),
  );
  const existing =
    (explicitId && matched.find((item) => item._id === explicitId)) ||
    matched.find((item) => item.fields?.username === username) ||
    (!username && matched.length === 1 ? matched[0] : undefined);

  const payload: CredentialPromptPayload = {
    username,
    password,
    url: capturedUrl.href,
    content: existing ? 'update' : 'save',
    credentialId: existing?._id || '',
    sourceWebContentsId: capture.sourceWebContentsId,
    strictHost: !!capture.strictHost,
  };
  const signature = [
    payload.sourceWebContentsId,
    capturedUrl.origin,
    payload.username,
    payload.password,
    payload.content,
    payload.credentialId,
  ].join('\n');
  enqueuePrompt({ owner: source.owner, payload, signature });
};

export const requestCredentialPrompt = (capture: CredentialCapture) => {
  if (activePrompt && activePrompt.owner.win.isDestroyed()) {
    activePrompt = null;
  }
  requestQueue = requestQueue
    .then(() => preparePrompt(capture))
    .catch((error) => console.error('[autofill] prepare prompt failed', error));
  return requestQueue;
};

export const requestCredentialPromptFromPage = (
  appWindow: AppWindow,
  event: IpcMainEvent,
  data: any,
) => {
  const view = appWindow.viewManager.findViewByWebContentsId(event.sender.id);
  if (!view || view.incognito) return;

  const capturedUrl = parseHttpUrl(data?.url);
  const senderUrl = parseHttpUrl(event.senderFrame?.url || event.sender.getURL());
  if (!capturedUrl || !senderUrl || capturedUrl.origin !== senderUrl.origin) return;

  void requestCredentialPrompt({
    username: typeof data?.username === 'string' ? data.username : '',
    password: typeof data?.password === 'string' ? data.password : '',
    url: capturedUrl.href,
    credentialId:
      typeof data?.credentialId === 'string' ? data.credentialId : '',
    sourceWebContentsId: event.sender.id,
    strictHost: false,
  });
};

const finishActivePrompt = (notifyDismissed: boolean) => {
  const finished = activePrompt;
  if (!finished) return null;
  activePrompt = null;
  getDialog()?.hide();
  if (notifyDismissed) notifyPromptDismissed(finished);
  queueMicrotask(() => void showNextPrompt());
  return finished;
};

const isDialogSender = (event: IpcMainEvent, windowId: number) => {
  const dialog = getDialog();
  return (
    !!activePrompt &&
    activePrompt.owner.id === windowId &&
    !!dialog &&
    !dialog.webContents.isDestroyed() &&
    event.sender.id === dialog.webContents.id
  );
};

export const hideCredentialPrompt = (
  event: IpcMainEvent,
  windowId: number,
) => {
  if (!isDialogSender(event, windowId)) return;
  finishActivePrompt(true);
};

const saveCredential = async (
  payload: CredentialPromptPayload,
): Promise<boolean> => {
  if (!Application.instance.settings.object.autofill) return false;
  const source = findSource(payload.sourceWebContentsId);
  if (!source || source.view.incognito) return false;

  const capturedUrl = parseHttpUrl(payload.url);
  if (!capturedUrl || !payload.password) return false;
  const hostname = capturedUrl.hostname;
  const credentials = await Application.instance.storage.find<IFormFillData>({
    scope: 'formfill',
    query: { type: 'password' },
  });
  const matchesHost = (value: string) =>
    payload.strictHost
      ? hasSameHostname(value, hostname)
      : hostMatches(value, hostname);
  const existing =
    (payload.credentialId &&
      credentials.find(
        (item) => item._id === payload.credentialId && matchesHost(item.url),
      )) ||
    credentials.find(
      (item) =>
        item.fields?.username === payload.username && matchesHost(item.url),
    );

  let saved: IFormFillData;
  let eventType: 'credentials-insert' | 'credentials-update';
  if (!existing) {
    saved = await Application.instance.storage.insert<IFormFillData>({
      scope: 'formfill',
      item: {
        type: 'password',
        url: hostname,
        favicon: source.view.favicon,
        fields: {
          password: payload.password,
          username: payload.username,
          passLength: payload.password.length,
        },
      },
    });
    eventType = 'credentials-insert';
  } else {
    const savedUsername = payload.username || existing.fields?.username || '';
    if (
      existing.fields?.username === savedUsername &&
      existing.fields?.password === payload.password
    ) {
      source.view.webContents.send('credentials-saved', existing);
      return true;
    }
    await Application.instance.storage.update({
      scope: 'formfill',
      query: { _id: existing._id },
      value: {
        'fields.username': savedUsername,
        'fields.password': payload.password,
        'fields.passLength': payload.password.length,
        favicon: source.view.favicon || existing.favicon,
      },
    });
    saved = {
      ...existing,
      favicon: source.view.favicon || existing.favicon,
      fields: {
        ...existing.fields,
        username: savedUsername,
        password: payload.password,
        passLength: payload.password.length,
      },
    };
    eventType = 'credentials-update';
  }

  for (const owner of Application.instance.windows.list) {
    const settingsView = owner.viewManager.settingsView;
    if (settingsView && !settingsView.webContents.isDestroyed()) {
      settingsView.webContents.send(eventType, saved);
    }
  }
  if (!source.view.webContents.isDestroyed()) {
    source.view.webContents.send('credentials-saved', saved);
  }
  await source.view.refreshAutofillPickers();
  await source.view.updateCredentials();
  return true;
};

export const saveCredentialPrompt = (
  event: IpcMainEvent,
  windowId: number,
  edited: any,
) => {
  if (!isDialogSender(event, windowId) || !activePrompt) return;
  const current = activePrompt;
  const payload: CredentialPromptPayload = {
    ...current.payload,
    username: typeof edited?.username === 'string' ? edited.username : '',
    password: typeof edited?.password === 'string' ? edited.password : '',
  };
  finishActivePrompt(false);
  saveQueue = saveQueue
    .then(async () => {
      if (!(await saveCredential(payload))) notifyPromptDismissed(current);
    })
    .catch((error) => {
      notifyPromptDismissed(current);
      console.error('[autofill] save failed', error);
    });
};
