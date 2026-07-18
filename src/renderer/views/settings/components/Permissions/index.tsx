import * as React from 'react';
import { observer } from 'mobx-react-lite';
import styled, { css } from 'styled-components';

import { Header, SecondaryText } from '../App/style';
import store from '../../store';
import { ipcRenderer } from '~/common/renderer-ipc';
import { IPermissionRecord, ITheme } from '~/interfaces';
import {
  getDomain,
  getPermissionDecisionText,
  getPermissionText,
} from '~/utils';
import { getPalette } from '../../utils/palette';

const Wrapper = styled.div`
  margin-top: 6px;
`;

const TopBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const Intro = styled.div`
  margin-bottom: 18px;
`;

const Card = styled.div`
  border-radius: 20px;
  padding: 18px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      box-shadow: inset 0 0 0 1px ${p.line},
        0 10px 26px -24px rgba(40, 60, 120, 0.28);
    `;
  }}
`;

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const Item = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 14px 14px 16px;
  border-radius: 16px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.bg};
      box-shadow: inset 0 0 0 1px ${p.line};
    `;
  }}
`;

const ItemMain = styled.div`
  min-width: 0;
  flex: 1;
`;

const ItemTitle = styled.div`
  font-size: 14px;
  font-weight: 800;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

const ItemMeta = styled.div`
  margin-top: 5px;
  font-size: 12px;
  line-height: 1.5;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const RemoveButton = styled.button`
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 6px 10px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 800;
  transition: background-color 0.16s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.danger};

      &:hover {
        background-color: ${p.danger}14;
      }
    `;
  }}
`;

const ClearButton = styled.button`
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 8px 14px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 800;
  transition: background-color 0.16s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.danger};
      background-color: ${p.danger}12;

      &:hover {
        background-color: ${p.danger}1e;
      }

      &:disabled {
        opacity: 0.5;
        cursor: default;
      }
    `;
  }}
`;

const DecisionButton = styled.button<{ allow: boolean }>`
  border: none;
  cursor: pointer;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 900;
  white-space: nowrap;
  transition: filter 0.16s ease;

  &:hover {
    filter: brightness(0.97);
  }

  ${({ allow }) =>
    allow
      ? css`
          background-color: #eaf9f3;
          color: #28a37a;
        `
      : css`
          background-color: #fff1f1;
          color: #d45757;
        `}
`;

const Empty = styled.div`
  padding: 26px 18px;
  text-align: center;
  border-radius: 16px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMute};
      background-color: ${p.bg};
      box-shadow: inset 0 0 0 1px ${p.line};
    `;
  }}
`;

const formatMediaTypes = (value: string) => {
  if (!value) return '';

  try {
    const mediaTypes = JSON.parse(value);
    if (Array.isArray(mediaTypes) && mediaTypes.length > 0) {
      return mediaTypes.join(' / ');
    }
  } catch (e) {}

  return '';
};

export const Permissions = observer(() => {
  const [list, setList] = React.useState<IPermissionRecord[]>([]);
  const [busyId, setBusyId] = React.useState('');

  const load = React.useCallback(async () => {
    const res = await ipcRenderer.invoke('storage-get', {
      scope: 'permissions',
      query: {},
    });

    if (Array.isArray(res)) {
      setList(
        [...res].sort((a, b) => {
          const aKey = `${a.url}-${a.permission}`;
          const bKey = `${b.url}-${b.permission}`;
          return aKey.localeCompare(bKey, 'zh-CN');
        }),
      );
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const onRemove = async (item: IPermissionRecord) => {
    setBusyId(item._id || '');
    await ipcRenderer.invoke('storage-remove', {
      scope: 'permissions',
      query: { _id: item._id },
    });
    await load();
    setBusyId('');
  };

  const onClear = async () => {
    setBusyId('__all__');
    await ipcRenderer.invoke('storage-remove', {
      scope: 'permissions',
      query: {},
      multi: true,
    });
    await load();
    setBusyId('');
  };

  const onToggleDecision = async (item: IPermissionRecord) => {
    setBusyId(item._id || '');
    await ipcRenderer.invoke('storage-update', {
      scope: 'permissions',
      query: { _id: item._id },
      value: {
        type: item.type === 1 ? 2 : 1,
      },
    });
    await load();
    setBusyId('');
  };

  return (
    <Wrapper>
      <TopBar>
        <Header>权限管理</Header>
        <ClearButton
          theme={store.theme}
          disabled={list.length === 0 || busyId !== ''}
          onClick={onClear}
        >
          一键清空
        </ClearButton>
      </TopBar>
      <Intro>
        <SecondaryText>
          这里会列出你勾选“记住此选择”后保存下来的站点权限，以及像“所有链接在新页面打开”这类站点级行为。删除后，下次访问时会重新询问或恢复默认。
        </SecondaryText>
      </Intro>

      <Card theme={store.theme}>
        {list.length === 0 ? (
          <Empty theme={store.theme}>还没有已记忆的权限规则</Empty>
        ) : (
          <List>
            {list.map((item) => {
              const mediaText = formatMediaTypes(item.mediaTypes);
              const host = getDomain(item.url);

              return (
                <Item key={item._id || `${item.url}-${item.permission}`} theme={store.theme}>
                  <ItemMain>
                    <ItemTitle theme={store.theme}>
                      {host} · {getPermissionText(item.permission)}
                    </ItemTitle>
                    <ItemMeta theme={store.theme}>
                      {`站点：${item.url}`}
                      {mediaText ? ` · 类型：${mediaText}` : ''}
                    </ItemMeta>
                  </ItemMain>
                  <DecisionButton
                    allow={item.type === 1}
                    disabled={busyId === item._id}
                    onClick={() => onToggleDecision(item)}
                  >
                    {getPermissionDecisionText(item.type)}
                  </DecisionButton>
                  <RemoveButton
                    theme={store.theme}
                    disabled={busyId === item._id}
                    onClick={() => onRemove(item)}
                  >
                    删除
                  </RemoveButton>
                </Item>
              );
            })}
          </List>
        )}
      </Card>
    </Wrapper>
  );
});
