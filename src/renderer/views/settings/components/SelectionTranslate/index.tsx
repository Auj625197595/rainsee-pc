import * as React from 'react';
import { observer } from 'mobx-react-lite';
import styled, { css } from 'styled-components';

import { ipcRenderer } from '~/common/renderer-ipc';
import store from '../../store';
import { Header, Title, SecondaryText } from '../App/style';
import { Switch } from '~/renderer/components/Switch';
import { LANGUAGES } from '~/renderer/views/translate/languages';
import { getPalette } from '../../utils/palette';
import { ITheme } from '~/interfaces';

// ===========================================================================
// styled(克隆 MouseGestures/index.tsx 的原子)
// ===========================================================================

const TopRow = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 6px;
`;

const OptionsRow = styled.div`
  display: flex;
  align-items: center;
  gap: 18px;
  margin-top: 6px;
  margin-bottom: 8px;
  padding: 14px 18px;
  border-radius: 16px;
  flex-wrap: wrap;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      box-shadow: inset 0 0 0 1px ${p.line}, 0 1px 2px rgba(20, 27, 45, 0.04);
    `;
  }}
`;

const OptionItem = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const ShapeSelect = styled.select`
  height: 36px;
  padding: 0 12px;
  border-radius: 10px;
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  outline: none;
  transition: border-color 0.16s ease, box-shadow 0.16s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${p.bg};
      border: 1px solid ${p.line};

      &:hover {
        border-color: ${p.primary}66;
      }

      &:focus {
        border-color: ${p.primary};
        box-shadow: 0 0 0 3px ${p.primary}1f;
      }
    `;
  }}
`;

// ===========================================================================
// 组件
// ===========================================================================

export const SelectionTranslate = observer(() => {
  const enabled = store.settings.selectionTranslateEnabled !== false;
  const target = store.settings.selectionTranslateTarget || 'zh-CN';

  const setOption = (key: 'enabled' | 'target', value: any) =>
    ipcRenderer.invoke('set-selection-translate-option', key, value);

  return (
    <>
      <Header>划词翻译</Header>
      <TopRow>
        <SecondaryText>
          在网页中选中一段文本,若它不是中文且并非纯数字与符号,会在选区下方弹出一张毛玻璃卡片显示译文。
          取消选中即可关闭卡片。
        </SecondaryText>
      </TopRow>

      <OptionsRow>
        <OptionItem>
          <Switch clickable value={enabled} onClick={() => setOption('enabled', !enabled)} />
          <span>开启划词翻译</span>
        </OptionItem>
        <OptionItem>
          <span>目标语言</span>
          <ShapeSelect
            value={target}
            onChange={(e) => setOption('target', e.target.value)}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </ShapeSelect>
        </OptionItem>
      </OptionsRow>

      <div style={{ opacity: enabled ? 1 : 0.45, pointerEvents: enabled ? 'auto' : 'none' }}>
        <OptionsRow>
          <Title>翻译引擎</Title>
          <SecondaryText style={{ marginLeft: 'auto' }}>
            微软翻译(免费),与网页翻译共用。目标语言可在上方切换。
          </SecondaryText>
        </OptionsRow>
      </div>
    </>
  );
});
