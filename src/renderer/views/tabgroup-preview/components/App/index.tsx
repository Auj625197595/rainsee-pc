import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';
import { Plus } from '@phosphor-icons/react';

import {
  HoverArea,
  StyledApp,
  Header,
  HeaderAddButton,
  ColorDot,
  ColorButton,
  Swatches,
  Swatch,
  NameInput,
  List,
  Row,
  RowFav,
  RowTitle,
  RowClose,
} from './style';
import store, { IPreviewTab } from '../../store';
import { UIStyle } from '~/renderer/mixins/default-styles';
import { useTabHoverActivation } from '~/renderer/utils/tab-hover-activation';

const CloseIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#5F6368"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

// 从分组移出图标(门+向外箭头,通用"离开"语义)。
const UngroupIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#5F6368"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

const GlobeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="8.5" stroke="#5F6368" strokeWidth="1.6" />
    <path
      d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.4 3.5 8.5S14.3 18.1 12 20.5C9.7 18.1 8.5 15.1 8.5 12S9.7 5.9 12 3.5Z"
      stroke="#5F6368"
      strokeWidth="1.6"
    />
  </svg>
);

const PreviewTabRow = observer(({ tab }: { tab: IPreviewTab }) => {
  const hoverActivation = useTabHoverActivation({
    enabled:
      store.tabHoverActivationBehavior !== 'off' &&
      (!!tab.discarded ||
        store.tabHoverActivationBehavior === 'activate-and-switch'),
    delay: store.tabHoverActivationDelay,
    selected: tab.selected,
    activate: () =>
      store.action({ type: 'activateOnHover', tabId: tab.id }),
    blocked: () => dragFromId !== null,
  });

  return (
    <Row
      selected={tab.selected}
      draggable
      onDragStart={() => {
        hoverActivation.cancel();
        dragFromId = tab.id;
      }}
      onDragEnd={() => {
        dragFromId = null;
      }}
      onDragOver={(e: React.DragEvent) => e.preventDefault()}
      onDrop={(e: React.DragEvent) => {
        const fromId = dragFromId;
        dragFromId = null;
        if (fromId == null || fromId === tab.id) return;
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const before = e.clientX < r.left + r.width / 2;
        store.action({
          type: 'reorder',
          fromId,
          toId: tab.id,
          before,
        });
      }}
      onMouseEnter={hoverActivation.schedule}
      onMouseLeave={hoverActivation.cancel}
      onMouseDown={hoverActivation.cancel}
      onClick={() => store.action({ type: 'select', tabId: tab.id })}
      onContextMenu={() => store.action({ type: 'contextmenu', tabId: tab.id })}
    >
      <RowFav>
        {tab.favicon ? <img src={tab.favicon} alt="" /> : <GlobeIcon />}
      </RowFav>
      <RowTitle>{tab.title}</RowTitle>
      <RowClose
        title="从分组移出"
        onMouseEnter={hoverActivation.cancel}
        onMouseDown={hoverActivation.cancel}
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          store.action({ type: 'removegroup', tabId: tab.id });
        }}
      >
        <UngroupIcon />
      </RowClose>
      <RowClose
        onMouseEnter={hoverActivation.cancel}
        onMouseDown={hoverActivation.cancel}
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          store.action({ type: 'close', tabId: tab.id });
        }}
      >
        <CloseIcon />
      </RowClose>
    </Row>
  );
});

export const App = observer(() => {
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  // 改名输入框:本地 state 为输入源(避免每次 IPC 刷新回写打断输入),
  // 仅在切换分组(store.groupId 变化)时用 store.groupName 重新初始化。
  const [name, setName] = React.useState(store.groupName);
  React.useEffect(() => {
    setName(store.groupName);
  }, [store.groupId]);

  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <HoverArea
        onMouseEnter={() => store.notifyEnter()}
        onMouseLeave={() => store.notifyLeave()}
      >
        <StyledApp>
          <UIStyle />
          <Header>
            <ColorButton
              title="点击选择组色"
              onClick={() => setPaletteOpen((v) => !v)}
            >
              <ColorDot style={{ backgroundColor: store.groupColor }} />
              {paletteOpen && (
                <Swatches
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                >
                  {store.palette.map((c) => (
                    <Swatch
                      key={c}
                      style={{ backgroundColor: c }}
                      onClick={() => {
                        store.action({ type: 'setcolor', color: c });
                        setPaletteOpen(false);
                      }}
                    />
                  ))}
                </Swatches>
              )}
            </ColorButton>
            <NameInput
              value={name}
              placeholder={`${store.tabs.length} 个标签页`}
              onFocus={() => {
                store.editingName = true;
              }}
              onBlur={() => {
                store.editingName = false;
              }}
              onChange={(e) => {
                const v = e.target.value;
                setName(v);
                store.action({ type: 'rename', name: v });
              }}
            />
            <HeaderAddButton
              type="button"
              title="在分组中新建标签页"
              aria-label="在分组中新建标签页"
              onClick={() => store.action({ type: 'new' })}
            >
              <Plus size={16} weight="bold" />
            </HeaderAddButton>
          </Header>
          <List>
            {store.tabs.map((tab) => (
              <PreviewTabRow key={tab.id} tab={tab} />
            ))}
          </List>
        </StyledApp>
      </HoverArea>
    </ThemeProvider>
  );
});

// 行内拖拽源(模块级,简单实现;弹窗内同组重排)。
let dragFromId: number | null = null;
