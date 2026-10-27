import styled, { css, keyframes } from 'styled-components';
import { ITheme } from '~/interfaces';

type T = { theme?: ITheme };

const pal = (theme?: ITheme) =>
  theme?.dark
    ? {
        bg: '#23262e',
        panel: '#1b1d23',
        surface: '#2c3039',
        line: 'rgba(255,255,255,0.08)',
        text: '#f2f4f8',
        sub: '#9aa3b5',
        primary: '#4f8cff',
        primarySoft: 'rgba(79,140,255,0.16)',
        good: '#3ccf91',
        warn: '#f2b04a',
      }
    : {
        bg: '#ffffff',
        panel: '#f4f6fa',
        surface: '#ffffff',
        line: '#e7ebf3',
        text: '#161b2d',
        sub: '#6b7489',
        primary: '#2f6bff',
        primarySoft: '#eef3ff',
        good: '#1fa774',
        warn: '#c98512',
      };

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(6px) scale(0.985); }
  to { opacity: 1; transform: none; }
`;

const spin = keyframes`
  to { transform: rotate(360deg); }
`;

export const StyledApp = styled.div`
  box-sizing: border-box;
  margin: 10px;
  height: calc(100vh - 20px);
  border-radius: 18px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif;
  animation: ${fadeIn} 0.16s ease-out;
  /* 边缘与 extensions-list 弹窗一致:毛玻璃半透明底 + 半透明白描边 + 贴边轻阴影
     + 顶部内高光。阴影要收在 10px 外边距内,否则会被 BrowserView 边界截断。 */
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  ${({ theme }: T) => {
    const p = pal(theme);
    return theme?.dark
      ? css`
          background-color: rgba(40, 42, 48, 0.86);
          color: ${p.text};
          border: 1px solid rgba(255, 255, 255, 0.12);
          box-shadow:
            0 1px 4px rgba(0, 0, 0, 0.18),
            0 4px 12px rgba(0, 0, 0, 0.22),
            inset 0 1px 0 rgba(255, 255, 255, 0.06);
        `
      : css`
          background-color: rgba(255, 255, 255, 0.82);
          color: ${p.text};
          border: 1px solid rgba(255, 255, 255, 0.55);
          box-shadow:
            0 1px 4px rgba(20, 32, 72, 0.05),
            0 4px 12px rgba(20, 32, 72, 0.06),
            inset 0 1px 0 rgba(255, 255, 255, 0.7);
        `;
  }}
`;

export const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 18px 12px 20px;
`;

export const HeaderIcon = styled.div`
  width: 36px;
  height: 36px;
  border-radius: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  ${({ theme }: T) => {
    const p = pal(theme);
    return css`
      background: ${p.primarySoft};
      color: ${p.primary};
    `;
  }}
`;

export const HeaderText = styled.div`
  flex: 1;
  min-width: 0;
`;

export const Title = styled.div`
  font-size: 16px;
  font-weight: 700;
`;

export const Subtitle = styled.div`
  margin-top: 2px;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  ${({ theme }: T) => css`
    color: ${pal(theme).sub};
  `}
`;

export const IconButton = styled.button`
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background: transparent;
  transition: background 0.15s ease, color 0.15s ease;
  ${({ theme }: T) => {
    const p = pal(theme);
    return css`
      color: ${p.sub};
      &:hover {
        background: ${p.panel};
        color: ${p.text};
      }
      &:focus-visible {
        outline: 2px solid ${p.primary};
      }
    `;
  }}
`;

export const Body = styled.div`
  display: flex;
  gap: 16px;
  padding: 0 20px;
  flex: 1;
  min-height: 0;
`;

export const PreviewColumn = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

export const Preview = styled.div`
  position: relative;
  flex: 1;
  min-height: 0;
  border-radius: 14px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px;
  ${({ theme }: T) => {
    const p = pal(theme);
    const a = theme?.dark ? '#2a2d35' : '#eceff5';
    return css`
      background-color: ${p.panel};
      background-image: linear-gradient(45deg, ${a} 25%, transparent 25%),
        linear-gradient(-45deg, ${a} 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, ${a} 75%),
        linear-gradient(-45deg, transparent 75%, ${a} 75%);
      background-size: 16px 16px;
      background-position: 0 0, 0 8px, 8px -8px, -8px 0;
    `;
  }}

  > img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 4px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
  }
`;

export const Spinner = styled.div`
  position: absolute;
  right: 12px;
  top: 12px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid rgba(127, 127, 127, 0.25);
  animation: ${spin} 0.7s linear infinite;
  ${({ theme }: T) => css`
    border-top-color: ${pal(theme).primary};
  `}
`;

export const Thumbs = styled.div`
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
  &::-webkit-scrollbar {
    height: 4px;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(127, 127, 127, 0.3);
    border-radius: 4px;
  }
`;

export const Thumb = styled.button<{ active?: boolean }>`
  flex-shrink: 0;
  width: 52px;
  height: 52px;
  padding: 0;
  border-radius: 9px;
  overflow: hidden;
  cursor: pointer;
  background: transparent;
  ${({ theme, active }: T & { active?: boolean }) => {
    const p = pal(theme);
    return css`
      border: 2px solid ${active ? p.primary : 'transparent'};
      box-shadow: inset 0 0 0 1px ${p.line};
    `;
  }}
  > img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
`;

export const Stats = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  min-height: 20px;
  ${({ theme }: T) => css`
    color: ${pal(theme).sub};
  `}
`;

export const StatStrong = styled.span<{ tone?: 'good' | 'warn' }>`
  font-weight: 700;
  ${({ theme, tone }: T & { tone?: 'good' | 'warn' }) => {
    const p = pal(theme);
    return css`
      color: ${tone === 'good' ? p.good : tone === 'warn' ? p.warn : p.text};
    `;
  }}
`;

export const Badge = styled.span<{ tone?: 'good' | 'warn' }>`
  margin-left: auto;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  ${({ theme, tone }: T & { tone?: 'good' | 'warn' }) => {
    const p = pal(theme);
    const c = tone === 'warn' ? p.warn : p.good;
    return css`
      color: ${c};
      background: ${c}1f;
    `;
  }}
`;

export const Options = styled.div`
  width: 264px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  padding-right: 2px;
  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(127, 127, 127, 0.3);
    border-radius: 4px;
  }
`;

export const ModeCard = styled.div<{ active?: boolean }>`
  border-radius: 12px;
  padding: 11px 12px;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
  outline: none;
  ${({ theme, active }: T & { active?: boolean }) => {
    const p = pal(theme);
    return css`
      border: 1.5px solid ${active ? p.primary : p.line};
      background: ${active ? p.primarySoft : p.surface};
      &:hover {
        border-color: ${active ? p.primary : `${p.primary}66`};
      }
      &:focus-visible {
        box-shadow: 0 0 0 3px ${p.primary}33;
      }
    `;
  }}
`;

export const ModeHead = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

export const ModeIcon = styled.div<{ active?: boolean }>`
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  ${({ theme, active }: T & { active?: boolean }) => {
    const p = pal(theme);
    return css`
      color: ${active ? '#fff' : p.primary};
      background: ${active ? p.primary : p.primarySoft};
    `;
  }}
`;

export const ModeTitle = styled.div`
  font-size: 13.5px;
  font-weight: 700;
`;

export const ModeDesc = styled.div`
  margin-top: 1px;
  font-size: 11.5px;
  line-height: 1.4;
  ${({ theme }: T) => css`
    color: ${pal(theme).sub};
  `}
`;

export const ModeExtra = styled.div`
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

export const FieldRow = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  ${({ theme }: T) => css`
    color: ${pal(theme).sub};
  `}
`;

export const NumberInput = styled.input`
  width: 84px;
  height: 30px;
  box-sizing: border-box;
  padding: 0 8px;
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
  outline: none;
  ${({ theme }: T) => {
    const p = pal(theme);
    return css`
      color: ${p.text};
      background: ${p.surface};
      border: 1px solid ${p.line};
      &:focus {
        border-color: ${p.primary};
        box-shadow: 0 0 0 3px ${p.primary}26;
      }
    `;
  }}
`;

export const Chips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`;

export const Chip = styled.button<{ active?: boolean }>`
  height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  ${({ theme, active }: T & { active?: boolean }) => {
    const p = pal(theme);
    return css`
      color: ${active ? '#fff' : p.text};
      background: ${active ? p.primary : p.surface};
      border: 1px solid ${active ? p.primary : p.line};
      &:hover {
        border-color: ${p.primary};
      }
    `;
  }}
`;

export const CheckRow = styled.label`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
  ${({ theme }: T) => css`
    color: ${pal(theme).sub};
    input {
      accent-color: ${pal(theme).primary};
      margin: 0;
    }
  `}
`;

export const Footer = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 20px 16px;
  margin-top: 14px;
  ${({ theme }: T) => css`
    border-top: 1px solid ${pal(theme).line};
  `}
`;

export const LinkButton = styled.button`
  border: 0;
  background: transparent;
  padding: 0;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  ${({ theme }: T) => css`
    color: ${pal(theme).sub};
    &:hover {
      color: ${pal(theme).primary};
      text-decoration: underline;
    }
  `}
`;

export const FooterHint = styled.div`
  font-size: 12px;
  ${({ theme }: T) => css`
    color: ${pal(theme).sub};
  `}
`;

export const Spacer = styled.div`
  flex: 1;
`;

export const Button = styled.button<{ primary?: boolean }>`
  height: 36px;
  min-width: 84px;
  padding: 0 18px;
  border-radius: 10px;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: filter 0.15s ease, background 0.15s ease;
  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
  ${({ theme, primary }: T & { primary?: boolean }) => {
    const p = pal(theme);
    return primary
      ? css`
          color: #fff;
          background: ${p.primary};
          border: 1px solid ${p.primary};
          &:hover:not(:disabled) {
            filter: brightness(1.06);
          }
        `
      : css`
          color: ${p.text};
          background: ${p.surface};
          border: 1px solid ${p.line};
          &:hover:not(:disabled) {
            background: ${p.panel};
          }
        `;
  }}
  &:focus-visible {
    outline: 2px solid ${({ theme }: T) => pal(theme).primary};
    outline-offset: 2px;
  }
`;
