import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';

export const StyledList = styled.div`
  width: 100%;
  flex: 1;
  min-height: 0;
  overflow-y: auto;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(100, 110, 130, 0.36);
  }
`;

export const StyledItem = styled.div`
  width: 100%;
  height: 46px;
  padding: 0 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: 8px;
  box-sizing: border-box;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.15s ease, transform 0.15s ease;

  ${({ theme }: { theme: ITheme }) => css`
    &:hover {
      background-color: ${theme['dialog.lightForeground']
        ? 'rgba(104, 143, 236, 0.22)'
        : 'rgba(71, 114, 232, 0.09)'};
      transform: translateX(1px);
    }
  `}
`;

export const ItemIcon = styled.div`
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 8px;
  color: #4772e8;
  background: rgba(71, 114, 232, 0.1);
`;

export const ItemBody = styled.div`
  flex: 1;
  min-width: 0;
`;

export const Text = styled.div`
  font-size: 12px;
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const Details = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-top: 2px;
  font-size: 10px;
  opacity: 0.58;
`;

export const PasswordMask = styled.span`
  flex-shrink: 0;
  letter-spacing: 1px;
`;

export const Host = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &::before {
    content: '·';
    margin-right: 8px;
  }
`;
