import * as React from 'react';
import { observer } from 'mobx-react-lite';
import styled, { css } from 'styled-components';
import { DotsSixVertical, Eye, EyeSlash } from '@phosphor-icons/react';

import store from '../../store';
import { Header, SecondaryText } from '../App/style';
import { NormalButton } from '../App';
import { Switch } from '~/renderer/components/Switch';
import { getPalette } from '../../utils/palette';
import { ITheme } from '~/interfaces';
import {
  CLUSTER_BUTTONS,
  SITE_BUTTONS,
  resolveToolbarLayout,
  DEFAULT_TOOLBAR_LAYOUT,
  DownloadVisibility,
  ToolbarLayout,
  ToolbarIcon,
} from '~/renderer/constants/toolbar-buttons';

// ---------------------------------------------------------------------------
// 图标渲染:Phosphor 组件用 currentColor;字符串 URL(SVG)在深色设置页反色。
// ---------------------------------------------------------------------------
const MetaIcon = observer(({ icon }: { icon: ToolbarIcon }) => {
  const dark = !!store.theme['pages.lightForeground'];
  if (typeof icon === 'string') {
    return (
      <img
        src={icon}
        alt=""
        draggable={false}
        style={{
          width: 18,
          height: 18,
          opacity: 0.82,
          filter: dark ? 'invert(1)' : 'none',
        }}
      />
    );
  }
  const C = icon;
  return (
    <C size={18} color={getPalette(store.theme).textMain} weight="regular" />
  );
});

// ---------------------------------------------------------------------------
// 排版原子
// ---------------------------------------------------------------------------
const TopRow = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 6px;

  & > button {
    margin-left: auto;
    flex-shrink: 0;
  }
`;

const GroupTitle = styled.div`
  margin: 18px 0 8px;
  padding: 0 4px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.02em;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const Card = styled.div`
  display: flex;
  flex-flow: column;
  gap: 2px;
  padding: 8px;
  border-radius: 16px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      box-shadow: inset 0 0 0 1px ${p.line}, 0 1px 2px rgba(20, 27, 45, 0.04);
    `;
  }}
`;

const DragRow = styled.div<{ dragging?: boolean; dim?: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  transition: background-color 0.14s ease, opacity 0.14s ease;
  opacity: ${({ dim }) => (dim ? 0.42 : 1)};

  ${({ theme, dragging }: { theme?: ITheme; dragging?: boolean }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${dragging ? p.primarySoft : 'transparent'};

      &:hover {
        background-color: ${dragging ? p.primarySoft : p.bg};
      }
    `;
  }}
`;

const Grip = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  cursor: grab;
  opacity: 0.5;
  flex-shrink: 0;

  &:hover {
    opacity: 0.9;
  }

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

const IconBox = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  flex-shrink: 0;
`;

const RowLabel = styled.div`
  flex: 1;
  min-width: 0;
  font-size: 14px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

const EyeBtn = styled.button`
  border: none;
  background: transparent;
  cursor: pointer;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background-color 0.14s ease;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};

    &:hover {
      background-color: ${getPalette(theme).bg};
      color: ${getPalette(theme).textMain};
    }
  `}
`;

const VisibilitySelect = styled.select`
  height: 30px;
  min-width: 142px;
  padding: 0 9px;
  border-radius: 8px;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  outline: none;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${p.bg};
      border: 1px solid ${p.line};

      &:hover,
      &:focus {
        border-color: ${p.primary};
      }
    `;
  }}
`;

const ToggleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 12px;
  border-radius: 12px;
`;

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------
export const CustomizeToolbar = observer(
  ({
    embedded = false,
    mode = 'all',
  }: {
    embedded?: boolean;
    mode?: 'all' | 'toolbar' | 'address-icons';
  }) => {
    // 归一化后的布局(每次渲染重算;依赖 store.settings.toolbarLayout observable)。
    const layout: ToolbarLayout = resolveToolbarLayout(
      store.settings.toolbarLayout,
    );

    // 拖拽中的按钮 id(瞬态 UI 态,用 React state 而非 mobx)。
    const [draggedId, setDraggedId] = React.useState<string | null>(null);

    const commit = (next: ToolbarLayout) => {
      store.settings.toolbarLayout = {
        left: next.left,
        right: next.right,
        hidden: next.hidden,
        downloadVisibility: next.downloadVisibility,
      };
      store.save();
    };

    // 区域内拖拽重排(不跨区)。
    const reorder = (area: 'left' | 'right', fromId: string, toId: string) => {
      if (fromId === toId) return;
      const list = layout[area].slice();
      const from = list.indexOf(fromId);
      const to = list.indexOf(toId);
      if (from === -1 || to === -1) return;
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      commit({ ...layout, [area]: list });
    };

    // 切换某个按钮的显隐(集群 + 地址栏内图标通用,都写 hidden)。
    const toggleHidden = (id: string) => {
      const hidden = layout.hidden.slice();
      const i = hidden.indexOf(id);
      if (i === -1) hidden.push(id);
      else hidden.splice(i, 1);
      commit({ ...layout, hidden });
    };

    const resetAll = () => {
      commit({
        left: DEFAULT_TOOLBAR_LAYOUT.left.slice(),
        right: DEFAULT_TOOLBAR_LAYOUT.right.slice(),
        hidden: DEFAULT_TOOLBAR_LAYOUT.hidden.slice(),
        downloadVisibility: DEFAULT_TOOLBAR_LAYOUT.downloadVisibility,
      });
    };

    // 是否偏离默认布局(决定「恢复默认」按钮是否显示):三组数组需完全一致才算默认。
    // 注意默认 hidden 含历史/书签(length 2),故不能用 length>0 判断。
    const sameArray = (a: string[], b: string[]) =>
      a.length === b.length && a.every((v, i) => v === b[i]);
    const isCustom =
      !sameArray(layout.left, DEFAULT_TOOLBAR_LAYOUT.left) ||
      !sameArray(layout.right, DEFAULT_TOOLBAR_LAYOUT.right) ||
      !sameArray(layout.hidden, DEFAULT_TOOLBAR_LAYOUT.hidden) ||
      layout.downloadVisibility !== DEFAULT_TOOLBAR_LAYOUT.downloadVisibility;

    // 渲染某个区域的拖拽列表。
    const renderArea = (area: 'left' | 'right') => {
      const ids = layout[area];
      return (
        <Card>
          {ids.map((id) => {
            const meta = CLUSTER_BUTTONS.find((b) => b.id === id);
            if (!meta) return null;
            const isDownloads = id === 'downloads';
            const dim = isDownloads
              ? layout.downloadVisibility === 'hidden'
              : layout.hidden.includes(id);
            return (
              <DragRow
                key={id}
                dragging={draggedId === id}
                dim={dim}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggedId) reorder(area, draggedId, id);
                  setDraggedId(null);
                }}
              >
                <Grip
                  draggable
                  title="拖动排序"
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    setDraggedId(id);
                  }}
                  onDragEnd={() => setDraggedId(null)}
                >
                  <DotsSixVertical size={17} weight="bold" />
                </Grip>
                <IconBox>
                  <MetaIcon icon={meta.Icon} />
                </IconBox>
                <RowLabel>{meta.label}</RowLabel>
                {isDownloads ? (
                  <VisibilitySelect
                    aria-label="下载按钮显示方式"
                    value={layout.downloadVisibility}
                    onChange={(e) =>
                      commit({
                        ...layout,
                        downloadVisibility: e.target
                          .value as DownloadVisibility,
                      })
                    }
                  >
                    <option value="always">始终显示</option>
                    <option value="on-download">触发下载时显示</option>
                    <option value="hidden">隐藏</option>
                  </VisibilitySelect>
                ) : (
                  <EyeBtn
                    title={dim ? '显示' : '隐藏'}
                    onClick={() => toggleHidden(id)}
                  >
                    {dim ? <EyeSlash size={18} /> : <Eye size={18} />}
                  </EyeBtn>
                )}
              </DragRow>
            );
          })}
        </Card>
      );
    };

    return (
      <>
        {!embedded && <Header>自定义工具栏</Header>}
        {mode !== 'address-icons' && (
          <>
            <TopRow>
              <SecondaryText>
                后退、前进、刷新与菜单固定显示，其余按钮仅能在所属区域内排序。
              </SecondaryText>
              {isCustom && (
                <NormalButton variant="soft" onClick={resetAll}>
                  恢复默认
                </NormalButton>
              )}
            </TopRow>
            <GroupTitle>地址栏左侧</GroupTitle>
            {renderArea('left')}
            <GroupTitle>地址栏右侧</GroupTitle>
            {renderArea('right')}
          </>
        )}
        {mode !== 'toolbar' && (
          <>
            <GroupTitle>可显示图标</GroupTitle>
            <Card>
              {SITE_BUTTONS.map((meta) => {
                const hidden = layout.hidden.includes(meta.id);
                return (
                  <ToggleRow key={meta.id}>
                    <IconBox>
                      <MetaIcon icon={meta.Icon} />
                    </IconBox>
                    <RowLabel>{meta.label}</RowLabel>
                    <Switch
                      clickable
                      value={!hidden}
                      onClick={() => toggleHidden(meta.id)}
                    />
                  </ToggleRow>
                );
              })}
            </Card>
          </>
        )}
      </>
    );
  },
);
