import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'

const TAB_GROUP_ID_NONE = -1

// chrome.tabGroups + the related chrome.tabs.group / chrome.tabs.ungroup.
// TabGroups.{get,query,update,move} are gated on the "tabGroups" permission;
// tabs.group/ungroup are part of the tabs API and registered here (wired into
// the router from index.ts) so they can share this class's in-memory state.
//
// Electron has no native tab-group concept, so groups live in memory per
// session: a Map<groupId, {title,color,collapsed,windowId,tabIds}> plus a
// reverse tabId -> groupId index so chrome.tabs.Tab.groupId stays in sync with
// chrome.tabs.group/ungroup and tabs.query({ groupId }).
interface TabGroup {
  id: number
  windowId: number
  title?: string
  color?: chrome.tabGroups.Color
  collapsed?: boolean
  tabIds: number[]
}

let nextId = 1

export class TabGroupsAPI {
  private groups = new Map<number, TabGroup>()
  private tabToGroup = new Map<number, number>()

  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler()
    handle('tabGroups.get', this.get, { permission: 'tabGroups' })
    handle('tabGroups.query', this.query, { permission: 'tabGroups' })
    handle('tabGroups.update', this.update, { permission: 'tabGroups' })
    handle('tabGroups.move', this.move, { permission: 'tabGroups' })

    this.ctx.store.on('tab-removed', (tabId: number, isWindowClosing = false) => {
      this.detachTab(tabId, false, isWindowClosing)
    })
    this.ctx.store.on('window-removed', (windowId: number) => {
      this.removeWindowGroups(windowId)
    })
  }

  getTabGroupId(tabId: number): number {
    return this.tabToGroup.get(tabId) ?? TAB_GROUP_ID_NONE
  }

  private toChrome(g: TabGroup): chrome.tabGroups.TabGroup {
    return {
      id: g.id,
      collapsed: !!g.collapsed,
      color: (g.color || 'grey') as chrome.tabGroups.Color,
      title: g.title,
      windowId: g.windowId,
    }
  }

  private fireUpdated(g: TabGroup) {
    this.ctx.router.broadcastEvent('tabGroups.onUpdated', this.toChrome(g))
  }

  private fireRemoved(g: TabGroup, isWindowClosing = false) {
    // Chrome's onRemoved payload is not a TabGroup. In particular, the field
    // is groupId (not id) and it includes the window-closing state.
    this.ctx.router.broadcastEvent('tabGroups.onRemoved', {
      groupId: g.id,
      windowId: g.windowId,
      isWindowClosing,
    })
  }

  private normalizeTabIds(tabIds?: number | number[]): number[] {
    const list = Array.isArray(tabIds) ? tabIds : typeof tabIds === 'number' ? [tabIds] : []
    return Array.from(
      new Set(
        list.filter(
          (tabId) =>
            typeof tabId === 'number' && Number.isInteger(tabId) && tabId >= 0,
        ),
      ),
    )
  }

  private resolveWindowId(
    event: ExtensionEvent,
    tabIds: number[],
    requestedWindowId?: number,
  ): number {
    const currentWindowId = this.ctx.store.getCurrentWindow(event)?.id ?? -1
    if (requestedWindowId === -2) return currentWindowId
    if (typeof requestedWindowId === 'number' && requestedWindowId > -1) {
      return requestedWindowId
    }
    for (const tabId of tabIds) {
      const tab = this.ctx.store.getTabById(tabId)
      if (!tab) continue
      const win = this.ctx.store.tabToWindow.get(tab)
      if (win && !win.isDestroyed()) return win.id
    }
    return currentWindowId
  }

  private notifyTabsChanged(tabIds: number[]) {
    const tabs = this.ctx.tabs
    if (!tabs) return
    for (const tabId of new Set(tabIds)) tabs.onUpdated(tabId)
  }

  private detachTab(tabId: number, notifyTab: boolean, isWindowClosing = false): number {
    const previousGroupId = this.tabToGroup.get(tabId)
    if (previousGroupId == null) return TAB_GROUP_ID_NONE

    this.tabToGroup.delete(tabId)

    const group = this.groups.get(previousGroupId)
    if (group) {
      group.tabIds = group.tabIds.filter((id) => id !== tabId)
      if (group.tabIds.length === 0) {
        this.groups.delete(previousGroupId)
        this.fireRemoved(group, isWindowClosing)
      }
    }

    if (notifyTab) this.notifyTabsChanged([tabId])
    return previousGroupId
  }

  private attachTab(tabId: number, group: TabGroup): boolean {
    if (this.getTabGroupId(tabId) === group.id) return false

    this.detachTab(tabId, false)

    if (!group.tabIds.includes(tabId)) {
      group.tabIds.push(tabId)
    }
    this.tabToGroup.set(tabId, group.id)
    return true
  }

  // ---- chrome.tabs.group / tabs.ungroup (no permission gate; tabs API) ----

  group = (
    event: ExtensionEvent,
    options: {
      tabIds?: number | number[]
      groupId?: number
      // Chrome only accepts windowId here. Group metadata is set through
      // tabGroups.update after tabs.group returns the new group id.
      createProperties?: { windowId?: number }
    },
  ): number => {
    const tabIds = this.normalizeTabIds(options?.tabIds)
    const requestedGroupId = options?.groupId

    if (typeof requestedGroupId === 'number') {
      const group = this.groups.get(requestedGroupId)
      if (!group) throw new Error(`No tab group with id '${requestedGroupId}'`)

      const changedTabIds: number[] = []
      for (const tabId of tabIds) {
        if (this.attachTab(tabId, group)) changedTabIds.push(tabId)
      }
      if (changedTabIds.length) this.notifyTabsChanged(changedTabIds)
      return group.id
    }

    const cp = options?.createProperties || {}
    const g: TabGroup = {
      id: nextId++,
      windowId: this.resolveWindowId(event, tabIds, cp.windowId),
      tabIds: [],
    }
    this.groups.set(g.id, g)

    const changedTabIds: number[] = []
    for (const tabId of tabIds) {
      if (this.attachTab(tabId, g)) changedTabIds.push(tabId)
    }

    this.ctx.router.broadcastEvent('tabGroups.onCreated', this.toChrome(g))
    if (changedTabIds.length) this.notifyTabsChanged(changedTabIds)
    return g.id
  }

  ungroup = (_event: ExtensionEvent, options: { tabIds?: number | number[] }): void => {
    const changedTabIds: number[] = []
    for (const tabId of this.normalizeTabIds(options?.tabIds)) {
      if (this.detachTab(tabId, false) !== TAB_GROUP_ID_NONE) changedTabIds.push(tabId)
    }
    if (changedTabIds.length) this.notifyTabsChanged(changedTabIds)
  }

  // ---- chrome.tabGroups.* ----

  private get = (_event: ExtensionEvent, groupId: number): chrome.tabGroups.TabGroup => {
    const g = this.groups.get(groupId)
    if (!g) throw new Error(`No tab group with id '${groupId}'`)
    return this.toChrome(g)
  }

  private query = (
    _event: ExtensionEvent,
    info: {
      windowId?: number
      title?: string
      color?: chrome.tabGroups.Color
      collapsed?: boolean
    } = {},
  ): chrome.tabGroups.TabGroup[] => {
    let list = Array.from(this.groups.values())
    if (info.windowId != null) list = list.filter((g) => g.windowId === info.windowId)
    if (info.title != null) list = list.filter((g) => g.title === info.title)
    if (info.color != null) list = list.filter((g) => (g.color || 'grey') === info.color)
    if (info.collapsed != null) list = list.filter((g) => !!g.collapsed === info.collapsed)
    return list.map((g) => this.toChrome(g))
  }

  private update = (
    _event: ExtensionEvent,
    groupId: number,
    updateProperties: { title?: string; color?: chrome.tabGroups.Color; collapsed?: boolean },
  ): chrome.tabGroups.TabGroup => {
    const g = this.groups.get(groupId)
    if (!g) throw new Error(`No tab group with id '${groupId}'`)
    if (updateProperties && updateProperties.title !== undefined) {
      g.title = updateProperties.title || undefined
    }
    if (updateProperties && updateProperties.color !== undefined) g.color = updateProperties.color
    if (updateProperties && updateProperties.collapsed !== undefined) {
      g.collapsed = updateProperties.collapsed
    }
    this.fireUpdated(g)
    return this.toChrome(g)
  }

  private move = (
    event: ExtensionEvent,
    groupId: number,
    moveProperties: { windowId?: number; index?: number },
  ): chrome.tabGroups.TabGroup => {
    const g = this.groups.get(groupId)
    if (!g) throw new Error(`No tab group with id '${groupId}'`)
    if (moveProperties && moveProperties.windowId !== undefined) {
      const targetWindowId =
        moveProperties.windowId === -2
          ? this.ctx.store.getCurrentWindow(event)?.id ?? g.windowId
          : moveProperties.windowId
      if (targetWindowId !== g.windowId) {
        // Electron has no tab reparenting primitive. Silently changing only
        // the group metadata would make group.windowId disagree with every
        // member tab, so reject the unsupported cross-window operation.
        throw new Error('Moving tab groups across windows is not supported')
      }
    }
    // Electron has no group ordering model, so index is accepted but is a
    // no-op. The move event still follows Chrome's event contract.
    this.ctx.router.broadcastEvent('tabGroups.onMoved', this.toChrome(g))
    return this.toChrome(g)
  }

  private removeWindowGroups(windowId: number) {
    for (const group of Array.from(this.groups.values())) {
      if (group.windowId !== windowId) continue
      this.groups.delete(group.id)
      for (const tabId of group.tabIds) {
        if (this.tabToGroup.get(tabId) === group.id) this.tabToGroup.delete(tabId)
      }
      this.fireRemoved(group, true)
    }
  }
}
