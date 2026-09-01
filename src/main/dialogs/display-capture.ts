import { BrowserWindow, desktopCapturer } from 'electron';
import { Application } from '../application';
import { VIEW_Y_OFFSET, SIDEBAR_RAIL_WIDTH } from '~/constants/design';
import { IDisplayCaptureSelection, IDisplayCaptureSource } from '~/interfaces';

const WIDTH = 560;
const HEIGHT = 460;
let pendingFinish: (() => void) | null = null;

const sidebarOffset = (appWindow: any) => {
  if (appWindow?.viewManager?.fullscreen) return 0;
  const settings = Application.instance.settings.object;
  if (settings.tabsLayout !== 'left') return 0;
  return (settings as any).sidebarPinned !== false ? settings.sidebarWidth : SIDEBAR_RAIL_WIDTH;
};

export const requestDisplayCapture = async (
  browserWindow: BrowserWindow,
  tabId: number,
  url: string,
  videoRequested: boolean,
  audioRequested: boolean,
) => {
  let resolvePromise!: (selection: IDisplayCaptureSelection | null) => void;
  const promise = new Promise<IDisplayCaptureSelection | null>((resolve) => {
    resolvePromise = resolve;
  });
  if (pendingFinish) {
    resolvePromise(null);
    return promise;
  }
  let settled = false;
  let dialog: any = null;
  const appWindow = Application.instance.windows.fromBrowserWindow(browserWindow);
  const tab = appWindow?.viewManager?.getById(tabId);
  if (!appWindow || !tab || browserWindow.isDestroyed()) {
    resolvePromise(null);
    return promise;
  }
  const finish = (selection: IDisplayCaptureSelection | null = null, hide = true) => {
    if (settled) return;
    settled = true;
    if (pendingFinish === cancel) pendingFinish = null;
    tab.requestedDisplayCapture = null;
    if (hide) dialog?.hide();
    resolvePromise(selection);
  };
  const cancel = () => finish(null);
  pendingFinish = cancel;

  // Register before source enumeration so tab/window destruction can cancel the
  // request while desktopCapturer.getSources() is still pending.
  tab.requestedDisplayCapture = {
    url,
    sources: [],
    videoRequested,
    audioRequested,
    audioAvailable: audioRequested && process.platform === 'win32',
  };
  let sources: IDisplayCaptureSource[] = [];
  try {
    const nativeSources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 240, height: 140 },
      fetchWindowIcons: false,
    });
    sources = nativeSources.map((source) => ({
      id: source.id,
      name: source.name,
      type: source.id.startsWith('window:') ? 'window' : 'screen',
      thumbnail: source.thumbnail?.toDataURL(),
    }));
  } catch (error) {
    console.warn('[display-capture] enumerate sources failed', error);
  }
  if (
    settled ||
    browserWindow.isDestroyed() ||
    appWindow.viewManager.getById(tabId) !== tab ||
    !tab.requestedDisplayCapture
  ) {
    finish(null, false);
    return promise;
  }
  tab.requestedDisplayCapture = {...tab.requestedDisplayCapture, sources};
  try {
    dialog = Application.instance.dialogs.show({
      name: 'display-capture',
      browserWindow,
      getBounds: () => ({ width: WIDTH, height: HEIGHT, x: sidebarOffset(appWindow), y: VIEW_Y_OFFSET }),
      tabAssociation: { tabId, getTabInfo: (id: number) => appWindow.viewManager.getById(id)?.requestedDisplayCapture },
      onWindowBoundsUpdate: (disposition) => { if (disposition === 'resize') dialog.rearrange(); },
      onHide: () => finish(null, false),
    });
  } catch (error) {
    console.warn('[display-capture] failed to show chooser', error);
    finish(null, false);
    return promise;
  }
  if (!dialog) {
    finish(null, false);
    return promise;
  }
  dialog.on('result', (_event: any, result: any) => {
    const source = sources.find((item) => item.id === result?.id);
    finish(source ? {
      id: source.id,
      name: source.name,
      shareAudio: result?.shareAudio === true && audioRequested && process.platform === 'win32',
    } : null);
  });
  return promise;
};

export const cancelDisplayCaptureRequest = () => { pendingFinish?.(); };
