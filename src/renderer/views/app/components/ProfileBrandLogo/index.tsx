import { Camera } from '@phosphor-icons/react';
import { ipcRenderer } from 'electron';
import * as React from 'react';
import styled, { css } from 'styled-components';

import { BrandLogo } from '../Titlebar/style';
import { getShellTranslator } from '../../utils/i18n';

export interface IProfileBrandInfo {
  profileName: string | null;
  logoDataUrl: string | null;
}

interface IProfileBrandResult {
  ok: boolean;
  canceled?: boolean;
  message?: string;
  brand?: IProfileBrandInfo;
}

const EMPTY_BRAND: IProfileBrandInfo = {
  profileName: null,
  logoDataUrl: null,
};

const PROFILE_COLORS = [
  '#3367d6',
  '#00897b',
  '#d1495b',
  '#7b5eb5',
  '#c05621',
  '#18794e',
  '#b42368',
  '#52606d',
];

const colorForProfile = (name: string): string => {
  let hash = 0;
  for (const character of Array.from(name)) {
    hash = (hash * 31 + (character.codePointAt(0) || 0)) >>> 0;
  }
  return PROFILE_COLORS[hash % PROFILE_COLORS.length];
};

export const useProfileBrand = () => {
  const [brand, setBrand] = React.useState<IProfileBrandInfo>(EMPTY_BRAND);

  React.useEffect(() => {
    let active = true;
    ipcRenderer
      .invoke('profile-brand-get')
      .then((next: IProfileBrandInfo) => {
        if (active && next) setBrand(next);
      })
      .catch((error) => console.error('[profile-brand] 读取失败:', error));

    const onUpdated = (_event: Electron.IpcRendererEvent, next: IProfileBrandInfo) => {
      if (active && next) setBrand(next);
    };
    ipcRenderer.on('profile-brand-updated', onUpdated);
    return () => {
      active = false;
      ipcRenderer.removeListener('profile-brand-updated', onUpdated);
    };
  }, []);

  const selectLogo = React.useCallback(async () => {
    try {
      const result = (await ipcRenderer.invoke(
        'profile-brand-select',
      )) as IProfileBrandResult;
      if (result.ok && result.brand) setBrand(result.brand);
      if (!result.ok && result.message) {
        console.error('[profile-brand] 更换失败:', result.message);
      }
    } catch (error) {
      console.error('[profile-brand] 更换失败:', error);
    }
  }, []);

  return { ...brand, selectLogo };
};

const LogoFrame = styled(BrandLogo)<{ $interactive: boolean }>`
  overflow: hidden;
  flex-shrink: 0;

  ${({ $interactive }) =>
    $interactive &&
    css`
      cursor: pointer;

      &:hover > [data-profile-logo-overlay],
      &:focus-visible > [data-profile-logo-overlay] {
        opacity: 1;
      }

      &:focus-visible {
        outline: 2px solid #4c6fff;
        outline-offset: 2px;
      }
    `}
`;

const ProfileInitial = styled.span<{ $background: string }>`
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  background: ${({ $background }) => $background};
  color: #ffffff;
  font-size: 17px;
  font-weight: 700;
  line-height: 1;
`;

const ProfileImage = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

const ChangeOverlay = styled.span`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  background: rgba(17, 24, 39, 0.58);
  opacity: 0;
  transition: opacity 120ms ease;
  pointer-events: none;
`;

export const ProfileBrandLogo = ({
  profileName,
  logoDataUrl,
  appIcon,
  onInteractStart,
  onSelect,
}: IProfileBrandInfo & {
  appIcon: string;
  onInteractStart?: () => void;
  onSelect: () => void;
}) => {
  const t = getShellTranslator();
  const interactive = Boolean(profileName);
  const activate = (event: React.SyntheticEvent) => {
    if (!interactive) return;
    event.preventDefault();
    event.stopPropagation();
    onInteractStart?.();
    onSelect();
  };

  return (
    <LogoFrame
      $interactive={interactive}
      data-rainsee-part="brand-logo"
      data-profile-logo-action={interactive ? 'true' : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      title={interactive ? t('shellChangeLogo') : undefined}
      onMouseEnter={interactive ? onInteractStart : undefined}
      onMouseDown={(event) => {
        if (!interactive) return;
        event.stopPropagation();
        onInteractStart?.();
      }}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') activate(event);
      }}
    >
      {profileName ? (
        logoDataUrl ? (
          <ProfileImage src={logoDataUrl} alt={`${profileName} Logo`} draggable={false} />
        ) : (
          <ProfileInitial $background={colorForProfile(profileName)}>
            {Array.from(profileName)[0]}
          </ProfileInitial>
        )
      ) : (
        <img
          src={appIcon}
          alt={t('aboutTitle')}
          draggable={false}
          data-rainsee-part="brand-logo-icon"
          style={{ width: 22, height: 22 }}
        />
      )}
      {interactive && (
        <ChangeOverlay data-profile-logo-overlay>
          <Camera size={14} weight="bold" />
        </ChangeOverlay>
      )}
    </LogoFrame>
  );
};
