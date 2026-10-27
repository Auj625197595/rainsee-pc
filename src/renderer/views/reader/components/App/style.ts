import styled from 'styled-components';
import {THEME_COLORS} from '../../utils';

// 阅读主题用 CSS 变量切换,正文/工具栏/浮层共用一套配色。
const themeVars = (Object.keys(THEME_COLORS) as Array<keyof typeof THEME_COLORS>)
  .map((k) => {
    const c = THEME_COLORS[k];
    return `&[data-theme='${k}'] {
      --bg: ${c.bg};
      --text: ${c.text};
      --dim: ${c.dim};
      --link: ${c.link};
      --border: ${c.border};
      --code: ${c.code};
      --bar: ${k === 'dark' ? 'rgba(27,28,31,0.92)' : k === 'sepia' ? 'rgba(246,239,225,0.92)' : 'rgba(255,255,255,0.92)'};
      --hover: ${k === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'};
      --panel: ${k === 'dark' ? '#25262a' : k === 'sepia' ? '#fbf6ec' : '#ffffff'};
    }`;
  })
  .join('\n');

const UI_FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif`;

export const StyledApp = styled.div`
  ${themeVars}
  position: fixed;
  inset: 0;
  overflow-y: auto;
  background: var(--bg);
  color: var(--text);
  transition: background 0.2s, color 0.2s;
  * {
    box-sizing: border-box;
  }
  ::-webkit-scrollbar {
    width: 10px;
  }
  ::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 6px;
    border: 2px solid transparent;
    background-clip: content-box;
  }
`;

export const Toolbar = styled.div`
  position: sticky;
  top: 0;
  z-index: 10;
  height: 52px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 16px;
  background: var(--bar);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--border);
  font-family: ${UI_FONT};
  font-size: 13px;
  transition: transform 0.2s;
  &[data-hidden='true'] {
    transform: translateY(-100%);
  }
`;

export const ToolbarTitle = styled.div`
  flex: 1;
  min-width: 0;
  padding: 0 8px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--dim);
`;

export const ToolBtn = styled.button`
  height: 32px;
  min-width: 32px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font: inherit;
  cursor: pointer;
  &:hover:not(:disabled) {
    background: var(--hover);
  }
  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
  &[data-active='true'] {
    background: var(--hover);
  }
`;

export const SaveGroup = styled.div`
  display: inline-flex;
  align-items: center;
  margin-left: 4px;
  border-radius: 6px;
  background: #2563eb;
  color: #fff;
  & > button {
    color: #fff;
    height: 32px;
  }
  & > button:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.14);
  }
  & > button:first-child {
    padding: 0 12px;
    border-radius: 6px 0 0 6px;
  }
  & > button:last-child {
    min-width: 26px;
    padding: 0 4px;
    border-radius: 0 6px 6px 0;
    border-left: 1px solid rgba(255, 255, 255, 0.25);
  }
`;

export const Popover = styled.div`
  position: absolute;
  top: 48px;
  right: 16px;
  z-index: 20;
  width: 260px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
  font-family: ${UI_FONT};
  font-size: 13px;
`;

export const PopLabel = styled.div`
  margin: 10px 0 6px;
  color: var(--dim);
  font-size: 12px;
  &:first-child {
    margin-top: 0;
  }
`;

export const Segmented = styled.div`
  display: flex;
  gap: 6px;
`;

export const SegBtn = styled.button`
  flex: 1;
  height: 32px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  font: inherit;
  cursor: pointer;
  &[data-active='true'] {
    border-color: #2563eb;
    box-shadow: inset 0 0 0 1px #2563eb;
  }
  &:hover {
    background: var(--hover);
  }
`;

export const Swatch = styled(SegBtn)`
  &[data-swatch='light'] {
    background: #ffffff;
    color: #1f2328;
  }
  &[data-swatch='sepia'] {
    background: #f6efe1;
    color: #3b3226;
  }
  &[data-swatch='dark'] {
    background: #1b1c1f;
    color: #d9d9dc;
  }
`;

export const MenuItem = styled.button`
  width: 100%;
  height: 34px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  &:hover {
    background: var(--hover);
  }
  & > span {
    flex: 1;
  }
`;

export const Article = styled.article`
  margin: 0 auto;
  padding: 40px 24px 120px;
  line-height: 1.8;
  word-wrap: break-word;

  h1.reader-title {
    font-size: 1.75em;
    line-height: 1.35;
    margin: 0 0 12px;
  }
  .reader-meta {
    color: var(--dim);
    font-size: 0.8em;
    margin-bottom: 32px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border);
    font-family: ${UI_FONT};
  }
  .reader-meta a {
    color: var(--dim);
  }
  a {
    color: var(--link);
  }
  h2, h3, h4 {
    line-height: 1.4;
    margin: 1.6em 0 0.6em;
  }
  p {
    margin: 0 0 1em;
  }
  img {
    max-width: 100%;
    height: auto;
    display: block;
    margin: 1em auto;
    border-radius: 4px;
  }
  pre {
    background: var(--code);
    padding: 12px 16px;
    border-radius: 6px;
    overflow: auto;
    font-size: 0.85em;
    line-height: 1.6;
    white-space: pre-wrap;
  }
  code {
    background: var(--code);
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 0.9em;
    font-family: Consolas, 'Courier New', monospace;
  }
  pre code {
    background: none;
    padding: 0;
  }
  blockquote {
    margin: 1em 0;
    padding: 4px 16px;
    border-left: 4px solid var(--border);
    color: var(--dim);
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.9em;
    display: block;
    overflow-x: auto;
  }
  th, td {
    border: 1px solid var(--border);
    padding: 6px 10px;
  }
  figcaption {
    color: var(--dim);
    font-size: 0.85em;
    text-align: center;
  }
  hr {
    border: none;
    border-top: 1px solid var(--border);
  }
  ul, ol {
    padding-left: 1.6em;
  }
`;

export const CenterState = styled.div`
  height: 70vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--dim);
  font-family: ${UI_FONT};
  font-size: 14px;
`;

export const Toast = styled.div`
  position: fixed;
  left: 50%;
  bottom: 32px;
  transform: translateX(-50%);
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: calc(100vw - 32px);
  padding: 10px 16px;
  border-radius: 8px;
  background: rgba(20, 20, 22, 0.92);
  color: #fff;
  font-family: ${UI_FONT};
  font-size: 13px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
  & > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  & > button {
    flex-shrink: 0;
    border: none;
    background: transparent;
    color: #7aa7ff;
    font: inherit;
    cursor: pointer;
    padding: 0;
  }
`;
