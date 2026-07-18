import * as React from 'react';
import { observable, action, computed, makeObservable } from 'mobx';

import { LIGHT_BLUE_500 } from '~/renderer/constants';
import { Store } from '../store';
import { TabGroupsStore } from '../store/tab-groups';
import { animateTab } from '../utils/tabs';
import { ITab } from './tab';

export class ITabGroup {
  public width = 0;
  public left = 8;

  // 是否已完成首次定位。新组的芯片 DOM 首次挂载时位于 CSS 默认位(left:0),
  // 若直接动画定位会"从左飞入"。芯片组件挂载时(useLayoutEffect,早于绘制)
  // 用 animation=false snap 到 left/width 目标位并置 true,消除飞入。
  public positioned = false;

  // 芯片本体元素(承载 transform/width 动画)。组在标签栏里是单个折叠 slot,
  // 该 ref 即 slot 元素,由 setTabsLefts/setTabsWidths 直接驱动。
  public ref = React.createRef<HTMLDivElement>();

  private store: Store;
  private tabGroups: TabGroupsStore;

  // 由 TabGroupsStore 分配的稳定 id(跨重启持久化)。运行时自增,恢复时用
  // 持久化最大 id 播种,避免不同会话的 id 冲突。需带初始值,否则 makeObservable
  // 找不到该实例字段(MobX 要求 observable 字段先于 makeObservable 存在)。
  public id: number = -1;

  public name = '';

  public color: string = LIGHT_BLUE_500;

  public editMode = false;

  // 整组钉住(固定分组):芯片靠左、固定紧凑宽度(仅组名+favicon,不显示活动
  // 标题)、不参与标签平分。持久化(跨重启保留)。
  public isPinned = false;

  // 组内"当前标签":点击组名时切换到它。内存派生,不持久化(占位 id 重映射下
  // 持久化会失配)。选中组内任一 tab 时由 ITab.select() 写入。
  public selectedTabId = -1;

  public constructor(store: Store, tabGroupsStore: TabGroupsStore, id: number) {
    makeObservable(this, {
      id: observable,
      name: observable,
      color: observable,
      editMode: observable,
      isPinned: observable,
      selectedTabId: observable,
      setLeft: action,
      setWidth: action,
      activeTab: computed,
    });

    this.store = store;
    this.tabGroups = tabGroupsStore;
    this.id = id;

    const { palette } = tabGroupsStore;
    this.color = palette[Math.floor(Math.random() * palette.length)];
  }

  public get tabs() {
    return this.store.tabs.list.filter((x) => x.tabGroupId === this.id);
  }

  // 组当前应显示/切换到的标签:优先 selectedTabId,回退组内首个。
  public get activeTab(): ITab | undefined {
    if (this.selectedTabId !== -1) {
      const t = this.store.tabs.getTabById(this.selectedTabId);
      if (t && t.tabGroupId === this.id) return t;
    }
    return this.tabs[0];
  }

  public setLeft(left: number, animation: boolean) {
    animateTab('translateX', left, this.ref.current, animation);
    this.left = left;
  }

  public setWidth(width: number, animation: boolean) {
    animateTab('width', width, this.ref.current, animation);
    this.width = width;
  }
}
