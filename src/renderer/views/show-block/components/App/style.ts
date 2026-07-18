import styled, {css} from 'styled-components';

import {ITheme} from '~/interfaces';
import {DialogStyle} from '~/renderer/mixins/dialogs';

export const StyledApp = styled(DialogStyle)`
  position: relative;
  padding: 20px;
  border-radius: 26px;
  font-family: 'Nunito', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: #161b2d;
  overflow: hidden;
  isolation: isolate;

  /* 加大毛玻璃效果：半透明白底 + 强背景模糊(透出底层页面) */
  background-color: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(30px) saturate(180%);
  -webkit-backdrop-filter: blur(30px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.55);
  /* 轻量多层阴影，贴近卡片边缘（与 add-bookmark 弹窗一致） */
  box-shadow:
    0 1px 4px rgba(20, 32, 72, 0.05),
    0 4px 12px rgba(20, 32, 72, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);

  /* 顶部绿色渐变光晕（视觉稿同款，很淡），置于内容之下 */
  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 160px;
    background: linear-gradient(
      180deg,
      rgba(40, 199, 142, 0.06) 0%,
      rgba(74, 214, 164, 0.025) 40%,
      rgba(255, 255, 255, 0) 100%
    );
    pointer-events: none;
    z-index: -1;
  }

  ${({theme}: {theme?: ITheme; visible: boolean}) => css`
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

export const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`;

export const Title = styled.h3`
  margin: 0;
  font-size: 22px;
  font-weight: 900;
  letter-spacing: -0.3px;
  color: #161b2d;
`;

export const Domain = styled.div`
  margin-top: 4px;
  font-size: 12px;
  font-weight: 700;
  color: #75809a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 260px;
`;

export const HeaderIconButton = styled.div`
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
  transition: color 0.18s ease;

  &:hover {
    color: #161b2d;
  }
`;

export const CloseButton = styled(HeaderIconButton)`
`;

export const StatRow = styled.div`
  margin-top: 20px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
`;

export const StatCard = styled.div`
  border-radius: 20px;
  background-color: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  box-shadow: 0 6px 18px rgba(20, 32, 72, 0.06);
  padding: 16px;
`;

export const StatLabel = styled.div`
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 1.4px;
  text-transform: uppercase;
  color: #a8b2c7;
`;

export const StatValue = styled.div`
  margin-top: 12px;
  font-size: 28px;
  font-weight: 900;
  letter-spacing: -0.5px;
  color: #161b2d;
`;

export const StatusCard = styled.div`
  margin-top: 16px;
  border-radius: 22px;
  background-color: #f8fbff;
  border: 1px solid #eaf0fb;
  padding: 16px;
`;

export const StatusRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

export const StatusText = styled.div`
  font-size: 13px;
  font-weight: 800;
  color: #161b2d;
`;

export const Badge = styled.div<{paused?: boolean}>`
  border-radius: 9999px;
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 900;
  ${({paused}) =>
    paused
      ? css`
          background-color: #fff4de;
          color: #d68a14;
        `
      : css`
          background-color: #eaf9f3;
          color: #28a37a;
        `}
`;

export const ActionButtons = styled.div`
  margin-top: 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

export const PillButton = styled.div<{variant?: 'default' | 'primary'}>`
  border-radius: 12px;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
  user-select: none;
  transition: filter 0.18s ease;

  &:hover {
    filter: brightness(0.97);
  }

  ${({variant}) =>
    variant === 'primary'
      ? css`
          background-color: #eef2ff;
          color: #3452ff;
        `
      : css`
          background-color: #ffffff;
          color: #161b2d;
          border: 1px solid #e6ecf8;
        `}
`;

export const ListCard = styled.div`
  margin-top: 16px;
  border-radius: 22px;
  background-color: #ffffff;
  border: 1px solid #edf1fa;
  padding: 16px;
`;

export const ListHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

export const ListTitle = styled.div`
  font-size: 13px;
  font-weight: 800;
  color: #161b2d;
`;

export const ListMeta = styled.div`
  font-size: 11px;
  font-weight: 700;
  color: #a8b2c7;
`;

export const ListScroll = styled.div`
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
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

export const RequestItem = styled.div`
  border-radius: 16px;
  background-color: #f8faff;
  border: 1px solid #eef2fa;
  padding: 10px 12px;
`;

export const RequestHost = styled.div`
  font-size: 12px;
  font-weight: 800;
  color: #161b2d;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const RequestFilter = styled.div`
  margin-top: 4px;
  font-size: 11px;
  font-weight: 700;
  color: #75809a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const EmptyState = styled.div`
  border-radius: 16px;
  background-color: #f8faff;
  border: 1px solid #eef2fa;
  padding: 16px;
  font-size: 12px;
  font-weight: 700;
  color: #75809a;
  text-align: center;
`;

/* 误拦截申诉入口 */
export const ComplaintBanner = styled.div`
  margin-top: 16px;
  cursor: pointer;
  user-select: none;
  color: #e53935;
  font-size: 13px;
  line-height: 20px;
  white-space: nowrap;
  text-align: center;

  &:hover {
    text-decoration: underline;
  }
`;
