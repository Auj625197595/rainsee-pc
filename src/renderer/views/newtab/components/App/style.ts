import styled from 'styled-components';

// 本地 newtab 外层容器
export const Frame = styled.div`
  position: fixed;
  inset: 0;
`;

// 无痕专用 newtab(本地页)。深色基调对标 Chrome 无痕起始页。
export const IncognitoPage = styled.div`
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  padding: 24px;
  background-color: #202124;
  color: #e8eaed;
`;

export const IncognitoLogo = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;

  img {
    width: 44px;
    height: 44px;
    filter: invert(70%);
  }

  span {
    font-size: 24px;
    font-weight: 300;
    letter-spacing: 0;
  }
`;

export const IncognitoHint = styled.div`
  font-size: 13px;
  color: #9aa0a6;
  max-width: 520px;
  text-align: center;
  line-height: 1.7;
`;

export const IncognitoSearch = styled.form`
  display: flex;
  width: min(560px, 86vw);

  input {
    flex: 1;
    height: 46px;
    border: 1px solid #5f6368;
    border-radius: 24px;
    background-color: #303134;
    color: #e8eaed;
    padding: 0 22px;
    font-size: 16px;
    outline: none;
    transition: border-color 0.15s;

    &:focus {
      border-color: #8ab4f8;
      background-color: #28292c;
    }

    &::placeholder {
      color: #9aa0a6;
    }
  }
`;

// ── 本地 newtab 主页 ─────────────────────────────────────────────
// 颜色全部走 CSS 变量(--ntp-*),由 index.tsx 按明暗主题注入,
// 样式组件保持零 props 依赖。

export const LocalPage = styled.div`
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 28px;
  padding: 24px;
  overflow-y: auto;
  color: var(--ntp-text);
  user-select: none;
`;

export const BrandTitle = styled.div`
  font-size: 34px;
  font-weight: 600;
  letter-spacing: 2px;
  line-height: 1.3;
`;

export const BrandSubtitle = styled.div`
  margin-top: -18px;
  font-size: 13px;
  color: var(--ntp-muted);
  letter-spacing: 4px;
`;

export const SearchRow = styled.form`
  display: flex;
  align-items: center;
  width: min(600px, 88vw);

  input {
    flex: 1;
    height: 48px;
    border: 1px solid var(--ntp-border);
    border-right: none;
    border-radius: 24px 0 0 24px;
    background-color: var(--ntp-panel);
    color: var(--ntp-text);
    padding: 0 22px;
    font-size: 15px;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;

    &:focus {
      border-color: var(--ntp-accent);
      box-shadow: 0 0 0 2px var(--ntp-accent-ring);
    }

    &::placeholder {
      color: var(--ntp-muted);
    }
  }

  button {
    height: 48px;
    padding: 0 26px;
    border: none;
    border-radius: 0 24px 24px 0;
    background-color: var(--ntp-accent);
    color: #ffffff;
    font-size: 15px;
    cursor: pointer;
    transition: filter 0.15s;

    &:hover {
      filter: brightness(1.08);
    }

    &:active {
      filter: brightness(0.95);
    }
  }
`;

export const EngineChips = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  width: min(680px, 92vw);
`;

export const EngineChip = styled.button<{
  $active?: boolean;
}>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 14px;
  border-radius: 15px;
  border: 1px solid ${(props) => (props.$active ? 'var(--ntp-accent)' : 'var(--ntp-border)')};
  background-color: ${(props) =>
    props.$active ? 'var(--ntp-accent-chip)' : 'transparent'};
  color: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s;

  img {
    width: 16px;
    height: 16px;
    border-radius: 4px;
    object-fit: cover;
  }

  &:hover {
    border-color: var(--ntp-accent);
  }
`;

export const ShortcutGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 12px;
  width: min(660px, 90vw);
`;

export const ShortcutTile = styled.button`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 14px 8px 12px;
  border: none;
  border-radius: 14px;
  background-color: transparent;
  color: inherit;
  cursor: pointer;
  transition: background-color 0.15s, transform 0.15s;

  &:hover {
    background-color: var(--ntp-tile-hover);
    transform: translateY(-2px);
  }

  &:active {
    transform: translateY(0);
  }
`;

export const TileIconWrap = styled.div`
  position: relative;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background-color: var(--ntp-accent-chip);
  overflow: hidden;

  .fallback {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 19px;
    font-weight: 500;
    color: var(--ntp-accent);
  }

  img {
    position: relative;
    z-index: 1;
    width: 100%;
    height: 100%;
    object-fit: contain;
    background-color: transparent;
  }
`;

export const TileLabel = styled.div`
  max-width: 96px;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.85;
`;
