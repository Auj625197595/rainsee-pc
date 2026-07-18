export interface IBookmark {
  _id?: string;
  title?: string;
  url?: string;
  favicon?: string;
  hovered?: boolean;
  isFolder?: boolean;
  parent?: string;
  order?: number;
  expanded?: boolean;
  static?: 'mobile' | 'main' | 'other' | 'pinned';
  children?: string[];
  // 云服务(互联)本机书签多设备同步用的可选字段(参考 cloud-account README:
  // 删除云模块后保留无副作用)。syncId 为跨设备稳定 id,syncUpdatedAt 为该条
  // 最后一次同步的毫秒时间戳(LWW 比较依据)。
  syncId?: string;
  syncUpdatedAt?: number;
}
