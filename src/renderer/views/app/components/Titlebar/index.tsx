import { observer } from 'mobx-react-lite';
import * as React from 'react';

import store from '../../store';
import { Tabbar } from '../Tabbar';
import { platform } from 'os';
import {
  StyledTitlebar,
  FullscreenExitButton,
  Brand,
  BrandLogo,
  BrandHover,
  BrandText,
  BrandTitle,
  BrandSub,
  BrandSubRow,
} from './style';
const APP_ICON = require('!!file-loader?esModule=false&outputPath=res!../../../../../../static/icons/icon.png');

import { NavigationButtons } from '../NavigationButtons';
import { RightButtons } from '../RightButtons';
import { Separator } from '../RightButtons/style';
import { SiteButtons } from '../SiteButtons';
import { WindowControls } from '../WindowControls';
import { getCurrentWindow } from '../../utils/windows';
import { useWindowDragMove } from '../../utils/window-drag';

// 窗口拖拽逻辑已提取到 ../../utils/window-drag 的 useWindowDragMove,
// 供品牌区与侧栏顶部拖拽条复用。

const BrandMark = observer(() => {
  const { onMouseDown, onClick } = useWindowDragMove(() => {});

  return (
    <Brand>
      <BrandHover onMouseDown={onMouseDown} onClick={onClick}>
        <BrandLogo>
          <img src={APP_ICON} alt="雨见浏览器" draggable={false} style={{ width: 22, height: 22 }} />
        </BrandLogo>
        <BrandText>
          <BrandTitle>雨见浏览器</BrandTitle>
          <BrandSubRow>
            <BrandSub>RainPC</BrandSub>
          </BrandSubRow>
        </BrandText>
      </BrandHover>
    </Brand>
  );
});

const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
  if (store.addressbarFocused) {
    e.preventDefault();
  }
};

const onFullscreenExit = (e: React.MouseEvent<HTMLDivElement>) => {
  getCurrentWindow().setFullScreen(false);
};

export const Titlebar = observer(() => {
  return (
    <StyledTitlebar
      onMouseDown={onMouseDown}
      isFullscreen={store.isFullscreen}
      isHTMLFullscreen={store.isHTMLFullscreen}
    >
      {!store.isCompact && !store.isSidebar && <BrandMark />}
      {store.isCompact && <NavigationButtons />}
      <Tabbar />
      {store.isCompact && <RightButtons />}

      {platform() !== 'darwin' && (
        store.isFullscreen
          ? <FullscreenExitButton
            style={{
              height: store.isCompact ? '100%' : 32,
            }}
            onMouseUp={onFullscreenExit}
            theme={store.theme}
          />
          : <WindowControls />
      )}
    </StyledTitlebar>
  );
});
