import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'

// chrome.tabGroups + the related chrome.tabs.group / chrome.tabs.ungroup.
// TabGroups.{get,query,update,move} are gated on the "tabGroups" permission;
// tabs.group/ungroup are part of the tabs API and registered here (wired into
// the router from index.ts) so they can share this class's in-memory state.
//
// Electron has no native tab-group concept, so groups live in memory per
// session: a Map<groupId, {title,color,collapsed,windowId,tabIds}>. onCreated/
// onUpdated/onRemoved fire on the matching mutations. Collapsed state and tab
// ordering are tracked but not enforced visually (the host UI owns rendering).
interface TabGroup {
  id: string
  windowId: number
  title?: string
  color?: chrome.tabGroups.Color
  collapsed?: boolean
  tabIds: number[]
}

let nextId = 1

export class TabGroupsAPI {
  private groups = new Map<string, TabGroup>()

  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler()
    handle('tabGroups.get', this.get, { permission: 'tabGroups' })
    handle('tabGroups.query', this.query, { permission: 'tabGroups' })
    handle('tabGroups.update', this.update, { permission: 'tabGroups' })
    handle('tabGroups.move', this.move, { permission: 'tabGroups' })
  }

  private toChrome(g: TabGroup): chrome.tabGroups.TabGroup {
    return {
      id: g.id as any,
      collapsed: !!g.collapsed,
      color: (g.color || 'grey') as chrome.tabGroups.Color,
      title: g.title || '',
      windowId: g.windowId,
    }
  }

  private fireUpdated(g: TabGroup) {
    this.ctx.router.broadcastEvent('tabGroups.onUpdated', this.toChrome(g))
  }

  // ---- chrome.tabs.group / tabs.ungroup (no permission gate; tabs API) ----

  group = (
    _event: ExtensionEvent,
    options: { tabIds?: number[]; groupId?: string; createProperties?: any; windowId?: number },
  ): string => {
    const tabIds = (options && options.tabIds) || []
    const windowId = (options && options.windowId) || -2

    if (options && options.groupId) {
      const g = this.groups.get(options.groupId)
      if (g) {
        for (const id of tabIds) {
          if (!g.tabIds.includes(id)) g.tabIds.push(id)
        }
        this.fireUpdated(g)
        return g.id
      }
    }

    const id = `group${nextId++}`
    const cp = (options && options.createProperties) || {}
    const g: TabGroup = {
      id,
      windowId,
      title: cp.title,
      color: cp.color,
      collapsed: !!cp.collapsed,
      tabIds: [...tabIds],
    }
    this.groups.set(id, g)
    this.ctx.router.broadcastEvent('tabGroups.onCreated', this.toChrome(g))
    return id
  }

  ungroup = (_event: ExtensionEvent, options: { tabIds?: number[] }): void => {
    const tabIds = (options && options.tabIds) || []
    for (const [gid, g] of this.groups) {
      g.tabIds = g.tabIds.filter((id) => !tabIds.includes(id))
      if (g.tabIds.length === 0) {
        this.groups.delete(gid)
        this.ctx.router.broadcastEvent('tabGroups.onRemoved', this.toChrome(g))
      } else {
        this.fireUpdated(g)
      }
    }
  }

  // ---- chrome.tabGroups.* ----

  private get = (_event: ExtensionEvent, groupId: string): chrome.tabGroups.TabGroup => {
    const g = this.groups.get(groupId)
    if (!g) throw new Error(`No tab group with id '${groupId}'`)
    return this.toChrome(g)
  }

  private query = (
    _event: ExtensionEvent,
    info: { windowId?: number; title?: string; color?: chrome.tabGroups.Color } = {},
  ): chrome.tabGroups.TabGroup[] => {
    let list = Array.from(this.groups.values())
    if (info.windowId != null) list = list.filter((g) => g.windowId === info.windowId)
    if (info.title != null) list = list.filter((g) => g.title === info.title)
    if (info.color != null) list = list.filter((g) => g.color === info.color)
    return list.map((g) => this.toChrome(g))
  }

  private update = (
    _event: ExtensionEvent,
    groupId: string,
    updateProperties: { title?: string; color?: chrome.tabGroups.Color; collapsed?: boolean },
  ): chrome.tabGroups.TabGroup => {
    const g = this.groups.get(groupId)
    if (!g) throw new Error(`No tab group with id '${groupId}'`)
    if (updateProperties && updateProperties.title !== undefined) g.title = updateProperties.title
    if (updateProperties && updateProperties.color !== undefined) g.color = updateProperties.color
    if (updateProperties && updateProperties.collapsed !== undefined) {
      g.collapsed = updateProperties.collapsed
    }
    this.fireUpdated(g)
    return this.toChrome(g)
  }

  private move = (
    _event: ExtensionEvent,
    groupId: string,
    moveProperties: { windowId?: number; index?: number },
  ): chrome.tabGroups.TabGroup => {
    const g = this.groups.get(groupId)
    if (!g) throw new Error(`No tab group with id '${groupId}'`)
    if (moveProperties && moveProperties.windowId !== undefined) {
      g.windowId = moveProperties.windowId
    }
    this.fireUpdated(g)
    return this.toChrome(g)
  }
}
