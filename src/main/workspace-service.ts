import { ipcMain } from 'electron';

import { Application } from './application';
import { IWorkspace, IWorkspaceSnapshot, IWorkspaceSummary, WORKSPACE_COLORS } from '~/interfaces';
import { isSessionRestorableUrl } from '~/utils/url';

const isRestorableUrl = isSessionRestorableUrl;

const normalizeName = (name: unknown, fallback: string) => {
  const value = String(name || '').trim().slice(0, 40);
  return value || fallback;
};

const normalizeSnapshot = (snapshot: any): IWorkspaceSnapshot => {
  const groups = Array.isArray(snapshot?.groups)
    ? snapshot.groups
        .filter((group: any) => group && group.key)
        .map((group: any) => ({
          key: String(group.key),
          name: String(group.name || '').trim().slice(0, 40),
          color: String(group.color || WORKSPACE_COLORS[0]),
          isPinned: !!group.isPinned,
        }))
    : [];
  const groupKeys = new Set(groups.map((group: IWorkspaceSnapshot['groups'][number]) => group.key));
  const tabs = Array.isArray(snapshot?.tabs)
    ? snapshot.tabs
        .filter((tab: any) => tab && isRestorableUrl(tab.url))
        .map((tab: any, index: number) => ({
          key: String(tab.key || `tab-${index}-${Date.now()}`),
          url: String(tab.url),
          title: String(tab.title || '').slice(0, 500),
          favicon: tab.favicon ? String(tab.favicon) : undefined,
          order: Number.isFinite(tab.order) ? Number(tab.order) : index,
          pinned: !!tab.pinned,
          active: !!tab.active,
          groupKey: groupKeys.has(String(tab.groupKey))
            ? String(tab.groupKey)
            : undefined,
        }))
        .sort((left: any, right: any) => left.order - right.order)
        .map((tab: any, index: number) => ({ ...tab, order: index }))
    : [];

  if (tabs.length > 0 && !tabs.some((tab: IWorkspaceSnapshot['tabs'][number]) => tab.active)) tabs[tabs.length - 1].active = true;
  return { tabs, groups };
};

export class WorkspaceService {
  private readonly pendingSnapshots = new Map<
    string,
    { windowId: number; resolve: (snapshot: IWorkspaceSnapshot | null) => void; timer: NodeJS.Timeout }
  >();

  private readonly openWindows = new Map<string, number>();

  public constructor() {
    ipcMain.handle('workspace-list', () => this.list());
    ipcMain.handle('workspace-current-count', (_event, windowId: number) => this.currentCount(Number(windowId)));
    ipcMain.handle('workspace-create', (_event, payload) => this.create(payload));
    ipcMain.handle('workspace-open', (_event, id: string) => this.open(String(id)));
    ipcMain.handle('workspace-update', (_event, payload) => this.update(payload));
    ipcMain.handle('workspace-replace-tabs', (_event, payload) => this.replaceTabs(payload));
    ipcMain.handle('workspace-delete', (_event, id: string) => this.remove(String(id)));

    ipcMain.on('workspace-snapshot-response', (event, payload) => {
      const requestId = String(payload?.requestId || '');
      const pending = this.pendingSnapshots.get(requestId);
      if (!pending || event.sender.id !== this.windowWebContentsId(pending.windowId)) return;
      clearTimeout(pending.timer);
      this.pendingSnapshots.delete(requestId);
      pending.resolve(normalizeSnapshot(payload.snapshot));
    });

    ipcMain.on('workspace-session-sync', (event, payload) => {
      const window = Application.instance.windows.list.find((item) => item.webContents.id === event.sender.id);
      if (!window?.workspaceId || window.workspaceId !== String(payload?.workspaceId || '')) return;
      this.syncSnapshot(window.workspaceId, payload.snapshot).catch(() => undefined);
    });
  }

  public bindWindow(workspaceId: string, windowId: number) {
    this.openWindows.set(workspaceId, windowId);
  }

  public unbindWindow(windowId: number) {
    for (const [workspaceId, id] of this.openWindows) {
      if (id === windowId) {
        this.openWindows.delete(workspaceId);
        this.broadcast();
      }
    }
  }

  public async getContext(id: string): Promise<IWorkspace | null> {
    return (await Application.instance.storage.findOne<IWorkspace>({ scope: 'workspaces', query: { id } })) || null;
  }

  private async currentCount(windowId: number) {
    const source = Application.instance.windows.list.find((item) => item.id === windowId);
    if (!source || source.incognito) return 0;
    return Array.from(source.viewManager.views.values()).filter((view: any) =>
      isRestorableUrl(view.url),
    ).length;
  }

  private async list(): Promise<IWorkspaceSummary[]> {
    const docs = await Application.instance.storage.find<IWorkspace>({ scope: 'workspaces', query: {} });
    return docs
      .map((doc) => ({ ...doc, isOpen: this.openWindows.has(doc.id), windowId: this.openWindows.get(doc.id) }))
      .sort((left, right) => Number(right.isOpen) - Number(left.isOpen) || right.lastOpenedAt - left.lastOpenedAt);
  }

  private async create(payload: any) {
    const sourceWindowId = Number(payload?.sourceWindowId);
    const source = Application.instance.windows.list.find((item) => item.id === sourceWindowId);
    if (!source || (!payload?.empty && source.incognito)) return { ok: false, error: 'incognito' };
    const snapshot = payload?.empty
      ? { tabs: [], groups: [] }
      : (await this.requestSnapshot(sourceWindowId)) || this.fallbackSnapshot(source);
    const now = Date.now();
    const existingCount = (await this.list()).length;
    const doc: IWorkspace = {
      id: `workspace-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name: normalizeName(payload?.name, `工作区 ${existingCount + 1}`),
      color: WORKSPACE_COLORS.includes(String(payload?.color)) ? String(payload.color) : WORKSPACE_COLORS[0],
      ...snapshot,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: 0,
    };
    await Application.instance.storage.insert({ scope: 'workspaces', item: doc });
    this.broadcast();
    return { ok: true, workspace: doc };
  }

  private async open(id: string) {
    const workspace = await this.getContext(id);
    if (!workspace) return { ok: false, error: 'missing' };
    const existingId = this.openWindows.get(id);
    if (existingId) {
      const existing = Application.instance.windows.list.find((item) => item.id === existingId);
      if (existing) {
        existing.showAndFocus();
        return { ok: true, windowId: existing.id, reused: true };
      }
      this.openWindows.delete(id);
    }
    const window = Application.instance.windows.openWorkspace(workspace);
    this.bindWindow(id, window.id);
    await Application.instance.storage.update({ scope: 'workspaces', query: { id }, value: { lastOpenedAt: Date.now() } });
    this.broadcast();
    return { ok: true, windowId: window.id, reused: false };
  }

  private async update(payload: any) {
    const id = String(payload?.id || '');
    const workspace = await this.getContext(id);
    if (!workspace) return { ok: false, error: 'missing' };
    const patch: Partial<IWorkspace> = {};
    if (payload?.name !== undefined) patch.name = normalizeName(payload.name, workspace.name);
    if (payload?.color && WORKSPACE_COLORS.includes(String(payload.color))) patch.color = String(payload.color);
    if (Object.keys(patch).length > 0) {
      patch.updatedAt = Date.now();
      await Application.instance.storage.update({ scope: 'workspaces', query: { id }, value: patch as any });
      const windowId = this.openWindows.get(id);
      if (windowId) Application.instance.windows.list.find((item) => item.id === windowId)?.send('workspace-context-updated', { ...workspace, ...patch });
      this.broadcast();
    }
    return { ok: true };
  }

  private async replaceTabs(payload: any) {
    const id = String(payload?.id || '');
    const sourceWindowId = Number(payload?.sourceWindowId);
    const source = Application.instance.windows.list.find((item) => item.id === sourceWindowId);
    const workspace = await this.getContext(id);
    if (!source || source.incognito || !workspace) return { ok: false, error: 'invalid' };
    if (this.openWindows.has(id)) return { ok: false, error: 'open' };
    const snapshot = (await this.requestSnapshot(sourceWindowId)) || this.fallbackSnapshot(source);
    const updated = await this.syncSnapshot(id, snapshot, true);
    return updated ? { ok: true } : { ok: false, error: 'empty' };
  }

  private async remove(id: string) {
    const workspace = await this.getContext(id);
    if (!workspace) return { ok: false, error: 'missing' };
    const windowId = this.openWindows.get(id);
    await Application.instance.storage.remove({ scope: 'workspaces', query: { id } });
    this.openWindows.delete(id);
    if (windowId) Application.instance.windows.list.find((item) => item.id === windowId)?.win.close();
    this.broadcast();
    return { ok: true };
  }

  private async syncSnapshot(id: string, rawSnapshot: any, broadcast = false) {
    const snapshot = normalizeSnapshot(rawSnapshot);
    // 关闭最后一个标签与启动水合之间会短暂得到空快照。浏览器随后会补出新标签页，
    // 因此已有可恢复标签的工作区不能被这个瞬态空值覆盖。
    if (!snapshot.tabs.length) {
      const current = await this.getContext(id);
      if (!current || current.tabs.length) return false;
    }
    await Application.instance.storage.update({ scope: 'workspaces', query: { id }, value: { tabs: snapshot.tabs, groups: snapshot.groups, updatedAt: Date.now() } as any });
    const windowId = this.openWindows.get(id);
    const window = windowId && Application.instance.windows.list.find((item) => item.id === windowId);
    if (window?.workspace) {
      window.workspace = { ...window.workspace, tabs: snapshot.tabs, groups: snapshot.groups, updatedAt: Date.now() };
    }
    if (broadcast) this.broadcast();
    return true;
  }

  private async requestSnapshot(windowId: number): Promise<IWorkspaceSnapshot | null> {
    const target = Application.instance.windows.list.find((item) => item.id === windowId);
    if (!target) return null;
    const requestId = `snapshot-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingSnapshots.delete(requestId);
        resolve(null);
      }, 1200);
      this.pendingSnapshots.set(requestId, { windowId, resolve, timer });
      target.send('workspace-snapshot-request', requestId);
    });
  }

  private fallbackSnapshot(source: any): IWorkspaceSnapshot {
    const tabs = Array.from(source.viewManager.views.values()).map((view: any, order) => ({
      key: `view-${view.id}`,
      url: view.url,
      title: view.title,
      favicon: view.favicon,
      order,
      active: view.id === source.viewManager.selectedId,
    }));
    return normalizeSnapshot({ tabs, groups: [] });
  }

  private windowWebContentsId(windowId: number) {
    return Application.instance.windows.list.find((item) => item.id === windowId)?.webContents.id;
  }

  private broadcast() {
    this.list().then((items) => Application.instance.dialogs.sendToAll('workspaces-updated', items)).catch(() => undefined);
  }
}

export { isRestorableUrl, normalizeSnapshot };
