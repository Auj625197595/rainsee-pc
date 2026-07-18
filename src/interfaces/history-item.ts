export interface IHistoryItem {
  _id?: string;
  title?: string;
  url?: string;
  date?: number;
  favicon?: string;
  hovered?: boolean;
  // 云服务历史同步字段(参考安卓 HistorySyncUtil / sync_history 表)
  recordHash?: string;
  updatedAt?: string;
  isDeleted?: boolean;
  synced?: boolean;
}

export interface IVisitedItem extends IHistoryItem {
  times: number;
}
