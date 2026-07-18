import styled, { css } from 'styled-components';
import { ITheme } from '~/interfaces';
import { PersistentDialogStyle } from '~/renderer/mixins/dialogs';

// 悬停预览卡。视觉稿:320px 宽,22px 圆角,白底,柔和投影 + 浅蓝描边。
export const StyledApp = styled(PersistentDialogStyle)`
  margin: 0;
  width: 320px;
  padding: 12px;
  border-radius: 22px;
  overflow: hidden;
  background-color: rgba(255, 255, 255, 0.96);
  box-shadow:
    0 1px 4px rgba(20, 32, 72, 0.05),
    0 4px 12px rgba(20, 32, 72, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);
  box-sizing: border-box;
  --ring: inset 0 0 0 1px #e3eafb;

  ${({ xTransition }: { xTransition: boolean }) => css`
    transition: 0.15s opacity${xTransition ? ', 0.08s transform' : ''};
  `}

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 22px;
    box-shadow: inset 0 0 0 1px #e3eafb;
    pointer-events: none;
  }
`;

// 预览图区域:16px 圆角,浅蓝底 + 描边,固定 180px 高。
export const ImageWrap = styled.div`
  position: relative;
  overflow: hidden;
  border-radius: 16px;
  background-color: #f3f6ff;
  box-shadow: inset 0 0 0 1px #e7eefc;
  height: 180px;
`;

export const Thumbnail = styled.img`
  display: block;
  width: 100%;
  height: 180px;
  object-fit: cover;
`;

// 无缩略图时的占位:居中显示放大的网站图标,弱透明。
export const Placeholder = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 180px;

  ${({ favicon }: { favicon: string }) => css`
    background-image: ${favicon ? `url(${favicon})` : 'none'};
    background-repeat: no-repeat;
    background-position: center;
    background-size: 56px 56px;
    opacity: 0.55;
  `}
`;

export const TextWrap = styled.div`
  padding: 12px 4px 4px;
`;

export const Title = styled.div`
  font-size: 14px;
  font-weight: 800;
  line-height: 1.3;
  color: #1b2440;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const Url = styled.div`
  margin-top: 4px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.3;
  color: #7b8aa8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

