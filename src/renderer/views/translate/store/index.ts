import {ipcRenderer} from 'electron';
import {makeObservable, observable, runInAction} from 'mobx';
import {DialogStore} from '~/models/dialog-store';
import {LANGUAGES} from '../languages';

export type TranslateEngine = 'microsoft' | 'custom-llm';

// 透传,保持 `import {LANGUAGES} from 'translate/store'` 仍可用。
export {LANGUAGES};

export class Store extends DialogStore {
  // 与主进程 View.translateActive 同步。弹窗是可复用 BrowserView，可能在保持可见时
  // 收到新的 open 数据，所以不能依赖 visible 翻转触发重渲染。
  @observable
  public active = false;

  @observable
  public target = 'zh-CN';

  public languages = LANGUAGES;

  public constructor() {
    // 持久弹窗自己处理 visible(含 data 载荷)，隐藏后由主进程统一回收。
    super({persistent: true, visibilityWrapper: false});
    makeObservable(this);

    ipcRenderer.on('visible', (e, flag, data) => {
      runInAction(() => {
        // Chrome 风格:由当前文档是否正在显示译文决定“显示原文”是否可用。
        // 主进程每次打开都传入该文档的实时状态，避免使用地址栏图标的旧本地态。
        if (flag && data) {
          this.active = !!data.active;
          this.target = data.target || 'zh-CN';
        }
        this.visible = flag;
      });
    });
  }

  // 翻译/切换到所选语言:未开启则开启,已开启则 reload 重译。随后关闭弹窗。
  public async chooseLanguage(code: string) {
    await ipcRenderer.invoke(`translate-set-language-${this.windowId}`, code);
    this.hide();
  }

  // 翻译弹窗内切换引擎:复用设置页通道,主进程会让已开启的页面立即重译。
  public async chooseEngine(engine: TranslateEngine) {
    await ipcRenderer.invoke('set-selection-translate-option', 'engine', engine);
  }

  public notifyEnter() {
    this.send('translate-popup-hover-enter');
  }

  public notifyLeave() {
    this.send('translate-popup-hover-leave');
  }

  // 显示原文:关闭翻译并 reload 回原文。随后关闭弹窗。
  public async restore() {
    await ipcRenderer.invoke(`translate-restore-${this.windowId}`);
    this.hide();
  }
}

export default new Store();
