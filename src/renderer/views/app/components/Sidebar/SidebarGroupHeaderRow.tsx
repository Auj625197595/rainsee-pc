import { observer } from 'mobx-react-lite';
import * as React from 'react';
import { Plus } from '@phosphor-icons/react';

import {
  SidebarGroupHeader,
  SidebarGroupDot,
  SidebarGroupName,
  SidebarGroupCount,
  SidebarGroupNameInput,
  SidebarGroupChevron,
  SidebarSwatches,
  SidebarSwatch,
  SidebarGroupPinBadge,
  SidebarGroupAddButton,
} from './style';
import store from '../../store';
import { ITabGroup } from '../../models';
import { getDraggedLinkURL, isLinkDragEvent } from '../../utils/link-drop';
import { handleTabGroupContextMenu } from '../../utils/tab-context-menu';
import { getShellTranslator } from '../../utils/i18n';
import { SidebarDropLine } from '../SidebarTab/style';

const ChevronIcon = (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
);

// 固定分组钉子(复用侧边栏单个标签角标的 path,白描边保证组色底上可见)。
const PinGlyph = (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="currentColor"
    style={{ filter: 'drop-shadow(0 0 1px rgba(255,255,255,0.95))' }}
  >
    <path d="M14.5 2.5l7 7-1.4 1.4-1-1-3.9 3.9.5 4.8-1.6 1.6-4.2-4.2-4.4 4.4-1.1-1.1 4.4-4.4-4.2-4.2 1.6-1.6 4.8.5 3.9-3.9-1-1 1.4-1.4z" />
  </svg>
);

interface Props {
  group: ITabGroup;
  collapsed: boolean; // 组内容折叠态(chevron 方向)
  railCollapsed: boolean; // 侧栏窄轨态(仅显示色点)
  onToggle: () => void;
}

// 侧栏分组折叠头。除折叠外:
//   - 点击组色圆点 → 弹出预设色盘改色(store.tabGroups.setColor)
//   - 双击组名 → 内联输入框改名(store.tabGroups.rename)
// 与标签组悬停弹窗(tabgroup-preview)行为一致。
export const SidebarGroupHeaderRow = observer(
  ({ group, collapsed, railCollapsed, onToggle }: Props) => {
    const t = getShellTranslator();
    const gid = group.id;
    const [paletteOpen, setPaletteOpen] = React.useState(false);
    const [editing, setEditing] = React.useState(false);
    const [name, setName] = React.useState(group.name || '');
    const displayName = group.name || t('sghTabCount', { count: group.tabs.length });
    const compactName = Array.from(displayName.trim())[0] || '#';

    React.useEffect(() => {
      setName(group.name || '');
    }, [group.name, gid]);

    const commitName = () => {
      setEditing(false);
      store.tabGroups.rename(gid, name.trim());
    };

    return (
      <SidebarGroupHeader
        data-rainsee-part="sidebar-group"
        data-rainsee-pinned={group.isPinned ? 'true' : 'false'}
        data-sidebar-drop-owner="true"
        draggable={!editing && !paletteOpen}
        $dragging={store.tabs.sidebarDragGroupId === gid}
        collapsed={railCollapsed}
        dropActive={store.tabs.sidebarDropGroupId === gid}
        pinned={group.isPinned}
        $color={group.color}
        onDragStart={(e: React.DragEvent) => {
          const groupControl =
            e.target instanceof Element &&
            e.target.closest('[data-sidebar-group-control="true"]');
          if (groupControl || editing || paletteOpen) {
            e.preventDefault();
            return;
          }
          store.tabs.setSidebarGroupDrag(gid);
          e.dataTransfer.effectAllowed = 'move';
          try {
            e.dataTransfer.setData('text/plain', `group:${gid}`);
          } catch (err) {
            /* 忽略:某些环境禁止写 dataTransfer */
          }
        }}
        onClick={() => {
          // 改色/改名交互进行中不触发折叠。
          if (paletteOpen || editing) return;
          onToggle();
        }}
        onDragOver={(e: React.DragEvent) => {
          const dragGroupId = store.tabs.sidebarDragGroupId;
          if (dragGroupId !== -1) {
            const dragGroup = store.tabGroups.getGroupById(dragGroupId);
            if (
              !dragGroup ||
              dragGroupId === gid ||
              dragGroup.isPinned !== group.isPinned
            ) {
              return;
            }
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            store.tabs.setSidebarGroupDropTarget(
              gid,
              e.clientY < r.top + r.height / 2,
            );
            return;
          }

          const dragId = store.tabs.sidebarDragId;
          if (dragId !== -1) {
            const dragTab = store.tabs.getTabById(dragId);
            if (!dragTab || dragTab.tabGroupId === gid) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            store.tabs.setSidebarDropGroup(gid);
            return;
          }
          if (!isLinkDragEvent(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          store.tabs.setSidebarDropGroup(gid);
        }}
        onDrop={(e: React.DragEvent) => {
          const dragGroupId = store.tabs.sidebarDragGroupId;
          if (dragGroupId !== -1) {
            e.preventDefault();
            e.stopPropagation();
            const dragGroup = store.tabGroups.getGroupById(dragGroupId);
            const before = store.tabs.sidebarDropGroupBefore;
            store.tabs.clearSidebarGroupDrag();
            if (dragGroup) {
              store.tabs.moveGroupInSidebar(dragGroup, group, before);
            }
            return;
          }

          const dragId = store.tabs.sidebarDragId;
          if (dragId !== -1) {
            e.preventDefault();
            e.stopPropagation();
            store.tabs.clearSidebarDrag();
            const dragTab = store.tabs.getTabById(dragId);
            if (dragTab) store.tabs.moveTabIntoGroup(dragTab, gid);
            return;
          }
          if (!isLinkDragEvent(e)) return;
          e.preventDefault();
          e.stopPropagation();
          const url = getDraggedLinkURL(e.dataTransfer);
          store.tabs.clearSidebarDropTarget();
          if (!url) return;
          store.tabs.openLinkInSidebarGroup(url, gid);
        }}
        onDragEnd={() => store.tabs.clearSidebarGroupDrag()}
        onContextMenu={(e: React.MouseEvent) => {
          handleTabGroupContextMenu(e, group);
        }}
      >
        {store.tabs.sidebarDropGroupTargetId === gid && (
          <SidebarDropLine
            position={store.tabs.sidebarDropGroupBefore ? 'top' : 'bottom'}
          />
        )}
        <SidebarGroupDot
          data-rainsee-part="sidebar-group-color"
          data-sidebar-group-control="true"
          pinned={group.isPinned}
          collapsed={railCollapsed}
          style={{ backgroundColor: group.color }}
          title={railCollapsed ? displayName : t('shellPickGroupColor')}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            setPaletteOpen((v) => !v);
          }}
        >
          {railCollapsed ? compactName : null}
        </SidebarGroupDot>
        {paletteOpen && (
          <SidebarSwatches
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            {store.tabGroups.palette.map((c) => (
              <SidebarSwatch
                key={c}
                style={{ backgroundColor: c }}
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  store.tabGroups.setColor(gid, c);
                  setPaletteOpen(false);
                }}
              />
            ))}
          </SidebarSwatches>
        )}
        {editing && !railCollapsed ? (
          <SidebarGroupNameInput
            data-rainsee-part="sidebar-group-title-input"
            autoFocus
            value={name}
            placeholder={t('sghTabCount', { count: group.tabs.length })}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === 'Enter') commitName();
              else if (e.key === 'Escape') {
                setName(group.name || '');
                setEditing(false);
              }
            }}
          />
        ) : (
          <SidebarGroupName
            data-rainsee-part="sidebar-group-title"
            collapsed={railCollapsed}
            title={t('shellRenameHint')}
            onDoubleClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              setEditing(true);
            }}
          >
            {displayName}
          </SidebarGroupName>
        )}
        {group.isPinned && !railCollapsed && (
          <SidebarGroupPinBadge
            data-rainsee-part="sidebar-group-pin"
            title={t('shellGroupPinned')}
          >
            {PinGlyph}
          </SidebarGroupPinBadge>
        )}
        <SidebarGroupChevron
          data-rainsee-part="sidebar-group-chevron"
          collapsed={collapsed}
          hidden={railCollapsed}
        >
          {ChevronIcon}
        </SidebarGroupChevron>
        {!railCollapsed && (
          <SidebarGroupAddButton
            type="button"
            data-rainsee-part="sidebar-group-new-tab"
            data-sidebar-group-control="true"
            title={t('shellNewTabInGroup')}
            aria-label={t('shellNewTabInGroup')}
            onMouseDown={(e: React.MouseEvent) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              store.tabs.addTab(undefined, gid);
            }}
          >
            <Plus size={15} weight="bold" />
          </SidebarGroupAddButton>
        )}
        {!railCollapsed && (
          <SidebarGroupCount data-rainsee-part="sidebar-group-count">
            {group.tabs.length}
          </SidebarGroupCount>
        )}
      </SidebarGroupHeader>
    );
  },
);
