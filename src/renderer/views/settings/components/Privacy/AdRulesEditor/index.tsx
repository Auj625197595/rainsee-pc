import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ipcRenderer } from '~/common/renderer-ipc';
import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';
import { getPalette } from '../../../utils/palette';
import store from '../../../store';
import { getSettingsTranslator } from '../../../utils';

const Wrapper = styled.div`
  width: 100%;
  padding: 16px 18px;
  border-radius: 18px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      box-shadow: inset 0 0 0 1px ${p.line}, 0 1px 2px rgba(20, 27, 45, 0.04);
    `;
  }}
`;

const GroupBlock = styled.div`
  margin-top: 26px;
`;

const GroupLabel = styled.div`
  padding: 0 4px 9px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const TopBar = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const TopTitle = styled.div`
  font-size: 15px;
  font-weight: 700;
  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

const Hint = styled.div`
  margin-top: 3px;
  font-size: 13px;
  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const Spacer = styled.div`
  flex: 1;
`;

const SmallButton = styled.button<{ theme?: ITheme }>`
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  padding: 6px 14px;
  border-radius: 9px;
  cursor: pointer;
  border: none;
  color: #fff;
  transition: filter 0.15s ease, opacity 0.15s ease;

  &:disabled {
    opacity: 0.55;
    cursor: default;
  }

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${getPalette(theme).primary};
    &:hover:not(:disabled) {
      filter: brightness(1.07);
    }
  `}
`;

const Area = styled.textarea`
  width: 100%;
  min-height: 200px;
  margin-top: 14px;
  resize: vertical;
  box-sizing: border-box;
  padding: 12px;
  border-radius: 10px;
  font-family: 'Consolas', 'Menlo', monospace;
  font-size: 13px;
  line-height: 1.5;
  outline: none;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${p.bg};
      border: 1px solid ${p.line};
      &:focus {
        border-color: ${p.primary};
      }
      &::placeholder {
        color: ${p.textMute};
      }
    `;
  }}
`;

const Saved = styled.span`
  font-size: 12px;
  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export default observer(() => {
  const t = getSettingsTranslator();
  const [text, setText] = React.useState('');
  const [original, setOriginal] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      const res = await ipcRenderer.invoke('adblock-get-user-rules');
      const val = typeof res === 'string' ? res : '';
      setText(val);
      setOriginal(val);
    })();
  }, []);

  const onSave = async () => {
    setBusy(true);
    setSaved(false);
    const res = await ipcRenderer.invoke('adblock-save-user-rules', text);
    const val = typeof res === 'string' ? res : text;
    setText(val);
    setOriginal(val);
    setBusy(false);
    setSaved(true);
  };

  const theme = store.theme;
  const dirty = text !== original;

  return (
    <GroupBlock>
      <GroupLabel theme={theme}>{t('pvCosmeticRules')}</GroupLabel>
      <Wrapper theme={theme}>
        <TopBar>
          <Spacer />
          {saved && !dirty ? (
            <Saved theme={theme}>{t('suSaved')}</Saved>
          ) : null}
          <SmallButton theme={theme} disabled={busy || !dirty} onClick={onSave}>
            {busy ? t('pvSaving') : t('save')}
          </SmallButton>
        </TopBar>

        <Area
          theme={theme}
          value={text}
          placeholder={t('pvRulesPlaceholder')}
          disabled={busy}
          onChange={(e) => {
            setText(e.target.value);
            setSaved(false);
          }}
        />
      </Wrapper>
    </GroupBlock>
  );
});
