import * as remote from '@electron/remote';

const params = new URLSearchParams(window.location.search);

export const isImmersiveHeaderWindow = () => params.get('immersiveHeader') === '1';

export const getTargetWindowId = () => {
  const source = params.get('sourceWindowId');
  const id = source ? parseInt(source, 10) : NaN;

  return Number.isFinite(id) ? id : remote.getCurrentWindow().id;
};

export const getCurrentWindow = () =>
  remote.BrowserWindow.fromId(getTargetWindowId()) || remote.getCurrentWindow();

export const closeWindow = () => {
  getCurrentWindow().close();
};

export const minimizeWindow = () => {
  getCurrentWindow().minimize();
};

export const maximizeWindow = () => {
  const currentWindow = getCurrentWindow();

  if (currentWindow.isMaximized()) {
    currentWindow.unmaximize();
  } else {
    currentWindow.maximize();
  }
};
