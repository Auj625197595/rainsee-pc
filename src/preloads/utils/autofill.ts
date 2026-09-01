import { IFormFillData } from '~/interfaces';
import {ipcRenderer} from '~/common/renderer-ipc';

const passwords: Map<string, string> = new Map();

export const getUserPassword = async (data: IFormFillData): Promise<string> => {
  const {url, fields} = data;
  const account = `${url}-${fields.username}`;
  const cached = passwords.get(account);
  if (cached) return cached;

  const password = await ipcRenderer.invoke(
    'credentials-get-password',
    data._id,
  );
  if (typeof password === 'string' && password) {
    passwords.set(account, password);
  }
  return typeof password === 'string' ? password : '';
};
