import { configure } from 'mobx';
import { setIpcRenderer } from './rpc/electron';

export const configureUI = () => {
  configure({ enforceActions: 'never' });
};

// NOTE: We intentionally avoid a static `import { ipcRenderer } from 'electron'`
// here. webpack lowers that to a synchronous `require("electron")` (see the
// `externals` config), but this module is part of the shared `pre-entry`
// bundle that runs in every renderer — including pages with
// `nodeIntegration: false` (e.g. newtab), where `require` may not be defined
// at module-eval time. Resolving lazily lets `getInvoker` pick up the
// ipcRenderer once the preload has exposed it.
export const configureRenderer = () => {
  try {
    const electron =
      (window as any).electron ?? (window as any).require?.('electron');

    if (electron?.ipcRenderer) {
      setIpcRenderer(electron.ipcRenderer);
    }
  } catch {
    // ipcRenderer not available yet; getInvoker falls back to a lazy lookup.
  }
};
