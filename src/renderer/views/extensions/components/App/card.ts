import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';
import { getPalette } from '~/renderer/views/bookmarks/utils/palette';

// 扩展卡片 + 详情面板样式(chrome://extensions 风格)。

export const Card = styled.div`
  display: flex;
  flex-flow: column;
  border-radius: 16px;
  padding: 18px;
  min-height: 150px;
  transition: box-shadow 0.16s ease, transform 0.16s ease;

  ${({ theme, dimmed }: { theme?: ITheme; dimmed?: boolean }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.bg};
      border: 1px solid ${p.line};
      opacity: ${dimmed ? 0.62 : 1};

      &:hover {
        box-shadow: 0 6px 20px rgba(20, 30, 60, 0.08);
      }
    `;
  }}
`;

export const CardHead = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

export const ExtIcon = styled.div`
  width: 40px;
  height: 40px;
  min-width: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  svg {
    opacity: 0.4;
  }

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      box-shadow: inset 0 0 0 1px ${p.line};
      color: ${p.textSub};
    `;
  }}
`;

export const CardTitle = styled.div`
  flex: 1;
  min-width: 0;
`;

export const ExtName = styled.div`
  font-size: 15px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const ExtMeta = styled.div`
  margin-top: 2px;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 8px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

export const Badge = styled.span`
  display: inline-block;
  padding: 1px 7px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.primarySoft};
      color: ${p.primary};
    `;
  }}
`;

export const ExtDesc = styled.div`
  margin-top: 12px;
  flex: 1;
  font-size: 13px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const ExtId = styled.div`
  margin-top: 8px;
  font-size: 11px;
  font-family: monospace;
  word-break: break-all;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

export const CardFoot = styled.div`
  margin-top: 14px;
  padding-top: 14px;
  display: flex;
  align-items: center;
  gap: 6px;

  ${({ theme }: { theme?: ITheme }) => css`
    border-top: 1px solid ${getPalette(theme).line};
  `}
`;

export const Spacer = styled.div`
  flex: 1;
`;

export const TextButton = styled.button`
  border: none;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  padding: 6px 10px;
  border-radius: 8px;
  transition: background-color 0.16s ease, color 0.16s ease;

  ${({ theme, danger }: { theme?: ITheme; danger?: boolean }) => {
    const p = getPalette(theme);
    const c = danger ? p.danger : p.textSub;
    return css`
      color: ${c};

      &:hover {
        background-color: ${c}14;
        color: ${danger ? p.danger : p.primary};
      }
    `;
  }}
`;

// ===== 详情页(chrome://extensions 的独立详情视图) =====

// 覆盖扩展列表和侧栏，让详情拥有和 Chrome 一致的整页浏览体验。
export const ModalBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1000;
  overflow-y: auto;

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${getPalette(theme).bg};
  `}
`;

// 详情内容在大屏上保持 Chrome 详情页的宽幅留白，小屏自动收窄。
export const Detail = styled.div`
  width: 100%;
  max-width: 1080px;
  min-height: 100%;
  margin: 0 auto;
  padding: 18px 28px 48px;
  box-sizing: border-box;

  @media (max-width: 720px) {
    padding: 12px 14px 32px;
  }
`;

export const DetailPageHead = styled.div`
  height: 46px;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
`;

export const DetailBack = styled.button`
  width: 36px;
  height: 36px;
  margin-left: -8px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 0.16s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};

      &:hover {
        background-color: ${p.surface};
      }
    `;
  }}
`;

export const DetailPageTitle = styled.h1`
  min-width: 0;
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const DetailCard = styled.div`
  overflow: hidden;
  border-radius: 22px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      border: 1px solid ${p.line};
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
    `;
  }}
`;

export const DetailHero = styled.div`
  min-height: 112px;
  padding: 26px 30px;
  display: flex;
  align-items: center;
  gap: 16px;
  box-sizing: border-box;

  @media (max-width: 520px) {
    padding: 22px 20px;
  }
`;

export const DetailIcon = styled(ExtIcon)`
  width: 52px;
  height: 52px;
  min-width: 52px;
  border-radius: 12px;
`;

export const DetailIdentity = styled.div`
  flex: 1;
  min-width: 0;
`;

export const DetailName = styled.div`
  font-size: 17px;
  line-height: 1.35;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const DetailMeta = styled.div`
  margin-top: 4px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px 14px;
  font-size: 12px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const DetailSection = styled.section`
  padding: 18px 30px 22px;

  @media (max-width: 520px) {
    padding: 16px 20px 20px;
  }

  ${({ theme }: { theme?: ITheme }) => css`
    border-top: 1px solid ${getPalette(theme).line};
  `}
`;

export const DetailSectionTitle = styled.h2`
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.5;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const DetailText = styled.div`
  font-size: 13px;
  line-height: 1.65;
  word-break: break-word;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const DetailPermissionList = styled.ul`
  margin: 5px 0 0;
  padding-left: 20px;
  font-size: 13px;
  line-height: 1.7;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const DetailSetting = styled.div`
  min-height: 66px;
  padding: 16px 30px;
  display: flex;
  align-items: center;
  gap: 24px;

  @media (max-width: 520px) {
    padding: 15px 20px;
  }

  ${({ theme }: { theme?: ITheme }) => css`
    border-top: 1px solid ${getPalette(theme).line};
  `}
`;

export const DetailSettingBody = styled.div`
  flex: 1;
  min-width: 0;
`;

export const DetailSettingTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const DetailSettingText = styled.div`
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.55;
  word-break: break-word;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const DetailValue = styled.div`
  max-width: 48%;
  padding: 8px 12px;
  border-radius: 9px;
  font-size: 12px;
  line-height: 1.45;
  text-align: right;
  word-break: break-all;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textSub};
      background-color: ${p.bg};
      border: 1px solid ${p.line};
    `;
  }}
`;

export const DetailAllowed = styled.div`
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 600;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).primary};
  `}
`;

export const DetailActions = styled.div`
  padding: 22px 30px 28px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;

  ${({ theme }: { theme?: ITheme }) => css`
    border-top: 1px solid ${getPalette(theme).line};
  `}

  @media (max-width: 520px) {
    padding: 20px;
  }
`;

export const DetailButton = styled.button`
  min-height: 36px;
  padding: 7px 15px;
  border-radius: 9px;
  background: transparent;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.16s ease;

  &:disabled {
    cursor: default;
    opacity: 0.45;
  }

  ${({ theme, danger }: { theme?: ITheme; danger?: boolean }) => {
    const p = getPalette(theme);
    const color = danger ? p.danger : p.primary;
    return css`
      color: ${color};
      border: 1px solid ${color};

      &:hover {
        background-color: ${color}12;
      }

      &:disabled:hover {
        background-color: transparent;
      }
    `;
  }}
`;

export const DetailLink = styled.button`
  max-width: 100%;
  padding: 0;
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: inherit;
  color: inherit;
  cursor: pointer;
  text-align: left;
  word-break: break-all;

  &:disabled {
    cursor: default;
    opacity: 0.55;
    text-decoration: none;
  }

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.primary};

      &:hover {
        text-decoration: underline;
      }
    `;
  }}
`;

export const DetailInspectList = styled.div`
  margin-top: 4px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 14px;

  ${DetailLink} {
    line-height: 1.6;
  }
`;

export const DetailInspectFeedback = styled.div`
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.55;

  ${({ theme, error }: { theme?: ITheme; error?: boolean }) => {
    const p = getPalette(theme);
    return css`
      color: ${error ? p.danger : p.textSub};
    `;
  }}
`;
