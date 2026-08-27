import styled, {css, keyframes} from 'styled-components';

import {ITheme} from '~/interfaces';
import {getPalette} from '~/renderer/views/bookmarks/utils/palette';

// 全屏覆盖层:fixed 贴满窗口,半透明遮罩 + 居中卡片。z-index 极高确保盖住标签页
// 与工具栏(覆盖层只在「正在清理」的几秒内显示,用户无法操作底层 UI)。
// 注意:theme 是扁平 string-key 的 ITheme(如 theme['dialog.backgroundColor']),
// 不是嵌套对象 —— 统一用 getPalette(theme) 取色,避免 theme.dialog 误用。
export const Overlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 999999;
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;

  ${({theme}: {theme: ITheme}) => css`
    background: ${theme['pages.lightForeground']
      ? 'rgba(0, 0, 0, 0.55)'
      : 'rgba(32, 33, 36, 0.45)'};
  `}
`;

const cardAppear = keyframes`
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
`;

export const Card = styled.div`
  width: 360px;
  max-width: calc(100vw - 48px);
  padding: 26px 26px 20px;
  border-radius: 16px;
  box-shadow: 0 24px 60px -12px rgba(0, 0, 0, 0.45);
  animation: ${cardAppear} 0.18s ease-out;
  font-family: 'Nunito', -apple-system, BlinkMacSystemFont, 'Segoe UI',
    'Microsoft YaHei', system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;

  ${({theme}: {theme: ITheme}) => css`
    background: ${getPalette(theme).surface};
    color: ${getPalette(theme).textMain};
    border: 1px solid
      ${theme['pages.lightForeground']
        ? 'rgba(255,255,255,0.08)'
        : 'rgba(0,0,0,0.06)'};
  `}
`;

export const TitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 4px;
`;

const spin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

export const Spinner = styled.div`
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border-radius: 50%;
  position: relative;

  ${({theme, done}: {theme: ITheme; done: boolean}) =>
    done
      ? css`
          background: #1e8e3e;
          border: none;
        `
      : css`
          border: 2.5px solid rgba(127, 127, 127, 0.25);
          border-top-color: ${getPalette(theme).primary};
          animation: ${spin} 0.8s linear infinite;
        `}

  &::after {
    content: '';
    position: absolute;
    left: 6px;
    top: 2px;
    width: 6px;
    height: 11px;
    border: solid #fff;
    border-width: 0 2.5px 2.5px 0;
    transform: rotate(45deg);
    display: ${({done}: {done: boolean}) => (done ? 'block' : 'none')};
  }
`;

export const Title = styled.div`
  font-size: 16px;
  font-weight: 700;
  line-height: 1.3;
`;

export const Subtitle = styled.div`
  font-size: 12.5px;
  opacity: 0.7;
  margin: 0 0 18px 34px;
  line-height: 1.5;
  min-height: 18px;
`;

export const ProgressWrap = styled.div`
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
  margin-bottom: 10px;

  ${({theme}: {theme: ITheme}) => css`
    background: ${theme['pages.lightForeground']
      ? 'rgba(255,255,255,0.08)'
      : 'rgba(0,0,0,0.06)'};
  `}
`;

export const ProgressBar = styled.div`
  height: 100%;
  border-radius: 999px;
  transition: width 0.22s ease, background 0.2s ease;
  width: ${(props: {percent: number}) =>
    Math.max(0, Math.min(100, props.percent))}%;
  background: ${(props: {theme: ITheme; done: boolean}) =>
    props.done ? '#1e8e3e' : getPalette(props.theme).primary};
`;

export const MetaRow = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 11.5px;
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
`;

export const ForceQuitLink = styled.div`
  margin-top: 18px;
  text-align: center;
  font-size: 12px;
  opacity: 0.55;
  cursor: pointer;
  text-decoration: underline;

  &:hover {
    opacity: 0.85;
  }
`;
