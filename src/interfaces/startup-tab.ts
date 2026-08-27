export interface IStartupTab {
  id?: number;
  windowId?: number;
  // 该标签所属标签组 id(ITabGroup.id),-1/缺省 = 未分组。跨重启持久化分组归属。
  tabGroupId?: number;
  workspaceKey?: string;
  title?: string;
  url?: string;
  favicon?: string;
  order?: number;
  pinned?: boolean;
  active?: boolean;
  isUserDefined?: boolean;
}
