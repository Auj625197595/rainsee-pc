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
  // 从其他浏览器迁移的历史默认仅保存在本机，避免在用户不知情时上传云端。
  cloudSyncExcluded?: boolean;
}

export type BrowserHistorySource = 'chrome' | 'edge' | 'firefox';

export interface IBrowserHistoryPreview {
  browserId: BrowserHistorySource;
  profileName: string;
  count: number;
  oldestDate: number | null;
  newestDate: number | null;
}

export interface IBrowserHistoryImportResult extends IBrowserHistoryPreview {
  imported: number;
  skipped: number;
}

export interface IVisitedItem extends IHistoryItem {
  times: number;
}
