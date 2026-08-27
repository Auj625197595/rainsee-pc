export type DownloadPromptAction = 'open' | 'save' | 'cancel';

export interface IDownloadPromptDownloader {
  type: string;
  name: string;
}

export interface IDownloadPromptData {
  fileName: string;
  directory: string;
  source: string;
  url: string;
  downloaders: IDownloadPromptDownloader[];
}

export interface IDownloadPromptResult {
  action: DownloadPromptAction;
  fileName: string;
  directory: string;
  downloaderType: string;
}
