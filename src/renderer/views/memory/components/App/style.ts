import styled, { css } from 'styled-components';

import type { ITheme } from '~/interfaces';
import type { MemoryProcessCategory } from '~/interfaces/memory';
import { getPalette } from '~/renderer/views/bookmarks/utils/palette';

export const Page = styled.div`
  flex: 1;
  min-width: 0;
  height: 100vh;
  overflow: hidden;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background: ${p.bg};
    `;
  }}
`;

export const MainScroll = styled.div`
  width: 100%;
  height: 100%;
  overflow: auto;

  &::-webkit-scrollbar {
    width: 9px;
  }

  &::-webkit-scrollbar-thumb {
    border: 3px solid transparent;
    border-radius: 999px;
    background: rgba(125, 139, 170, 0.3);
    background-clip: content-box;
  }
`;

export const Main = styled.main`
  width: min(1040px, calc(100% - 48px));
  margin: 0 auto;
  padding: 28px 0 48px;

  @media (max-width: 760px) {
    width: calc(100% - 28px);
    padding-top: 20px;
  }
`;

export const Header = styled.header`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;

  @media (max-width: 760px) {
    align-items: flex-start;
    flex-flow: column;
    gap: 12px;
  }
`;

export const HeaderCopy = styled.div`
  min-width: 0;
`;

export const Title = styled.h1`
  margin: 0;
  font-size: 26px;
  font-weight: 820;
  line-height: 1.2;
  letter-spacing: -0.03em;
`;

export const Subtitle = styled.p`
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.5;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

export const LiveBadge = styled.div`
  height: 32px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 11px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 650;
  white-space: nowrap;

  i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #29b47e;
    box-shadow: 0 0 0 3px rgba(41, 180, 126, 0.12);
  }

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textSub};
      background: ${p.surface};
      box-shadow: inset 0 0 0 1px ${p.line};
    `;
  }}
`;

export const RefreshButton = styled.button`
  height: 32px;
  border: 0;
  border-radius: 10px;
  padding: 0 11px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: #fff;
  background: #4968e8;
  font-family: inherit;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.14s ease, transform 0.14s ease;

  &:hover {
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(0);
  }

  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
`;

export const Overview = styled.section`
  min-height: 94px;
  margin-top: 20px;
  padding: 16px 20px;
  border-radius: 16px;
  display: grid;
  grid-template-columns: minmax(260px, 1fr) repeat(3, minmax(100px, auto));
  align-items: center;
  gap: 0;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background: ${p.surface};
      box-shadow: inset 0 0 0 1px ${p.line}, 0 5px 18px rgba(35, 48, 92, 0.035);
    `;
  }}

  @media (max-width: 760px) {
    grid-template-columns: repeat(3, 1fr);
    row-gap: 14px;
  }
`;

export const OverviewMain = styled.div`
  min-width: 0;
  padding-right: 22px;

  @media (max-width: 760px) {
    grid-column: 1 / -1;
    padding-right: 0;
  }
`;

export const OverviewLabel = styled.div`
  font-size: 10px;
  font-weight: 700;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const OverviewValue = styled.div`
  margin-top: 3px;
  font-size: 30px;
  font-weight: 860;
  line-height: 1.15;
  letter-spacing: -0.045em;
`;

export const OverviewMeta = styled.div`
  margin-top: 3px;
  font-size: 9px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

export const OverviewStat = styled.div`
  min-width: 110px;
  padding: 5px 18px;

  ${({ theme }: { theme?: ITheme }) => css`
    border-left: 1px solid ${getPalette(theme).line};
  `}

  @media (max-width: 760px) {
    min-width: 0;
    padding: 4px 10px;

    &:nth-child(2) {
      border-left: 0;
    }
  }
`;

export const OverviewStatValue = styled.div`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 16px;
  font-weight: 800;
  line-height: 1.3;
`;

export const OverviewStatLabel = styled.div`
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 9px;
  font-weight: 600;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

export const Section = styled.section`
  margin-top: 22px;
`;

export const SectionHeader = styled.div`
  min-height: 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 10px;

  @media (max-width: 620px) {
    align-items: flex-start;
    flex-flow: column;
    gap: 8px;
  }
`;

export const SectionTitleWrap = styled.div`
  min-width: 0;
`;

export const SectionTitle = styled.h2`
  margin: 0;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: -0.015em;
`;

export const SectionHint = styled.div`
  margin-top: 2px;
  font-size: 9px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

export const Filters = styled.div`
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px;
  border-radius: 10px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background: ${p.surface};
      box-shadow: inset 0 0 0 1px ${p.line};
    `;
  }}
`;

export const FilterButton = styled.button`
  height: 26px;
  border: 0;
  border-radius: 7px;
  padding: 0 10px;
  font-family: inherit;
  font-size: 9px;
  font-weight: 700;
  cursor: pointer;

  ${({ theme, selected }: { theme?: ITheme; selected: boolean }) => {
    const p = getPalette(theme);
    return css`
      color: ${selected ? '#fff' : p.textSub};
      background: ${selected ? p.primary : 'transparent'};

      &:hover {
        color: ${selected ? '#fff' : p.textMain};
        background: ${selected ? p.primary : p.bg};
      }
    `;
  }}
`;

export const ProcessList = styled.div`
  display: flex;
  flex-flow: column;
  gap: 6px;
`;

export const ProcessCard = styled.article`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 13px 15px;
  border-radius: 14px;
  transition: box-shadow 0.14s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background: ${p.surface};
      box-shadow: inset 0 0 0 1px ${p.line};

      &:hover {
        box-shadow: inset 0 0 0 1px ${p.primary}28,
          0 4px 14px rgba(35, 48, 92, 0.05);
      }
    `;
  }}
`;

export const ProcessIcon = styled.div`
  width: 34px;
  height: 34px;
  min-width: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;

  svg {
    width: 17px;
    height: 17px;
  }

  ${({ category }: { category: MemoryProcessCategory }) => {
    const colors: Record<MemoryProcessCategory, [string, string]> = {
      browser: ['#4968E8', 'rgba(73, 104, 232, 0.11)'],
      tab: ['#24A77A', 'rgba(36, 167, 122, 0.11)'],
      extension: ['#9B61E8', 'rgba(155, 97, 232, 0.11)'],
      gpu: ['#E98A3D', 'rgba(233, 138, 61, 0.11)'],
      utility: ['#3F9EDB', 'rgba(63, 158, 219, 0.11)'],
      other: ['#8B96AC', 'rgba(139, 150, 172, 0.11)'],
    };
    return css`
      color: ${colors[category][0]};
      background: ${colors[category][1]};
    `;
  }}
`;

export const ProcessMain = styled.div`
  min-width: 0;
  flex: 1;
`;

export const ProcessTop = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
`;

export const ProcessIdentity = styled.div`
  min-width: 0;
  flex: 1;
`;

export const ProcessName = styled.div`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 780;
  line-height: 1.35;
`;

export const ProcessDescription = styled.div`
  margin-top: 2px;
  font-size: 9px;
  line-height: 1.45;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const ProcessBadges = styled.div`
  margin-top: 5px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`;

export const Badge = styled.span`
  max-width: 300px;
  height: 17px;
  display: inline-flex;
  align-items: center;
  padding: 0 6px;
  border-radius: 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 7px;
  font-weight: 700;

  ${({ theme, color }: { theme?: ITheme; color?: string }) => {
    const p = getPalette(theme);
    return css`
      color: ${color || p.textSub};
      background: ${color ? `${color}12` : p.bg};
      box-shadow: inset 0 0 0 1px ${color ? `${color}20` : p.line};
    `;
  }}
`;

export const ProcessUsage = styled.div`
  min-width: 100px;
  display: flex;
  flex-flow: column;
  align-items: flex-end;
`;

export const MemoryNumber = styled.div`
  font-size: 14px;
  font-weight: 820;
  line-height: 1.25;
  letter-spacing: -0.02em;
`;

export const CpuNumber = styled.div`
  margin-top: 1px;
  font-size: 8px;
  font-weight: 600;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

export const UsageTrack = styled.div`
  height: 3px;
  margin-top: 8px;
  overflow: hidden;
  border-radius: 999px;

  ${({ theme }: { theme?: ITheme }) => css`
    background: ${getPalette(theme).bg};
  `}
`;

export const UsageFill = styled.div`
  height: 100%;
  min-width: 2px;
  border-radius: inherit;
  transition: width 0.3s ease;

  ${({ color }: { color: string }) => css`
    background: ${color};
  `}
`;

export const TabChips = styled.div`
  margin-top: 7px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`;

export const TabChip = styled.span`
  max-width: 240px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 7px;
  border-radius: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 8px;
  font-weight: 600;

  span {
    flex-shrink: 0;
    font-size: 6px;
    font-weight: 850;
  }

  ${({ theme, selected }: { theme?: ITheme; selected?: boolean }) => {
    const p = getPalette(theme);
    return css`
      color: ${selected ? p.primary : p.textSub};
      background: ${selected ? p.primarySoft : p.bg};
      box-shadow: inset 0 0 0 1px ${selected ? `${p.primary}20` : p.line};
    `;
  }}
`;

export const EmptyState = styled.div`
  padding: 42px 20px;
  border-radius: 14px;
  text-align: center;
  font-size: 10px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMute};
      background: ${p.surface};
      box-shadow: inset 0 0 0 1px ${p.line};
    `;
  }}
`;

export const ErrorState = styled.div`
  padding: 34px 20px;
  border-radius: 14px;
  display: flex;
  flex-flow: column;
  align-items: center;
  text-align: center;

  strong {
    font-size: 12px;
  }

  span {
    margin-top: 4px;
    font-size: 9px;
  }

  button {
    margin-top: 12px;
    height: 28px;
    border: 0;
    border-radius: 8px;
    padding: 0 11px;
    color: #fff;
    background: #4968e8;
    font-family: inherit;
    font-size: 9px;
    font-weight: 700;
    cursor: pointer;
  }

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textSub};
      background: ${p.surface};
      box-shadow: inset 0 0 0 1px ${p.line};
    `;
  }}
`;
