export interface IDownloadItem {
  fileName?: string;
  receivedBytes?: number;
  totalBytes?: number;
  savePath?: string;
  url?: string;
  id?: string;
  completed?: boolean;
  paused?: boolean;
  canceled?: boolean;
  menuIsOpen?: boolean;
  openWhenDone?: boolean;
  // 完成时间戳(ms)。仅持久化的历史记录有;当前会话的下载在内存里不设此字段。
  date?: number;
}

export interface IElectronDownloadItem {
  item?: Electron.DownloadItem;
  webContents?: Electron.WebContents;
  id?: string;
}
