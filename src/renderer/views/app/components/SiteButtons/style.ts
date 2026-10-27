import styled, { css, keyframes } from 'styled-components';

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(-2px); }
  to { opacity: 1; transform: translateY(0); }
`;

// 地址栏右侧"新标签搜索"气泡按钮:持久开关。灰色 = 当前页打开(默认),
// 高亮渐变 = 搜索结果在新标签页打开。
export const NewTabSearchPill = styled.div<{
  $iconOnly?: boolean;
  $active?: boolean;
  $lightToolbar?: boolean;
}>`
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px 0 7px;
  margin: 0 3px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.2px;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  -webkit-app-region: no-drag;
  animation: ${fadeIn} 0.2s ease;
  transition: filter 0.18s ease, transform 0.18s ease,
    background-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease;

  svg {
    flex-shrink: 0;
  }

  &:hover {
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(0);
  }

  ${({$iconOnly, $active, $lightToolbar}) => css`
    ${$active
      ? css`
          color: #ffffff;
          background: linear-gradient(135deg, #5b8cff 0%, #7b6fff 100%);
          box-shadow: 0 2px 6px rgba(91, 124, 255, 0.28);

          &:hover {
            filter: brightness(1.07);
          }

          &:active {
            filter: brightness(0.95);
          }
        `
      : css`
          // $lightToolbar 与同文件 mutedIconColor 同义:true = 深色工具栏(用浅色前景)。
          // 未激活态:柔和中性填充 + 同色系发丝描边,低调但轮廓清晰,不抢视觉。
          color: ${$lightToolbar
            ? 'rgba(255, 255, 255, 0.82)'
            : 'rgb(108, 113, 121)'};
          background: ${$lightToolbar
            ? 'rgba(255, 255, 255, 0.12)'
            : 'rgba(0, 0, 0, 0.06)'};
          box-shadow: ${$lightToolbar
            ? 'inset 0 0 0 1px rgba(255, 255, 255, 0.16)'
            : 'inset 0 0 0 1px rgba(0, 0, 0, 0.08)'};

          svg {
            opacity: 0.92;
          }

          &:hover {
            color: ${$lightToolbar ? '#ffffff' : 'rgb(84, 89, 97)'};
            background: ${$lightToolbar
              ? 'rgba(255, 255, 255, 0.18)'
              : 'rgba(0, 0, 0, 0.09)'};
          }
        `}

    ${$iconOnly &&
    css`
      flex: 0 0 24px;
      justify-content: center;
      gap: 0;
      width: 24px;
      padding: 0;

      > span {
        display: none;
      }
    `}
  `}
`;

// 地址栏"检测到可播放链接"胶囊:当前页是 IPTV 直播源(txt/m3u/TVBox json)时出现。
// 深色底 + 呼吸绿点,与普通图标按钮区分明显;点击把规则带入 IPTV 播放器。
const iptvPulse = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.7); }
  70% { box-shadow: 0 0 0 5px rgba(52, 211, 153, 0); }
  100% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0); }
`;

export const IptvPill = styled.div`
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 10px 0 8px;
  margin: 0 4px;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  -webkit-app-region: no-drag;
  color: #ffffff;
  background: linear-gradient(135deg, #111317 0%, #2a2f38 100%);
  box-shadow: inset 0 0 0 1px rgba(52, 211, 153, 0.55),
    0 3px 10px rgba(0, 0, 0, 0.22);
  animation: ${fadeIn} 0.2s ease;
  transition: filter 0.18s ease, transform 0.18s ease;

  svg {
    flex-shrink: 0;
  }

  .iptv-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #34d399;
    animation: ${iptvPulse} 1.8s ease-out infinite;
  }

  .iptv-count {
    color: #6ee7b7;
    font-weight: 800;
  }

  &:hover {
    filter: brightness(1.15);
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(0);
  }
`;
