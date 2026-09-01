import {
  clipboard,
  ipcRenderer,
  nativeImage,
  shell,
  webFrame,
  webUtils,
} from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const electronRenderer = {
  clipboard,
  ipcRenderer,
  nativeImage,
  shell,
  webFrame,
  webUtils,
};

const href = window.location.href;
const isKoodo = href.startsWith('yjllq://web.koodoreader.com/');

const requireShim = (id: string) => {
  if (id === 'electron') return electronRenderer;
  if (isKoodo && id === 'fs') return fs;
  if (isKoodo && id === 'path') return path;
  return undefined;
};

if (isKoodo) {
  (window as any).require = requireShim;
  (window as any).electron = electronRenderer;
}
