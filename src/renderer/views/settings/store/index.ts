import { observable, computed, makeObservable } from 'mobx';
import * as React from 'react';
import { ISettings, ITheme, ISearchEngine } from '~/interfaces';
import { AutoFillStore } from './autofill';
import { StartupTabsStore } from './startup-tabs';
import { getTheme } from '~/utils/themes';

export type SettingsSection =
  | 'appearance'
  | 'autofill'
  | 'address-bar'
  | 'privacy'
  | 'permissions'
  | 'startup'
  | 'language'
  | 'shortcuts'
  | 'mouse-gestures'
  | 'selection-translate'
  | 'downloads'
  | 'system'
  | 'default-browser'
  | 'search-engines'
  | 'extensions'
  | 'customize-toolbar'
  | 'about';

export class Store {
  public autoFill = new AutoFillStore();
  public startupTabs = new StartupTabsStore();

  public menuRef = React.createRef<HTMLDivElement>();

  public dialogRef = React.createRef<HTMLDivElement>();

  public searchEngineInputRef = React.createRef<HTMLInputElement>();
  public searchEngineKeywordInputRef = React.createRef<HTMLInputElement>();
  public searchEngineUrlInputRef = React.createRef<HTMLInputElement>();

  @observable
  public menuInfo = {
    left: 0,
    top: 0,
  };

  @observable
  private _menuVisible = false;

  @computed
  public get menuVisible() {
    return this._menuVisible;
  }

  public set menuVisible(value: boolean) {
    this._menuVisible = value;

    if (value) {
      this.menuRef.current.focus();
    }
  }

  @observable
  public dialogVisible = false;

  @observable
  public dialogContent:
    | 'edit-search-engine'
    | 'add-search-engine'
    | 'edit-address'
    | 'edit-password'
    | 'privacy'
    | 'adblock-rule' = null;

  @observable
  public selectedSection: SettingsSection = 'appearance';

  @observable
  public settings: ISettings = { ...(window as any).settings };

  @observable
  public appVersion: string = (window as any)['supervideo-app-version'];

  @observable
  public editedSearchEngine: ISearchEngine = null;

  @observable
  public draggedEngineKeyword: string = null;

  @computed
  public get theme(): ITheme {
    return getTheme(this.settings.theme);
  }

  @computed
  public get searchEngine() {
    return this.settings.searchEngines[this.settings.searchEngine];
  }

  @computed
  public get secondarySearchEngine() {
    return this.settings.searchEngines[this.settings.secondarySearchEngine];
  }

  // 高亮某个设置项(从 ?highlight= 查询参数来):AddressBar 监听并滚动+脉冲提示。
  @observable
  public highlightedSetting: string | null = null;

  public setHighlightedSetting(value: string | null) {
    this.highlightedSetting = value;
  }

  constructor() {
    makeObservable(this);

    (window as any).updateSettings = (settings: ISettings) => {
      this.settings = { ...this.settings, ...settings };
    };

    window.onmousedown = () => {
      this.autoFill.menuVisible = false;
    };
  }

  public save() {
    delete this.settings.darkContents;
    delete this.settings.multrin;

    window.postMessage(
      {
        type: 'save-settings',
        data: JSON.stringify(this.settings),
      },
      '*',
    );
  }
}

export default new Store();
