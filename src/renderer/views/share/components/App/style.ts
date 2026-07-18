import styled, { css } from 'styled-components';
import { ITheme } from '~/interfaces';
import { DialogStyle } from '~/renderer/mixins/dialogs';

export const StyledApp = styled(DialogStyle)`
  padding: 18px;
  border-radius: 26px;
  border: 1px solid rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  box-shadow:
    0 1px 4px rgba(20, 32, 72, 0.05),
    0 4px 12px rgba(20, 32, 72, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);

  ${({ theme }: { theme?: ITheme; visible: boolean }) => css`
    background-color: ${theme.dark
      ? 'rgba(40, 42, 48, 0.82)'
      : 'rgba(255, 255, 255, 0.82)'};
    color: ${theme['dialog.textColor']};
  `}
`;

export const Header = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
`;

export const Title = styled.div`
  font-size: 20px;
  font-weight: 900;
  line-height: 1.1;
  letter-spacing: -0.03em;
`;

export const Subtitle = styled.p`
  margin: 6px 0 0;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.45;
  color: #75809a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 280px;
`;

export const CloseButton = styled.button`
  flex-shrink: 0;
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

export const QrCard = styled.div`
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 22px;
  border-radius: 20px;
  background: #fff;
  box-shadow: inset 0 0 0 1px rgba(20, 32, 72, 0.06);
`;

export const QrImage = styled.img`
  width: 220px;
  height: 220px;
  border-radius: 12px;
  object-fit: contain;
`;

export const QrPlaceholder = styled.div`
  width: 220px;
  height: 220px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  color: #9aa3b1;
  background: #f5f7fb;
`;

export const QrHint = styled.div`
  font-size: 12px;
  font-weight: 700;
  color: #75809a;
`;

export const QrDownloadButton = styled.button`
  margin-top: 2px;
  height: 38px;
  padding: 0 18px;
  border: 0;
  border-radius: 12px;
  background: rgba(52, 82, 255, 0.1);
  color: #3452ff;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 7px;

  &:hover {
    background: rgba(52, 82, 255, 0.16);
  }

  &:disabled {
    color: #9aa3b1;
    background: #f0f2f7;
    cursor: default;
  }
`;

export const FieldLabel = styled.div`
  margin: 16px 0 8px;
  font-size: 13px;
  font-weight: 800;
  color: ${({ theme }: { theme?: ITheme }) =>
    theme.dark ? '#e8e8e8' : '#161b2d'};
`;

export const LinkRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

export const LinkText = styled.div`
  flex: 1;
  min-width: 0;
  height: 44px;
  display: flex;
  align-items: center;
  padding: 0 14px;
  border: 1px solid #b8d9ff;
  border-radius: 14px;
  background: #fff;
  font-size: 13px;
  font-weight: 700;
  color: #161b2d;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  box-shadow: 0 0 0 3px rgba(186, 222, 255, 0.18);
`;

export const CopyButton = styled.button`
  flex-shrink: 0;
  height: 44px;
  padding: 0 18px;
  border: 0;
  border-radius: 14px;
  background: #3452ff;
  color: #fff;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;

  &:disabled {
    background: #c6cee0;
    cursor: default;
  }
`;

