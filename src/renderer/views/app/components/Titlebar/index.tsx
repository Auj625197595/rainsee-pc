import { observer } from 'mobx-react-lite';
import * as React from 'react';

import store from '../../store';
import { Tabbar } from '../Tabbar';
import { platform } from 'os';
import {
  StyledTitlebar,
  Brand,
  BrandHover,
  BrandText,
  BrandTitle,
  BrandSub,
  BrandSubRow,
  WorkspaceDot,
} from './style';
const APP_ICON = require('!!file-loader?esModule=false&outputPath=res!../../../../../../static/icons/icon2.png');

import { NavigationButtons } from '../NavigationButtons';
import { RightButtons } from '../RightButtons';
import { Separator } from '../RightButtons/style';
import { SiteButtons } from '../SiteButtons';
import { WindowControls } from '../WindowControls';
import { useWindowDragMove } from '../../utils/window-drag';
import { ProfileBrandLogo, useProfileBrand } from '../ProfileBrandLogo';
import { getShellTranslator } from '../../utils/i18n';

// 窗口拖拽逻辑已提取到 ../../utils/window-drag 的 useWindowDragMove,
// 供品牌区与侧栏顶部拖拽条复用。

const BrandMark = observer(() => {
  const t = getShellTranslator();
  const profileBrand = useProfileBrand();
  const workspace = store.workspaceContext;

  // 品牌区同时是窗口拖拽热区(no-drag + 按住拖动窗口)
  const { onMouseDown: onDragMouseDown, onClick: onDragClick } =
    useWindowDragMove(() => {});

  return (
    <Brand data-rainsee-part="brand">
      <BrandHover onMouseDown={onDragMouseDown} onClick={onDragClick}>
        <ProfileBrandLogo
          profileName={profileBrand.profileName}
          logoDataUrl={profileBrand.logoDataUrl}
          appIcon={APP_ICON}
          onSelect={profileBrand.selectLogo}
        />
        <BrandText data-rainsee-part="brand-text">
          <BrandTitle data-rainsee-part="brand-title" title={profileBrand.profileName || undefined}>
            {workspace?.name || profileBrand.profileName || t('aboutTitle')}
          </BrandTitle>
          <BrandSubRow>
            <BrandSub data-rainsee-part="brand-sub">{workspace ? t('shellWorkspace') : profileBrand.profileName ? t('shellAltProfile') : 'RainPC'}</BrandSub>
            {workspace && <WorkspaceDot color={workspace.color} title={t('shellCurrentWorkspace')} />}
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

export const Titlebar = observer(() => {
  return (
    <StyledTitlebar
      data-rainsee-part="titlebar"
      onMouseDown={onMouseDown}
      isFullscreen={store.isFullscreen}
      isHTMLFullscreen={store.isHTMLFullscreen}
    >
      {!store.isCompact && !store.isSidebar && <BrandMark />}
      {store.isCompact && <NavigationButtons />}
      <Tabbar />
      {store.isCompact && <RightButtons />}

      {platform() !== 'darwin' && <WindowControls />}
    </StyledTitlebar>
  );
});
