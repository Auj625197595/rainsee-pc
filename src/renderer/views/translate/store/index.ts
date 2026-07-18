import {ipcRenderer} from 'electron';
import {DialogStore} from '~/models/dialog-store';
import {LANGUAGES} from '../languages';

// 透传,保持 `import {LANGUAGES} from 'translate/store'` 仍可用。
export {LANGUAGES};

export class Store extends DialogStore {
  // active/target 为普通字段:仅在 'visible' 到达时(伴随 visible 翻转,触发重渲染)
  // 赋值,随后用户改动通过未受控 <select> + onChange 反映,无需 observable。
  public active = false;
  public target = 'zh-CN';
  public languages = LANGUAGES;

  public constructor() {
    // 持久弹窗:启动预加载、常驻复用,自己处理 visible(含 data 载荷),实现秒开
    super({persistent: true, visibilityWrapper: false});

    ipcRenderer.on('visible', (e, flag, data) => {
      this.visible = flag;
      if (flag && data) {
        this.active = !!data.active;
        this.target = data.target || 'zh-CN';
      }
    });
  }

  // 翻译/切换到所选语言:未开启则开启,已开启则 reload 重译。随后关闭弹窗。
  public async chooseLanguage(code: string) {
    await ipcRenderer.invoke(`translate-set-language-${this.windowId}`, code);
    this.hide();
  }

  // 显示原文:关闭翻译并 reload 回原文。随后关闭弹窗。
  public async restore() {
    await ipcRenderer.invoke(`translate-restore-${this.windowId}`);
    this.hide();
  }
}

export default new Store();
