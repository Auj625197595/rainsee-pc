export interface IDisplayCaptureSource {
  id: string;
  name: string;
  type: 'screen' | 'window';
  thumbnail?: string;
}

export interface IDisplayCaptureRequestInfo {
  url: string;
  sources: IDisplayCaptureSource[];
  videoRequested: boolean;
  audioRequested: boolean;
  audioAvailable: boolean;
}

export interface IDisplayCaptureSelection {
  id: string;
  name: string;
  shareAudio: boolean;
}
