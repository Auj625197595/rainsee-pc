import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';
import { DialogStyle } from '~/renderer/mixins/dialogs';

export const StyledApp = styled(DialogStyle)`
  padding: 14px;
  border-radius: 26px;
  border: 1px solid rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);

  ${({ theme }: { theme?: ITheme; visible: boolean }) => css`
    box-shadow: ${theme.dark
      ? `inset 0 1px 0 rgba(255, 255, 255, 0.04)`
      : `0 1px 4px rgba(20, 32, 72, 0.05),
         0 4px 12px rgba(20, 32, 72, 0.06),
         inset 0 1px 0 rgba(255, 255, 255, 0.7)`};
    background-color: ${theme.dark
      ? 'rgba(15, 18, 24, 0.88)'
      : 'rgba(255, 255, 255, 0.72)'};
    color: ${theme['dialog.textColor']};
  `}
`;

export const Surface = styled.div`
  position: relative;
`;

export const Header = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
`;

export const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

export const Eyebrow = styled.div`
  display: inline-flex;
  align-items: center;
  border-radius: 9999px;
  background: rgba(238, 242, 255, 0.9);
  padding: 4px 10px;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #3452ff;
`;

export const Title = styled.div`
  margin-top: 6px;
  font-size: 21px;
  font-weight: 900;
  line-height: 1.1;
  letter-spacing: -0.03em;
`;

export const Subtitle = styled.p`
  margin: 8px 0 0;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.45;
  color: #75809a;
`;

export const CloseButton = styled.button`
  height: 32px;
  width: 32px;
  border: 0;
  border-radius: 12px;
  background: #fff;
  color: #75809a;
  box-shadow: 0 6px 24px rgba(20, 32, 72, 0.06);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
`;

export const HeaderDeleteButton = styled.button`
  height: 32px;
  border: 0;
  border-radius: 12px;
  background: rgba(255, 96, 109, 0.12);
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 800;
  color: #e14b57;
  cursor: pointer;
`;

export const Body = styled.div`
  margin-top: 14px;
  display: grid;
  gap: 12px;
`;

export const Field = styled.label`
  display: grid;
  gap: 8px;
`;

export const FieldLabel = styled.span`
  font-size: 13px;
  font-weight: 800;
  color: #161b2d;
`;

export const Input = styled.input`
  height: 44px;
  width: 100%;
  border: 1px solid #b8d9ff;
  border-radius: 14px;
  background: #fff;
  padding: 0 14px;
  font-size: 14px;
  font-weight: 800;
  color: #161b2d;
  outline: none;
  box-shadow: 0 0 0 3px rgba(186, 222, 255, 0.18);

  &:focus {
    border-color: #87bdfd;
    box-shadow: 0 0 0 4px rgba(114, 177, 255, 0.2);
  }
`;

export const FolderTrigger = styled.button`
  width: 100%;
  border: 1px solid #e7ecf7;
  border-radius: 14px;
  background: #f4f7fc;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  text-align: left;
  cursor: pointer;
`;

export const FolderTriggerHint = styled.div`
  font-size: 11px;
  font-weight: 700;
  color: #8a94ab;
`;

export const FolderTriggerText = styled.div`
  margin-top: 4px;
  font-size: 14px;
  font-weight: 800;
  line-height: 1.4;
  color: #161b2d;
`;

export const FolderTriggerArrow = styled.span`
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #5f6b82;
  transform: ${({ expanded }: { expanded: boolean }) =>
    expanded ? 'rotate(90deg)' : 'rotate(0deg)'};
  transition: transform 0.16s ease;
`;

export const FolderPanel = styled.div`
  margin-top: 10px;
  border-radius: 18px;
  border: 1px solid #e6ebf6;
  background: rgba(244, 247, 252, 0.85);
  padding: 12px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.75);
`;

export const FolderPanelHead = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
`;

export const FolderPanelTitle = styled.div`
  font-size: 13px;
  font-weight: 800;
  color: #161b2d;
`;

export const FolderPanelActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

export const FolderToolbar = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
`;

export const SearchIcon = styled.span`
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  color: #8a94ab;
  pointer-events: none;
`;

export const SearchField = styled.input`
  height: 40px;
  flex: 1;
  min-width: 0;
  border: 1px solid #dce4f3;
  border-radius: 12px;
  background: #fff;
  padding: 0 14px 0 36px;
  font-size: 13px;
  font-weight: 700;
  color: #161b2d;
  outline: none;

  &::placeholder {
    color: #9ca6bc;
  }

  &:focus {
    border-color: #9ec8ff;
    box-shadow: 0 0 0 3px rgba(158, 200, 255, 0.18);
  }
`;

export const ToolbarMeta = styled.div`
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 800;
  color: #5f7df6;
`;

export const ToolbarButton = styled.button`
  height: 30px;
  flex-shrink: 0;
  border: 0;
  border-radius: 10px;
  background: rgba(52, 82, 255, 0.08);
  padding: 0 12px;
  font-size: 12px;
  font-weight: 800;
  color: #3452ff;
  cursor: pointer;
`;

export const TreeViewport = styled.div`
  margin-top: 12px;
  max-height: 254px;
  overflow-y: auto;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.78);
  padding: 8px;

  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(149, 163, 184, 0.38);
    border-radius: 999px;
  }
`;

export const TreeItemRow = styled.div`
  width: 100%;
  border-radius: 12px;
  background: ${({ selected }: { selected: boolean; depth: number }) =>
    selected ? 'rgba(52, 82, 255, 0.1)' : 'transparent'};
  padding: ${({ depth }: { selected: boolean; depth: number }) =>
    `9px 10px 9px ${10 + depth * 18}px`};
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.16s ease;

  &:hover {
    background: ${({ selected }: { selected: boolean; depth: number }) =>
      selected ? 'rgba(52, 82, 255, 0.12)' : 'rgba(231, 237, 248, 0.72)'};
  }
`;

export const TreeToggle = styled.button`
  height: 28px;
  width: 28px;
  min-width: 18px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #7d889d;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transform: ${({ expanded }: { expanded: boolean }) =>
    expanded ? 'rotate(90deg)' : 'rotate(0deg)'};
  transition: transform 0.16s ease;
`;

export const TreeToggleSpacer = styled.span`
  height: 18px;
  width: 18px;
  min-width: 18px;
`;

export const TreeIconBox = styled.span`
  height: 28px;
  width: 28px;
  min-width: 28px;
  border-radius: 9px;
  background: ${({ selected }: { selected: boolean }) =>
    selected ? '#3452ff' : '#edf2fb'};
  color: ${({ selected }: { selected: boolean }) =>
    selected ? '#fff' : '#6c7891'};
  display: inline-flex;
  align-items: center;
  justify-content: center;
`;

export const TreeLabel = styled.span`
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: ${({ selected }: { selected: boolean }) =>
    selected ? 800 : 700};
  color: ${({ selected }: { selected: boolean }) =>
    selected ? '#233fcf' : '#1f2738'};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const TreeMeta = styled.span`
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  color: #97a2b6;
`;

export const TreeCheck = styled.span`
  min-width: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: ${({ selected }: { selected: boolean }) =>
    selected ? '#3452ff' : 'transparent'};
`;

export const EmptyState = styled.div`
  padding: 28px 16px;
  text-align: center;
  font-size: 12px;
  font-weight: 700;
  color: #95a0b4;
`;

export const Buttons = styled.div`
  margin-top: 16px;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
`;

export const SecondaryButton = styled.button`
  height: 38px;
  min-width: 92px;
  border: 0;
  border-radius: 12px;
  background: #f2f4f8;
  color: #5f6679;
  font-size: 14px;
  font-weight: 800;
  box-shadow: 0 6px 24px rgba(20, 32, 72, 0.06);
  cursor: pointer;
`;

export const AccentSecondaryButton = styled.button`
  height: 38px;
  min-width: 112px;
  border: 0;
  border-radius: 12px;
  background: rgba(49, 149, 247, 0.12);
  color: #1976d2;
  font-size: 14px;
  font-weight: 800;
  box-shadow: 0 6px 24px rgba(20, 32, 72, 0.06);
  cursor: pointer;

  &:disabled {
    opacity: 0.7;
    cursor: default;
  }
`;

export const PrimaryButton = styled.button`
  height: 38px;
  min-width: 92px;
  border: 0;
  border-radius: 12px;
  background: #3195f7;
  color: #fff;
  font-size: 14px;
  font-weight: 800;
  box-shadow: 0 12px 24px rgba(49, 149, 247, 0.24);
  cursor: pointer;
`;
