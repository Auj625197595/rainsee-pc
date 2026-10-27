// 'dismiss' 不由浮层 UI 发出:浮层被外部关闭(切标签/点网页触发 hideAllPersistent)
// 时主进程以此标记,下载按默认名/目录继续,而不是当成用户取消。
export type DownloadPromptAction = 'open' | 'save' | 'cancel' | 'dismiss';

export interface IDownloadPromptDownloader {
  type: string;
  name: string;
}

export interface IDownloadPromptData {
  fileName: string;
  directory: string;
  source: string;
  url: string;
  // 字节数;服务器未给 Content-Length 时为 0。
  size?: number;
  downloaders: IDownloadPromptDownloader[];
}

export interface IDownloadPromptResult {
  action: DownloadPromptAction;
  fileName: string;
  directory: string;
  downloaderType: string;
}
