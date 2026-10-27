import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';
import { getPalette } from '../../utils/palette';

export const Card = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  border-radius: 18px;
  cursor: pointer;
  position: relative;
  transition: box-shadow 0.2s ease, background-color 0.2s ease,
    padding-left 0.18s ease;

  ${({ theme, selected, flash, dragging, dropBefore, dropAfter, dropInto, sortable, editMode }: {
    theme?: ITheme;
    selected?: boolean;
    flash?: boolean;
    dragging?: boolean;
    dropBefore?: boolean;
    dropAfter?: boolean;
    dropInto?: boolean;
    sortable?: boolean;
    editMode?: boolean;
  }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${dropInto ? p.primarySoft : p.surface};
      ${editMode ? 'padding-left: 56px;' : ''}
      box-shadow: inset 0 0 0
        ${dropInto ? '2px' : '1px'}
        ${dropInto ? p.primary : selected ? p.primary : p.line};
      opacity: ${dragging ? 0.66 : 1};

      &:hover {
        ${sortable ? 'padding-left: 56px;' : ''}
        box-shadow: inset 0 0 0 1px ${selected ? p.primary : `${p.primary}4d`},
          0 10px 30px -22px rgba(40, 60, 120, 0.3);
      }

      ${dragging &&
      sortable &&
      css`
        padding-left: 56px;
      `}

      ${flash &&
      css`
        box-shadow: inset 0 0 0 2px ${p.primary},
          0 12px 34px -18px ${p.primary}80;
        background-color: ${p.primarySoft};
      `}

      ${dropBefore &&
      css`
        &::before {
          content: '';
          position: absolute;
          left: 16px;
          right: 16px;
          top: -5px;
          height: 3px;
          border-radius: 999px;
          background-color: ${p.primary};
          box-shadow: 0 0 0 3px ${p.surface};
        }
      `}

      ${dropAfter &&
      css`
        &::after {
          content: '';
          position: absolute;
          left: 16px;
          right: 16px;
          bottom: -5px;
          height: 3px;
          border-radius: 999px;
          background-color: ${p.primary};
          box-shadow: 0 0 0 3px ${p.surface};
        }
      `}
    `;
  }}
`;

// 左侧重点标记触发圈:绝对定位于行左外侧的留白区,默认不占布局、不留空白;
// hover 行或已标记时淡入显示。已标记态为实心红圆,带描边/投影/高光质感。
export const FlagToggle = styled.div`
  position: absolute;
  left: -30px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  height: 24px;
  width: 24px;
  border-radius: 50%;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.18s ease, color 0.16s ease, background-color 0.16s ease,
    box-shadow 0.16s ease, transform 0.12s ease;

  ${({ theme, active }: { theme?: ITheme; active?: boolean }) => {
    const p = getPalette(theme);
    if (active) {
      // 已标记:小号实心红圆,通透质感(半透明红 + 柔光晕,非死板纯色块)。
      return css`
        opacity: 1;

        &::before {
          content: '';
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: radial-gradient(
            circle at 35% 30%,
            rgba(255, 138, 150, 0.95) 0%,
            ${p.danger} 60%,
            rgba(229, 86, 107, 0.92) 100%
          );
          box-shadow: 0 0 0 4px ${p.danger}1f,
            0 1px 4px -1px ${p.danger}99,
            inset 0 1px 1.5px rgba(255, 255, 255, 0.55);
          transition: box-shadow 0.16s ease, transform 0.12s ease;
        }

        &:hover::before {
          transform: scale(1.12);
          box-shadow: 0 0 0 5px ${p.danger}26,
            0 2px 7px -1px ${p.danger}b3,
            inset 0 1px 1.5px rgba(255, 255, 255, 0.6);
        }
      `;
    }
    return css`
      color: ${p.textMute};
      opacity: 0;

      &:hover {
        color: ${p.textSub};
        background-color: ${p.bg};
      }
    `;
  }}

  ${Card}:hover & {
    opacity: 1;
  }
`;

export const IconBox = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 44px;
  width: 44px;
  min-width: 44px;
  border-radius: 13px;
  overflow: hidden;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.primarySoft};
      color: ${p.primary};
    `;
  }}
`;

export const DragHandle = styled.button.attrs({
  type: 'button',
})`
  position: absolute;
  left: 16px;
  top: 50%;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 10px;
  background: transparent;
  cursor: grab;
  opacity: 0;
  pointer-events: none;
  transform: translate(-6px, -50%);
  transition: opacity 0.16s ease, transform 0.16s ease,
    background-color 0.16s ease, color 0.16s ease;

  &:active {
    cursor: grabbing;
  }

  ${({ alwaysVisible, theme }: { alwaysVisible?: boolean; theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMute};
      opacity: ${alwaysVisible ? 1 : 0};
      pointer-events: ${alwaysVisible ? 'auto' : 'none'};
      transform: ${alwaysVisible ? 'translate(0, -50%)' : 'translate(-6px, -50%)'};

      &:hover {
        color: ${p.textMain};
        background-color: ${p.bg};
      }
    `;
  }}

  ${Card}:hover &,
  ${Card}[data-dragging='true'] & {
    opacity: 1;
    pointer-events: auto;
    transform: translate(0, -50%);
  }
`;

export const Favicon = styled.div`
  height: 20px;
  width: 20px;
  background-size: contain;
  background-position: center;
  background-repeat: no-repeat;
`;

export const Info = styled.div`
  flex: 1;
  min-width: 0;
`;

export const Title = styled.div`
  font-size: 15px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const TitleAction = styled(Title).attrs({
  as: 'a',
})`
  display: block;
  width: fit-content;
  max-width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  text-decoration: none;
  cursor: ${({ editing }: { editing?: boolean }) =>
    editing ? 'default' : 'pointer'};

  &:hover {
    text-decoration: ${({ editing }: { editing?: boolean }) =>
      editing ? 'none' : 'underline'};
  }
`;

export const Site = styled.div`
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const SiteLink = styled(Site).attrs({
  as: 'a',
})`
  display: block;
  width: fit-content;
  max-width: 100%;
  text-decoration: none;
  cursor: inherit;
`;

export const RowActions = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s ease;

  ${Card}:hover & {
    opacity: 1;
  }
`;

export const IconButton = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  width: 36px;
  border-radius: 11px;
  cursor: pointer;
  transition: background-color 0.16s ease, color 0.16s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textSub};
      &:hover {
        background-color: ${p.bg};
        color: ${p.textMain};
      }
    `;
  }}
`;

export const DeleteButton = styled.button.attrs({ type: 'button' })`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  width: 36px;
  padding: 0;
  border: 0;
  border-radius: 11px;
  background: transparent;
  font: inherit;
  cursor: pointer;
  transition: background-color 0.16s ease, color 0.16s ease;
  color: ${({ theme }: { theme?: ITheme }) => getPalette(theme).danger};

  &:hover {
    color: ${({ theme }: { theme?: ITheme }) => getPalette(theme).danger};
    background-color: ${({ theme }: { theme?: ITheme }) =>
      `${getPalette(theme).danger}1a`};
  }
`;
