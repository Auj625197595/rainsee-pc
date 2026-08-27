import styled, { createGlobalStyle, css } from 'styled-components';

import { ITheme } from '~/interfaces';
import { getPalette } from '~/renderer/views/bookmarks/utils/palette';

// 拓展管理页:沿用 历史 / 书签 / 下载 的双栏视觉风格。
// 左侧 280px 侧栏(标题 + 搜索 + 筛选 + 开发者模式 + 安装入口) + 右侧扩展列表。

// ===== 侧边导航 =====

export const Sidebar = styled.div`
  width: 280px;
  min-width: 280px;
  height: 100vh;
  display: flex;
  flex-flow: column;
  padding: 24px 20px;
  overflow-y: auto;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.bg};
      border-right: 1px solid ${p.line};
    `;
  }}
`;

export const SideTitle = styled.h1`
  margin: 0;
  padding: 0 4px;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const SearchBox = styled.div`
  margin-top: 20px;
  height: 40px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  border-radius: 14px;

  svg {
    flex-shrink: 0;
  }

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
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
  font-size: 13px;
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

export const SectionLabel = styled.div`
  margin: 24px 0 8px;
  padding: 0 4px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

export const FilterNav = styled.nav`
  display: flex;
  flex-flow: column;
  gap: 2px;
`;

export const FilterButton = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  cursor: pointer;
  transition: background-color 0.16s ease;

  ${({ theme, selected }: { theme?: ITheme; selected?: boolean }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${selected ? p.primarySoft : 'transparent'};
      box-shadow: ${selected ? `inset 0 0 0 1px ${p.primary}26` : 'none'};

      &:hover {
        background-color: ${selected ? p.primarySoft : p.surface};
      }
    `;
  }}
`;

export const FilterIconBox = styled.span`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  width: 32px;
  min-width: 32px;
  border-radius: 10px;
  transition: background-color 0.16s ease, color 0.16s ease;

  ${({ theme, selected }: { theme?: ITheme; selected?: boolean }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${selected ? p.primary : p.surface};
      color: ${selected ? '#fff' : p.textSub};
      box-shadow: ${selected ? 'none' : `inset 0 0 0 1px ${p.line}`};
    `;
  }}
`;

export const FilterLabel = styled.span`
  flex: 1;
  min-width: 0;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  ${({ theme, selected }: { theme?: ITheme; selected?: boolean }) => {
    const p = getPalette(theme);
    return css`
      font-weight: ${selected ? 700 : 500};
      color: ${selected ? p.primary : p.textMain};
    `;
  }}
`;

export const FilterCount = styled.span`
  font-size: 12px;

  ${({ theme, selected }: { theme?: ITheme; selected?: boolean }) => {
    const p = getPalette(theme);
    return css`
      font-weight: ${selected ? 700 : 600};
      color: ${selected ? p.primary : p.textMute};
    `;
  }}
`;

// ===== 侧栏底部:开发者模式 + 安装入口 =====

export const BottomActions = styled.div`
  margin-top: auto;
  padding-top: 12px;

  ${({ theme }: { theme?: ITheme }) => css`
    border-top: 1px solid ${getPalette(theme).line};
  `}
`;

export const DevToggleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px 14px;
  font-size: 13px;
  font-weight: 600;

  & > span {
    flex: 1;
  }

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const InstallButton = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 12px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  transition: background-color 0.16s ease;

  svg {
    flex-shrink: 0;
  }

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textSub};

      &:hover {
        background-color: ${p.surface};
        color: ${p.primary};
      }
    `;
  }}
`;

// 「检查更新」按钮下方的结果提示小字。
export const UpdateStatus = styled.div`
  margin: 6px 4px 2px;
  font-size: 12px;
  line-height: 1.5;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

// ===== 从本地浏览器迁移 =====

export const MigrationMask = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1400;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background-color: rgba(15, 23, 42, 0.36);
`;

export const MigrationDialog = styled.div`
  width: min(720px, 100%);
  max-height: min(760px, calc(100vh - 48px));
  display: flex;
  flex-flow: column;
  overflow: hidden;
  border-radius: 8px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${p.bg};
      border: 1px solid ${p.line};
      box-shadow: 0 24px 70px rgba(15, 23, 42, 0.24);
    `;
  }}
`;

export const MigrationHeader = styled.div`
  min-height: 60px;
  padding: 0 18px 0 20px;
  display: flex;
  align-items: center;
  gap: 10px;

  ${({ theme }: { theme?: ITheme }) => css`
    border-bottom: 1px solid ${getPalette(theme).line};
  `}
`;

export const MigrationTitle = styled.h2`
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  line-height: 1.4;
`;

export const MigrationClose = styled.button`
  width: 34px;
  height: 34px;
  padding: 0;
  border: none;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background: transparent;

  &:disabled {
    cursor: default;
    opacity: 0.45;
  }

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textSub};
      &:hover:not(:disabled) {
        color: ${p.textMain};
        background-color: ${p.surface};
      }
    `;
  }}
`;

export const MigrationSources = styled.div`
  min-height: 38px;
  padding: 8px 20px;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;

  ${({ theme }: { theme?: ITheme }) => css`
    border-bottom: 1px solid ${getPalette(theme).line};
  `}
`;

export const MigrationSource = styled.span`
  flex-shrink: 0;
  font-size: 12px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const MigrationToolbar = styled.div`
  min-height: 48px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${getPalette(theme).surface};
    border-bottom: 1px solid ${getPalette(theme).line};
  `}
`;

export const MigrationSelectAll = styled.div`
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
`;

export const MigrationCheckbox = styled.span<{ $checked?: boolean }>`
  width: 18px;
  height: 18px;
  min-width: 18px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;

  & > span {
    width: 8px;
    height: 2px;
    background-color: #fff;
  }

  ${({ theme, $checked }: { theme?: ITheme; $checked?: boolean }) => {
    const p = getPalette(theme);
    return css`
      color: #fff;
      background-color: ${$checked ? p.primary : 'transparent'};
      border: 1px solid ${$checked ? p.primary : p.line};
    `;
  }}
`;

export const MigrationChooseDirectory = styled.button`
  min-height: 32px;
  padding: 5px 9px;
  border: none;
  display: flex;
  align-items: center;
  gap: 7px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  background: transparent;

  &:disabled {
    cursor: default;
    opacity: 0.45;
  }

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).primary};
  `}
`;

export const MigrationBody = styled.div`
  min-height: 280px;
  flex: 1;
  overflow-y: auto;
`;

export const MigrationState = styled.div<{ $error?: boolean }>`
  min-height: 280px;
  height: 100%;
  padding: 32px;
  display: flex;
  flex-flow: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
  font-size: 13px;

  ${({ theme, $error }: { theme?: ITheme; $error?: boolean }) => {
    const p = getPalette(theme);
    return css`
      color: ${$error ? p.danger : p.textMute};
    `;
  }}
`;

export const MigrationSpinner = styled.div`
  width: 30px;
  height: 30px;
  border-radius: 50%;
  animation: migration-spin 0.8s linear infinite;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      border: 3px solid ${p.line};
      border-top-color: ${p.primary};
    `;
  }}

  @keyframes migration-spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

export const MigrationList = styled.div`
  padding: 4px 0;
`;

export const MigrationRow = styled.div<{ $checked?: boolean }>`
  min-height: 70px;
  padding: 9px 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  outline: none;

  ${({ theme, $checked }: { theme?: ITheme; $checked?: boolean }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${$checked ? p.primarySoft : 'transparent'};
      border-bottom: 1px solid ${p.line};

      &:hover,
      &:focus-visible {
        background-color: ${$checked ? p.primarySoft : p.surface};
      }
    `;
  }}
`;

export const MigrationIcon = styled.div`
  width: 42px;
  height: 42px;
  min-width: 42px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textSub};
      background-color: ${p.surface};
      border: 1px solid ${p.line};
    `;
  }}
`;

export const MigrationInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

export const MigrationName = styled.div`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 700;
`;

export const MigrationMeta = styled.div`
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

export const MigrationDescription = styled.div`
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const MigrationFooter = styled.div`
  min-height: 64px;
  padding: 10px 18px 10px 20px;
  display: flex;
  align-items: center;
  gap: 16px;

  ${({ theme }: { theme?: ITheme }) => css`
    border-top: 1px solid ${getPalette(theme).line};
  `}
`;

export const MigrationFooterStatus = styled.div<{ $error?: boolean }>`
  flex: 1;
  min-width: 0;
  font-size: 12px;
  line-height: 1.45;

  ${({ theme, $error }: { theme?: ITheme; $error?: boolean }) => {
    const p = getPalette(theme);
    return css`
      color: ${$error ? p.danger : p.textMute};
    `;
  }}
`;

export const MigrationActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

export const MigrationButton = styled.button<{ $primary?: boolean }>`
  min-width: 76px;
  height: 36px;
  padding: 0 14px;
  border-radius: 6px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;

  &:disabled {
    cursor: default;
    opacity: 0.45;
  }

  ${({ theme, $primary }: { theme?: ITheme; $primary?: boolean }) => {
    const p = getPalette(theme);
    return $primary
      ? css`
          color: #fff;
          background-color: ${p.primary};
          border: 1px solid ${p.primary};
        `
      : css`
          color: ${p.textSub};
          background-color: transparent;
          border: 1px solid ${p.line};
        `;
  }}
`;

export const MigrationResponsiveStyle = createGlobalStyle`
@media (max-width: 620px) {
  ${MigrationMask} {
    padding: 12px;
  }

  ${MigrationDialog} {
    max-height: calc(100vh - 24px);
  }

  ${MigrationSources} {
    padding-left: 14px;
    padding-right: 14px;
  }

  ${MigrationToolbar},
  ${MigrationRow} {
    padding-left: 14px;
    padding-right: 14px;
  }

  ${MigrationFooter} {
    align-items: flex-start;
    flex-flow: column;
  }

  ${MigrationActions} {
    width: 100%;
    justify-content: flex-end;
  }
}
`;

// ===== 内容区 =====

export const MainScroll = styled.div`
  flex: 1;
  min-width: 0;
  height: 100vh;
  overflow: auto;
  padding: 36px 48px;

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${getPalette(theme).surface};
  `}

  &::-webkit-scrollbar {
    width: 9px;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(149, 163, 184, 0.28);
    border-radius: 9999px;
    border: 3px solid transparent;
    background-clip: content-box;
  }
`;

export const MainInner = styled.div`
  max-width: 1000px;
  margin: 0 auto;
  position: relative;
`;

export const MainHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
`;

export const MainTitle = styled.h2`
  flex: 1;
  margin: 0;
  font-size: 22px;
  font-weight: 750;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const HeaderAction = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.primary};
      &:hover { background: ${p.primarySoft}; }
    `;
  }}
`;

export const GroupSection = styled.section`
  margin-bottom: 28px;
`;

export const GroupHeader = styled.div`
  min-height: 42px;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  padding: 0 4px;
`;

export const GroupTitle = styled.h3`
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 16px;
  font-weight: 750;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: ${({ theme }: { theme?: ITheme }) => getPalette(theme).textMain};
`;

export const GroupCount = styled.span`
  flex-shrink: 0;
  font-size: 12px;
  color: ${({ theme }: { theme?: ITheme }) => getPalette(theme).textMute};
`;

export const GroupAction = styled.button`
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: ${({ theme }: { theme?: ITheme }) => getPalette(theme).textMute};
  cursor: pointer;
  &:hover {
    color: ${({ theme }: { theme?: ITheme }) => getPalette(theme).primary};
    background: ${({ theme }: { theme?: ITheme }) => getPalette(theme).primarySoft};
  }
`;

export const DragItem = styled.div`
  min-width: 0;
  cursor: grab;
  &:active { cursor: grabbing; }
`;

export const DropZone = styled.div<{ active?: boolean }>`
  min-height: 76px;
  padding: 18px;
  border-radius: 12px;
  border: 1px dashed ${({ theme }: { theme?: ITheme }) => getPalette(theme).line};
  color: ${({ theme }: { theme?: ITheme }) => getPalette(theme).textMute};
  font-size: 13px;
  text-align: center;
  transition: background-color .15s ease, border-color .15s ease;
  ${({ theme, active }: { theme?: ITheme; active?: boolean }) => active && css`
    border-color: ${getPalette(theme).primary};
    background: ${getPalette(theme).primarySoft};
    color: ${getPalette(theme).primary};
  `}
`;

export const GroupEditorMask = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.36);
`;

export const GroupEditorDialog = styled.form`
  width: min(400px, 100%);
  padding: 20px;
  border-radius: 8px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background: ${p.bg};
      border: 1px solid ${p.line};
      box-shadow: 0 20px 60px rgba(15, 23, 42, 0.24);
    `;
  }}
`;

export const GroupEditorTitle = styled.h3`
  margin: 0 0 16px;
  font-size: 17px;
`;

export const GroupEditorInput = styled.input`
  width: 100%;
  height: 40px;
  box-sizing: border-box;
  padding: 0 12px;
  border-radius: 8px;
  outline: none;
  font: inherit;
  font-size: 14px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background: ${p.surface};
      border: 1px solid ${p.line};
      &:focus { border-color: ${p.primary}; }
    `;
  }}
`;

export const GroupEditorActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
`;

export const GroupEditorButton = styled.button<{ primary?: boolean }>`
  height: 34px;
  min-width: 68px;
  padding: 0 14px;
  border: 0;
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;

  ${({ theme, primary }: { theme?: ITheme; primary?: boolean }) => {
    const p = getPalette(theme);
    return primary
      ? css`color: #fff; background: ${p.primary}; &:disabled { opacity: .5; }`
      : css`color: ${p.textSub}; background: ${p.surface};`;
  }}
`;

export const DragOverlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  pointer-events: none;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background: rgba(17, 24, 39, 0.18);
      backdrop-filter: blur(4px);
      color: ${p.textMain};
    `;
  }}
`;

export const DragCard = styled.div`
  width: min(520px, 100%);
  padding: 28px 32px;
  border-radius: 24px;
  text-align: center;

  svg {
    width: 42px;
    height: 42px;
    margin-bottom: 14px;
  }

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background: ${p.bg};
      border: 2px dashed ${p.primary};
      box-shadow: 0 24px 80px rgba(15, 23, 42, 0.18);
    `;
  }}
`;

export const DragTitle = styled.div`
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.03em;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const DragText = styled.div`
  margin-top: 10px;
  font-size: 14px;
  line-height: 1.7;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
`;

export const EmptyState = styled.div`
  display: flex;
  flex-flow: column;
  align-items: center;
  justify-content: center;
  padding: 120px 0;
  text-align: center;

  svg {
    opacity: 0.25;
    margin-bottom: 16px;
  }

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

export const EmptyText = styled.div`
  font-size: 14px;
  font-weight: 500;
`;

// ===== 拓展商店区(列表下方:分割线 + 商店卡片) =====

export const StoreDivider = styled.div`
  margin: 40px 0 28px;

  ${({ theme }: { theme?: ITheme }) => css`
    border-top: 1px solid ${getPalette(theme).line};
  `}
`;

export const StoreHeader = styled.div`
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 20px;
`;

export const StoreTitle = styled.h2`
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.01em;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const StoreSubtitle = styled.span`
  font-size: 13px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

export const StoreGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
`;

export const StoreCard = styled.div`
  display: flex;
  flex-flow: column;
  padding: 16px;
  border-radius: 16px;
  transition: box-shadow 0.16s ease, transform 0.16s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.bg};
      border: 1px solid ${p.line};

      &:hover {
        box-shadow: 0 6px 18px rgba(20, 32, 72, 0.08);
      }
    `;
  }}
`;

export const StoreCardHead = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

export const StoreIcon = styled.div`
  width: 40px;
  height: 40px;
  min-width: 40px;
  border-radius: 10px;
  background-size: contain;
  background-position: center;
  background-repeat: no-repeat;

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${getPalette(theme).surface};
  `}
`;

export const StoreName = styled.div`
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const StoreIntro = styled.div`
  margin: 12px 0 16px;
  font-size: 13px;
  line-height: 1.6;
  height: 62px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const StoreInstallBtn = styled.button<{ installed?: boolean }>`
  margin-top: auto;
  height: 36px;
  border: none;
  border-radius: 10px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.16s ease, background-color 0.16s ease;

  &:disabled {
    cursor: default;
  }

  ${({ theme, installed }: { theme?: ITheme; installed?: boolean }) => {
    const p = getPalette(theme);
    return installed
      ? css`
          background-color: ${p.surface};
          color: ${p.textMute};
          box-shadow: inset 0 0 0 1px ${p.line};
        `
      : css`
          background-color: ${p.primary};
          color: #fff;

          &:hover {
            opacity: 0.9;
          }
          &:disabled {
            opacity: 0.6;
          }
        `;
  }}
`;
