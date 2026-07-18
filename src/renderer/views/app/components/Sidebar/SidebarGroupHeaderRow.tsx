import { observer } from 'mobx-react-lite';
import * as React from 'react';

import {
  SidebarGroupHeader,
  SidebarGroupDot,
  SidebarGroupName,
  SidebarGroupNameInput,
  SidebarGroupChevron,
  SidebarSwatches,
  SidebarSwatch,
} from './style';
import store from '../../store';
import { ITabGroup } from '../../models';
import { getDraggedLinkURL, isLinkDragEvent } from '../../utils/link-drop';

const ChevronIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9l6 6 6-6" />
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
    const gid = group.id;
    const [paletteOpen, setPaletteOpen] = React.useState(false);
    const [editing, setEditing] = React.useState(false);
    const [name, setName] = React.useState(group.name || '');

    React.useEffect(() => {
      setName(group.name || '');
    }, [group.name, gid]);

    const commitName = () => {
      setEditing(false);
      store.tabGroups.rename(gid, name.trim());
    };

    return (
      <SidebarGroupHeader
        collapsed={railCollapsed}
        dropActive={store.tabs.sidebarDropGroupId === gid}
        onClick={() => {
          // 改色/改名交互进行中不触发折叠。
          if (paletteOpen || editing) return;
          onToggle();
        }}
        onDragOver={(e: React.DragEvent) => {
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
      >
        <SidebarGroupDot
          style={{ backgroundColor: group.color }}
          title="点击选择组色"
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            setPaletteOpen((v) => !v);
          }}
        />
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
            autoFocus
            value={name}
            placeholder={`${group.tabs.length} 个标签页`}
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
            collapsed={railCollapsed}
            title="双击可重命名分组"
            onDoubleClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              setEditing(true);
            }}
          >
            {group.name || `${group.tabs.length} 个标签页`}
          </SidebarGroupName>
        )}
        <SidebarGroupChevron collapsed={collapsed} hidden={railCollapsed}>
          {ChevronIcon}
        </SidebarGroupChevron>
      </SidebarGroupHeader>
    );
  },
);
