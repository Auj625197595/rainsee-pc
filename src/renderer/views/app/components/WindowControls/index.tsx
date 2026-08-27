import { observer } from 'mobx-react-lite';
import * as React from 'react';
import { ipcRenderer } from 'electron';
import { platform } from 'os';

import store from '../../store';
import { ControlsContainer, ControlButton } from './style';

const onCloseClick = () => ipcRenderer.send(`window-close-${store.windowId}`);

const onMaximizeClick = () =>
  ipcRenderer.send(`window-toggle-maximize-${store.windowId}`);

const onMinimizeClick = () =>
  ipcRenderer.send(`window-minimize-${store.windowId}`);

const ICON_MIN = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <path d="M6 12h12"></path>
  </svg>
);

const ICON_MAX = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5.5" y="5.5" width="13" height="13" rx="2.5"></rect>
  </svg>
);

const ICON_CLOSE = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
    <path d="M18 6L6 18M6 6l12 12"></path>
  </svg>
);

export const WindowControls = observer(() => {
  if (platform() === 'darwin') return null;

  return (
    <ControlsContainer data-rainsee-part="window-controls">
      <ControlButton
        data-rainsee-action="window-minimize"
        onClick={onMinimizeClick}
        title="最小化"
      >
        {ICON_MIN}
      </ControlButton>
      <ControlButton
        data-rainsee-action="window-maximize"
        onClick={onMaximizeClick}
        title="最大化"
      >
        {ICON_MAX}
      </ControlButton>
      <ControlButton
        data-rainsee-action="window-close"
        close
        onClick={onCloseClick}
        title="关闭"
      >
        {ICON_CLOSE}
      </ControlButton>
    </ControlsContainer>
  );
});
