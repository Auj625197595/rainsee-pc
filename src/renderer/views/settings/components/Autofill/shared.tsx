import * as React from 'react';
import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';
import { getPalette } from '../../utils/palette';
import { SeDialog } from '../App/style';

// 「付款方式」「地址及更多」子页共用的小部件。

export const SubHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 600;
`;

export const BackButton = styled.button`
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 9px;
  cursor: pointer;
  background: transparent;
  color: inherit;

  ${({ theme }: { theme?: ITheme }) => css`
    &:hover {
      background: ${getPalette(theme).hover};
    }
  `}
`;

export const ListHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 18px 4px 8px;
  font-size: 13px;
  font-weight: 600;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const EmptyState = styled.div`
  padding: 28px 16px;
  text-align: center;
  font-size: 13px;
  line-height: 1.6;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}

  & strong {
    display: block;
    font-weight: 600;
    font-size: 14px;
    ${({ theme }: { theme?: ITheme }) => css`
      color: ${getPalette(theme).textMain};
    `}
  }
`;

export const ItemActions = styled.div`
  margin-left: auto;
  display: flex;
  gap: 4px;
  flex-shrink: 0;
`;

export const ActionButton = styled.button`
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
  background: transparent;

  ${({ theme, $danger }: { theme?: ITheme; $danger?: boolean }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textSub};
      &:hover {
        background: ${p.hover};
        color: ${$danger ? '#e5484d' : p.textMain};
      }
    `;
  }}
`;

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 998;
  background: rgba(10, 14, 28, 0.32);
`;

// 子页内的编辑弹窗。SeDialog 自带 fixed + translate 居中(勿改),这里只补遮罩和
// 点遮罩/Esc 关闭。
export const EditDialog = ({
  visible,
  onClose,
  children,
  width,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}) => {
  React.useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, onClose]);

  if (!visible) return null;
  return (
    <>
      <Backdrop onMouseDown={onClose} />
      <SeDialog
        visible
        role="dialog"
        aria-modal="true"
        onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
        style={width ? { width } : undefined}
      >
        {children}
      </SeDialog>
    </>
  );
};

export const FieldRow = styled.div`
  display: flex;
  gap: 12px;

  & > * {
    flex: 1;
    min-width: 0;
  }
`;

export const FieldError = styled.div`
  margin-top: 6px;
  font-size: 12px;
  color: #e5484d;
`;

export const NumberWrap = styled.div`
  position: relative;
  display: flex;
  align-items: center;

  & > input {
    flex: 1;
    padding-right: 42px;
  }

  & > button {
    position: absolute;
    right: 4px;
  }
`;

export const FormScroll = styled.div`
  max-height: min(60vh, 520px);
  overflow-y: auto;
  margin: 0 -6px;
  padding: 0 6px;
`;
