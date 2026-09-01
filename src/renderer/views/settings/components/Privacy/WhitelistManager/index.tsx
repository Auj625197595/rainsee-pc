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

const AddRow = styled.div`
  display: flex;
  gap: 8px;
  margin-top: 14px;
`;

const Input = styled.input`
  flex: 1;
  min-width: 0;
  font-family: inherit;
  font-size: 13px;
  padding: 8px 12px;
  border-radius: 9px;
  outline: none;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${p.bg};
      border: 1px solid ${p.line};
      &::placeholder {
        color: ${p.textMute};
      }
      &:focus {
        border-color: ${p.primary};
      }
    `;
  }}
`;

const SmallButton = styled.button<{
  theme?: ITheme;
  kind?: 'primary' | 'danger';
}>`
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  padding: 6px 14px;
  border-radius: 9px;
  cursor: pointer;
  border: none;
  transition: filter 0.15s ease, opacity 0.15s ease;

  &:disabled {
    opacity: 0.55;
    cursor: default;
  }

  ${({ theme, kind }: { theme?: ITheme; kind?: 'primary' | 'danger' }) => {
    const p = getPalette(theme);
    if (kind === 'danger') {
      return css`
        color: ${p.danger};
        background-color: transparent;
        box-shadow: inset 0 0 0 1px ${p.line};
        &:hover:not(:disabled) {
          background-color: ${p.danger}14;
        }
      `;
    }
    return css`
      color: #fff;
      background-color: ${p.primary};
      &:hover:not(:disabled) {
        filter: brightness(1.07);
      }
    `;
  }}
`;

const ErrorText = styled.div`
  margin-top: 8px;
  font-size: 12px;
  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).danger};
  `}
`;

const List = styled.div`
  margin-top: 14px;
  display: flex;
  flex-flow: column;
  gap: 8px;
`;

const Item = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 12px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.bg};
      box-shadow: inset 0 0 0 1px ${p.line};
    `;
  }}
`;

const Domain = styled.div`
  flex: 1;
  min-width: 0;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

const Empty = styled.div`
  margin-top: 14px;
  padding: 18px;
  text-align: center;
  font-size: 13px;
  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

export default observer(() => {
  const t = getSettingsTranslator();
  const [list, setList] = React.useState<string[]>([]);
  const [input, setInput] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      const res = await ipcRenderer.invoke('adblock-get-whitelist');
      if (Array.isArray(res)) setList(res);
    })();
  }, []);

  const onAdd = async () => {
    const d = input.trim();
    if (!d) return;
    setBusy(true);
    setError('');
    const res = await ipcRenderer.invoke('adblock-add-whitelist', d);
    if (res && res.error) {
      setError(res.error);
      if (Array.isArray(res.list)) setList(res.list);
    } else if (res && Array.isArray(res.list)) {
      setList(res.list);
      setInput('');
    }
    setBusy(false);
  };

  const onRemove = async (domain: string) => {
    setBusy(true);
    const res = await ipcRenderer.invoke('adblock-remove-whitelist', domain);
    if (Array.isArray(res)) setList(res);
    setBusy(false);
  };

  const theme = store.theme;

  return (
    <GroupBlock>
      <GroupLabel theme={theme}>{t('pvWhitelist')}</GroupLabel>
      <Wrapper theme={theme}>
        <AddRow>
          <Input
            theme={theme}
            value={input}
            placeholder={t('pvWhitelistPlaceholder')}
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onAdd();
            }}
          />
          <SmallButton
            theme={theme}
            kind="primary"
            disabled={busy || !input.trim()}
            onClick={onAdd}
          >
            {busy ? t('pvProcessing') : t('add')}
          </SmallButton>
        </AddRow>

        {error ? <ErrorText theme={theme}>{error}</ErrorText> : null}

        {list.length === 0 ? (
          <Empty theme={theme}>{t('pvNoWhitelist')}</Empty>
        ) : (
          <List>
            {list.map((d) => (
              <Item key={d} theme={theme}>
                <Domain theme={theme}>{d}</Domain>
                <SmallButton
                  theme={theme}
                  kind="danger"
                  disabled={busy}
                  onClick={() => onRemove(d)}
                >
                  {t('delete')}
                </SmallButton>
              </Item>
            ))}
          </List>
        )}
      </Wrapper>
    </GroupBlock>
  );
});
