import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';
import { getPalette } from '~/renderer/views/bookmarks/utils/palette';

export const Topbar = styled.div`
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 28px;
  padding: 14px 40px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background: ${p.bg};
      border-bottom: 1px solid ${p.line};
    `;
  }}
`;

export const SearchWrap = styled.label`
  width: min(520px, 100%);
  height: 52px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 18px;
  border-radius: 8px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background: ${p.surface};
      border: 1px solid ${p.line};
      color: ${p.textMute};
    `;
  }}
`;

export const SearchInput = styled.input`
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 16px;
  font-family: inherit;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};

      &::placeholder {
        color: ${p.textMute};
      }
    `;
  }}
`;

export const ResetButton = styled.button`
  height: 40px;
  padding: 0 18px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: 0.16s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background: ${p.bg};
      color: ${p.primary};
      border: 1px solid ${p.primary}55;

      &:hover {
        background: ${p.primarySoft};
      }
    `;
  }}
`;

export const Content = styled.div`
  width: min(980px, calc(100vw - 64px));
  margin: 0 auto;
  padding: 28px 0 48px;
  font-family: 'Segoe UI', Tahoma, sans-serif;
`;

export const Hero = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
`;

export const HeroTitle = styled.h1`
  margin: 0;
  font-size: 22px;
  font-weight: 500;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const VersionText = styled.div`
  font-size: 15px;
  line-height: 1.4;
  text-align: right;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

export const WarningText = styled.p`
  margin: 22px 0 0;
  font-size: 15px;
  line-height: 1.45;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const WarningLead = styled.span`
  color: #d93025;
`;

export const RestartBanner = styled.div`
  margin-top: 18px;
  padding: 12px 14px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.5;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background: ${p.primarySoft};
      color: ${p.primary};
      border: 1px solid ${p.primary}22;
    `;
  }}
`;

export const Tabs = styled.div`
  display: flex;
  margin-top: 30px;
  border-bottom: 1px solid #e8eaed;
`;

export const TabButton = styled.button`
  flex: 1;
  height: 48px;
  border: none;
  background: transparent;
  position: relative;
  font-family: inherit;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;

  ${({ selected, theme }: { selected?: boolean; theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${selected ? p.primary : p.textSub};

      &::after {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        bottom: -1px;
        height: 3px;
        background: ${selected ? p.primary : 'transparent'};
      }
    `;
  }}
`;

export const List = styled.div`
  padding-top: 2px;
`;

export const FlagCard = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 226px;
  gap: 20px;
  align-items: center;
  padding: 16px 0 18px;

  ${({ theme }: { theme?: ITheme }) => css`
    border-bottom: 1px solid transparent;
  `}

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

export const FlagBody = styled.div``;

export const FlagTitle = styled.h3`
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.35;

  ${({ theme }: { theme?: ITheme }) => css`
    color: #202124;
  `}
`;

export const FlagDesc = styled.p`
  margin: 2px 0 0;
  font-size: 15px;
  line-height: 1.4;

  ${({ theme }: { theme?: ITheme }) => css`
    color: #5f6368;
  `}
`;

export const FlagLink = styled.a`
  display: inline-block;
  margin-top: 2px;
  font-size: 15px;
  line-height: 1.35;
  text-decoration: underline;

  ${({ theme }: { theme?: ITheme }) => css`
    color: #5f6368;
  `}
`;

export const SelectWrap = styled.div`
  display: flex;
  justify-content: flex-end;

  @media (max-width: 900px) {
    justify-content: flex-start;
  }
`;

export const Select = styled.select`
  width: 192px;
  height: 40px;
  padding: 0 36px 0 14px;
  font-size: 15px;
  font-family: 'Segoe UI', Tahoma, sans-serif;
  border-radius: 0;
  outline: none;
  cursor: pointer;

  ${({ theme }: { theme?: ITheme }) => {
    return css`
      background: #fff;
      color: #1a73e8;
      border: 1px solid #1a73e8;
    `;
  }}
`;

export const EmptyState = styled.div`
  padding: 56px 0;
  font-size: 14px;
  text-align: center;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

export const HighlightTitle = styled.span`
  display: inline;
  padding: 0 1px;
  background: #ffeb00;
`;
