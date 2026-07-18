import { ipcRenderer } from 'electron';
import store from '../store';

export const isDialogVisible = async (dialog: string) =>
  await ipcRenderer.invoke(`is-dialog-visible-${store.windowId}`, dialog);

export interface IAddressBarSearchAnchor {
  x: number;
  y: number;
  width: number;
}

export const getAddressBarSearchAnchor = (
  element?: HTMLElement | null,
): IAddressBarSearchAnchor | null => {
  const anchor = element || document.getElementById('addressbar');
  if (!anchor) return null;

  const { left, top, width } = anchor.getBoundingClientRect();

  return {
    x: left,
    y: top,
    width,
  };
};
