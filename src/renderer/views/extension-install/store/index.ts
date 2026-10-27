import { ipcRenderer } from 'electron';
import { makeObservable, observable } from 'mobx';
import { DialogStore } from '~/models/dialog-store';
import { getWebUIURL } from '~/common/webui';
import {
  ExtensionInstallDecision,
  ExtensionInstallDialogMode,
  IExtensionInstallDialogData,
  IExtensionInstallPreview,
} from '~/interfaces';

const EMPTY_PREVIEW: IExtensionInstallPreview = {
  id: '',
  name: '',
  version: '',
  description: '',
  iconUrl: '',
  permissions: [],
  hosts: [],
  isTheme: false,
  installedVersion: '',
  duplicates: [],
};

export class Store extends DialogStore {
  @observable public mode: ExtensionInstallDialogMode = 'confirm';
  @observable public preview: IExtensionInstallPreview = EMPTY_PREVIEW;
  // installed 气泡的箭头距内容右边缘距离,由主进程按锚点计算。
  @observable public arrowRight = 28;
  // 每次打开递增,组件据此重置本地状态并重播入场动画。
  @observable public openSeq = 0;

  public constructor() {
    // 确认框是模态的,不能失焦即关;installed 气泡失焦即关,在组件里单独处理。
    super({ persistent: true, visibilityWrapper: false, hideOnBlur: false });
    makeObservable(this);

    ipcRenderer.on(
      'visible',
      (
        _event,
        visible: boolean,
        data?: IExtensionInstallDialogData & { arrowRight?: number },
      ) => {
        if (visible && data) {
          this.mode = data.mode === 'installed' ? 'installed' : 'confirm';
          this.preview = { ...EMPTY_PREVIEW, ...data.preview };
          if (Number.isFinite(data.arrowRight)) this.arrowRight = data.arrowRight;
          this.openSeq++;
        }
        this.visible = visible;
      },
    );
  }

  public respond(decision: ExtensionInstallDecision) {
    this.send('extension-install-result', decision);
  }

  public reportHeight(height: number) {
    this.send('resize-dialog', height);
  }

  public openManager() {
    ipcRenderer.send(`add-tab-${this.windowId}`, {
      url: getWebUIURL('extensions'),
      active: true,
    });
    this.respond(false);
  }
}

export default new Store();
