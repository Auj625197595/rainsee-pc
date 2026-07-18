import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';
import { DialogStyle } from '~/renderer/mixins/dialogs';

export const StyledApp = styled(DialogStyle)`
  position: relative;
  padding: 22px;
  border-radius: 26px;
  font-family: 'Nunito', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: #161b2d;
  overflow: hidden;
  isolation: isolate;

  background-color: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(30px) saturate(180%);
  -webkit-backdrop-filter: blur(30px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.55);
  box-shadow:
    0 1px 4px rgba(20, 32, 72, 0.05),
    0 4px 12px rgba(20, 32, 72, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 180px;
    background: linear-gradient(
      180deg,
      rgba(40, 199, 142, 0.1) 0%,
      rgba(74, 214, 164, 0.04) 40%,
      rgba(255, 255, 255, 0) 100%
    );
    pointer-events: none;
    z-index: -1;
  }

  ${({ theme }: { theme?: ITheme; visible: boolean }) => css`
    ${theme && theme.dark
      ? css`
          background-color: rgba(40, 44, 52, 0.72);
          color: #f3f5f9;
          border-color: rgba(255, 255, 255, 0.12);
        `
      : ''}
  `}
`;

export const Header = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
`;

export const TitleWrap = styled.div`
  display: flex;
  flex-direction: column;
`;

export const Title = styled.h3`
  margin: 0;
  font-size: 22px;
  font-weight: 900;
  letter-spacing: -0.3px;
  color: #161b2d;
`;

export const VersionLine = styled.div`
  margin-top: 6px;
  font-size: 12px;
  font-weight: 700;
  color: #75809a;
`;

export const NewVersionTag = styled.span`
  display: inline-block;
  margin-left: 6px;
  border-radius: 9999px;
  padding: 2px 10px;
  font-size: 11px;
  font-weight: 900;
  background-color: #eaf9f3;
  color: #28a37a;
`;

export const CloseButton = styled.div`
  width: 34px;
  height: 34px;
  border-radius: 14px;
  background-color: #ffffff;
  box-shadow: 0 6px 24px rgba(20, 32, 72, 0.06);
  border: 1px solid #e4f0ea;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #4c5e79;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  flex-shrink: 0;
  transition: color 0.18s ease;

  &:hover {
    color: #161b2d;
  }
`;

export const NotesCard = styled.div`
  margin-top: 18px;
  border-radius: 22px;
  background-color: #ffffff;
  border: 1px solid #edf1fa;
  padding: 16px;
`;

export const NotesTitle = styled.div`
  font-size: 13px;
  font-weight: 800;
  color: #161b2d;
`;

export const NotesScroll = styled.div`
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 220px;
  overflow-y: auto;

  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(149, 163, 184, 0.28);
    border-radius: 9999px;
  }
`;

export const NoteItem = styled.div`
  font-size: 12.5px;
  font-weight: 700;
  line-height: 1.6;
  color: #4c5e79;
`;

export const ProgressWrap = styled.div`
  margin-top: 18px;
`;

export const ProgressLabel = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 800;
  color: #4c5e79;
  margin-bottom: 8px;
`;

export const ProgressBar = styled.div`
  height: 8px;
  border-radius: 9999px;
  background-color: #eaf0fb;
  overflow: hidden;
`;

export const ProgressFill = styled.div<{ percent: number }>`
  height: 100%;
  border-radius: 9999px;
  background: linear-gradient(90deg, #28c78e 0%, #4ad6a4 100%);
  width: ${({ percent }) => percent}%;
  transition: width 0.25s ease;
`;

export const ErrorText = styled.div`
  margin-top: 14px;
  font-size: 12px;
  font-weight: 700;
  color: #d64545;
`;

export const Actions = styled.div`
  margin-top: 20px;
  display: flex;
  gap: 10px;
`;

export const Button = styled.div<{ variant?: 'primary' | 'ghost'; disabled?: boolean }>`
  flex: 1;
  text-align: center;
  border-radius: 14px;
  padding: 12px 14px;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  user-select: none;
  transition: filter 0.18s ease, opacity 0.18s ease;

  &:hover {
    filter: brightness(0.97);
  }

  ${({ variant }) =>
    variant === 'primary'
      ? css`
          background: linear-gradient(90deg, #28c78e 0%, #4ad6a4 100%);
          color: #ffffff;
          box-shadow: 0 8px 20px rgba(40, 199, 142, 0.28);
        `
      : css`
          background-color: #ffffff;
          color: #161b2d;
          border: 1px solid #e6ecf8;
        `}

  ${({ disabled }) =>
    disabled
      ? css`
          opacity: 0.5;
          pointer-events: none;
        `
      : ''}
`;
