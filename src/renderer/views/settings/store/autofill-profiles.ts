import { action, makeObservable, observable, runInAction } from 'mobx';

import {
  IAddressFields,
  IAddressProfile,
  IAutofillProfilesList,
  ICardSaveInput,
  ICardSummary,
} from '~/interfaces';
import { ipcRenderer } from '~/common/renderer-ipc';

interface SaveResult {
  ok: boolean;
  msg?: string;
  id?: string;
}

// 设置页「地址及更多」「付款方式」数据。全部经主进程 autofill-profiles 服务读写,
// 银行卡只拿到摘要;完整卡号仅在 reveal(需 Windows 验证)时临时返回。
export class AutofillProfilesStore {
  @observable
  public addresses: IAddressProfile[] = [];

  @observable
  public cards: ICardSummary[] = [];

  @observable
  public loaded = false;

  // 正在编辑的条目;null 表示新增
  @observable
  public editingAddress: IAddressProfile | null = null;

  @observable
  public editingCard: ICardSummary | null = null;

  public constructor() {
    makeObservable(this);
    ipcRenderer.on('autofill-profiles-changed', () => void this.load());
  }

  @action
  public async load() {
    try {
      const list: IAutofillProfilesList = await ipcRenderer.invoke(
        'autofill-profiles-list',
      );
      runInAction(() => {
        this.addresses = list?.addresses || [];
        this.cards = list?.cards || [];
        this.loaded = true;
      });
    } catch (error) {
      console.error('[autofill-profiles] load failed', error);
    }
  }

  public async saveAddress(id: string | undefined, fields: IAddressFields) {
    const result: SaveResult = await ipcRenderer.invoke(
      'autofill-address-save',
      id || '',
      fields,
    );
    if (result?.ok) await this.load();
    return result;
  }

  public async saveCard(input: ICardSaveInput) {
    const result: SaveResult = await ipcRenderer.invoke('autofill-card-save', input);
    if (result?.ok) await this.load();
    return result;
  }

  public async remove(id: string) {
    const ok = await ipcRenderer.invoke('autofill-profile-remove', id);
    if (ok) await this.load();
    return ok;
  }

  public revealCard(id: string): Promise<{ ok: boolean; number: string; msg: string }> {
    return ipcRenderer.invoke('autofill-card-reveal', id);
  }
}
