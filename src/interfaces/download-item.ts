export interface IDownloadItem {
  fileName?: string;
  receivedBytes?: number;
  totalBytes?: number;
  speedBytesPerSecond?: number;
  savePath?: string;
  url?: string;
  id?: string;
  completed?: boolean;
  paused?: boolean;
  interrupted?: boolean;
  retrying?: boolean;
  canceled?: boolean;
  menuIsOpen?: boolean;
  openWhenDone?: boolean;
  // 完成时间戳(ms)。仅持久化的历史记录有;当前会话的下载在内存里不设此字段。
  date?: number;
  // 媒体任务创建后、浏览器尚未嗅探到实际资源时为 true。
  preparing?: boolean;
  // 创建任务时输入的网页地址(仅用于展示/排查)。
  sourceUrl?: string;
}

export interface IElectronDownloadItem {
  item?: Electron.DownloadItem;
  webContents?: Electron.WebContents;
  id?: string;
}
