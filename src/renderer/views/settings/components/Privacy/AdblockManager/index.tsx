import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ipcRenderer } from '~/common/renderer-ipc';
import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';
import { getPalette } from '../../../utils/palette';
import store from '../../../store';
import { Switch } from '~/renderer/components/Switch';

interface ISubItem {
  url: string;
  name: string;
  count: number;
  enabled: boolean;
  builtin: boolean;
  updatedAt: number;
}

interface ISubStore {
  seeded: boolean;
  autoUpdateHours: number;
  items: ISubItem[];
  error?: string;
}

const AUTO_OPTIONS = [
  { label: '关闭', hours: 0 },
  { label: '每天', hours: 24 },
  { label: '每三天', hours: 72 },
  { label: '每周', hours: 168 },
];

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
  flex-wrap: wrap;
`;

const TopTitle = styled.div`
  font-size: 15px;
  font-weight: 700;
  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

const Spacer = styled.div`
  flex: 1;
`;

const AutoWrap = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const Select = styled.select`
  font-family: inherit;
  font-size: 13px;
  padding: 5px 8px;
  border-radius: 8px;
  outline: none;
  cursor: pointer;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${p.bg};
      border: 1px solid ${p.line};
    `;
  }}
`;

const SmallButton = styled.button<{
  theme?: ITheme;
  kind?: 'primary' | 'ghost' | 'danger';
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

  ${({
    theme,
    kind,
  }: {
    theme?: ITheme;
    kind?: 'primary' | 'ghost' | 'danger';
  }) => {
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
    if (kind === 'ghost') {
      return css`
        color: ${p.textSub};
        background-color: transparent;
        box-shadow: inset 0 0 0 1px ${p.line};
        &:hover:not(:disabled) {
          background-color: ${p.bg};
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

const ItemInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const ItemName = styled.div`
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

const Badge = styled.span`
  font-size: 11px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 999px;
  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.primary};
      background-color: ${p.primarySoft};
    `;
  }}
`;

const ItemMeta = styled.div`
  margin-top: 2px;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const Actions = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
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

const fmtTime = (ts: number) => {
  if (!ts) return '从未更新';
  const d = new Date(ts);
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
};

export default observer(() => {
  const [data, setData] = React.useState<ISubStore>({
    seeded: true,
    autoUpdateHours: 168,
    items: [],
  });
  const [input, setInput] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null); // url 或 'add'/'all'/'auto'

  const load = React.useCallback(async () => {
    const res: ISubStore = await ipcRenderer.invoke(
      'adblock-get-subscriptions',
    );
    if (res) setData(res);
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const apply = (res: ISubStore) => {
    if (!res) return;
    if (res.error) {
      setError(res.error);
    } else {
      setError('');
    }
    setData(res);
  };

  const onAdd = async () => {
    const url = input.trim();
    if (!url) return;
    setBusy('add');
    setError('');
    const res: ISubStore = await ipcRenderer.invoke(
      'adblock-add-subscription',
      url,
    );
    apply(res);
    if (res && !res.error) setInput('');
    setBusy(null);
  };

  const onRemove = async (url: string) => {
    setBusy(url);
    const res: ISubStore = await ipcRenderer.invoke(
      'adblock-remove-subscription',
      url,
    );
    apply(res);
    setBusy(null);
  };

  const onToggle = async (url: string, enabled: boolean) => {
    setBusy(url);
    const res: ISubStore = await ipcRenderer.invoke(
      'adblock-toggle-subscription',
      url,
      enabled,
    );
    apply(res);
    setBusy(null);
  };

  const onUpdate = async (url: string) => {
    setBusy(url);
    const res: ISubStore = await ipcRenderer.invoke(
      'adblock-update-subscription',
      url,
    );
    apply(res);
    setBusy(null);
  };

  const onUpdateAll = async () => {
    setBusy('all');
    const res: ISubStore = await ipcRenderer.invoke('adblock-update-all');
    apply(res);
    setBusy(null);
  };

  const onAutoChange = async (hours: number) => {
    setBusy('auto');
    const res: ISubStore = await ipcRenderer.invoke(
      'adblock-set-auto-update',
      hours,
    );
    apply(res);
    setBusy(null);
  };

  const theme = store.theme;
  const anyBusy = busy !== null;

  return (
    <GroupBlock>
      <GroupLabel theme={theme}>规则订阅</GroupLabel>
      <Wrapper theme={theme}>
        <TopBar>
          <Spacer />
          <AutoWrap theme={theme}>
            自动更新
            <Select
              theme={theme}
              value={data.autoUpdateHours}
              disabled={anyBusy}
              onChange={(e) => onAutoChange(Number(e.target.value))}
            >
              {AUTO_OPTIONS.map((o) => (
                <option key={o.hours} value={o.hours}>
                  {o.label}
                </option>
              ))}
            </Select>
          </AutoWrap>
          <SmallButton
            theme={theme}
            kind="primary"
            disabled={anyBusy || data.items.length === 0}
            onClick={onUpdateAll}
          >
            {busy === 'all' ? '更新中…' : '一键更新'}
          </SmallButton>
        </TopBar>

        <AddRow>
          <Input
            theme={theme}
            value={input}
            placeholder="添加订阅地址，如 https://easylist.to/easylist/easylist.txt"
            disabled={busy === 'add'}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onAdd();
            }}
          />
          <SmallButton
            theme={theme}
            kind="primary"
            disabled={anyBusy || !input.trim()}
            onClick={onAdd}
          >
            {busy === 'add' ? '添加中…' : '添加'}
          </SmallButton>
        </AddRow>

        {error ? <ErrorText theme={theme}>{error}</ErrorText> : null}

        {data.items.length === 0 ? (
          <Empty theme={theme}>暂无订阅，添加一个开始拦截广告</Empty>
        ) : (
          <List>
            {data.items.map((it) => {
              const itemBusy = busy === it.url;
              return (
                <Item key={it.url} theme={theme}>
                  <Switch
                    value={it.enabled}
                    onClick={() => !anyBusy && onToggle(it.url, !it.enabled)}
                  />
                  <ItemInfo>
                    <ItemName theme={theme}>
                      {it.name || it.url}
                      {it.builtin ? <Badge theme={theme}>内置</Badge> : null}
                    </ItemName>
                    <ItemMeta theme={theme}>
                      {`${it.count} 条规则 · ${fmtTime(it.updatedAt)}`}
                    </ItemMeta>
                  </ItemInfo>
                  <Actions>
                    <SmallButton
                      theme={theme}
                      kind="ghost"
                      disabled={anyBusy}
                      onClick={() => onUpdate(it.url)}
                    >
                      {itemBusy ? '…' : '更新'}
                    </SmallButton>
                    <SmallButton
                      theme={theme}
                      kind="danger"
                      disabled={anyBusy}
                      onClick={() => onRemove(it.url)}
                    >
                      删除
                    </SmallButton>
                  </Actions>
                </Item>
              );
            })}
          </List>
        )}
      </Wrapper>
    </GroupBlock>
  );
});
