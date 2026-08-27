export const WORKSPACE_COLORS = [
  '#2563eb',
  '#0891b2',
  '#059669',
  '#d97706',
  '#dc2626',
  '#db2777',
  '#7c3aed',
  '#475569',
];

export interface IWorkspaceTab {
  key: string;
  url: string;
  title?: string;
  favicon?: string;
  order: number;
  pinned?: boolean;
  active?: boolean;
  groupKey?: string;
}

export interface IWorkspaceGroup {
  key: string;
  name: string;
  color: string;
  isPinned?: boolean;
}

export interface IWorkspace {
  id: string;
  name: string;
  color: string;
  tabs: IWorkspaceTab[];
  groups: IWorkspaceGroup[];
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
}

export interface IWorkspaceSummary extends IWorkspace {
  isOpen: boolean;
  windowId?: number;
}

export interface IWorkspaceSnapshot {
  tabs: IWorkspaceTab[];
  groups: IWorkspaceGroup[];
}
