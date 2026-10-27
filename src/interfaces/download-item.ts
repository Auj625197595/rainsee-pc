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
  // 自动重试耗尽后的失败终态。记录保留在列表中,仍可手动重试(download-resume)。
  failed?: boolean;
  // 失败归因(重试耗尽时由主进程对保存路径落盘探测得出):
  // file-locked=目标文件被占用/无写权限;dir-unwritable=保存目录不可写;
  // unknown=其它(网络/服务器类,Electron 42 不暴露原生中断原因)。
  failReason?: 'file-locked' | 'dir-unwritable' | 'unknown';
  // 已完成但保存路径上的文件已不存在(被删除/移走)。由主进程子线程校验后标注。
  fileMissing?: boolean;
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
