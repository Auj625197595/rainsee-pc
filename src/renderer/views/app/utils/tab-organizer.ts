import { ipcRenderer } from 'electron';
import { getDomain } from 'tldts';

import store from '../store';
import { ITab, ITabGroup } from '../models';

interface AiGroupSuggestion {
  existingGroupId?: number | null;
  name?: string;
  positions?: number[];
}

interface AiGroupResponse {
  groups?: AiGroupSuggestion[];
  degraded?: boolean;
}

export interface OrganizeResult {
  tabs: number;
  groups: number;
}

const normalizeGroupName = (name: string) =>
  (name || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();

const getTabDomain = (tab: ITab): string => {
  try {
    const url = new URL(tab.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return (
      getDomain(url.hostname, { allowPrivateDomains: true }) || url.hostname
    ).toLocaleLowerCase();
  } catch {
    return '';
  }
};

const getDuplicateKey = (tab: ITab): string => {
  if (!tab.url) return '';
  try {
    return new URL(tab.url).href;
  } catch {
    return tab.url.trim();
  }
};

const findNamedGroup = (name: string): ITabGroup | undefined => {
  const normalized = normalizeGroupName(name);
  if (!normalized) return undefined;
  return store.tabGroups.list.find(
    (group) => normalizeGroupName(group.name) === normalized,
  );
};

const createNamedGroup = (name: string): ITabGroup => {
  const group = store.tabGroups.addGroup();
  store.tabGroups.rename(group.id, name);
  return group;
};

export const deduplicateTabs = (): OrganizeResult => {
  const tabs = store.tabs.list.filter((tab) => !tab.isClosing);
  const byUrl = new Map<string, ITab[]>();

  tabs.forEach((tab) => {
    const key = getDuplicateKey(tab);
    if (!key) return;
    const matches = byUrl.get(key) || [];
    matches.push(tab);
    byUrl.set(key, matches);
  });

  const duplicates: ITab[] = [];
  byUrl.forEach((matches) => {
    if (matches.length < 2) return;
    const keeper =
      matches.find((tab) => tab.id === store.tabs.selectedTabId) ||
      matches.find((tab) => tab.isPinned) ||
      matches[0];
    matches.forEach((tab) => {
      if (tab !== keeper) duplicates.push(tab);
    });
  });

  duplicates.forEach((tab) => tab.close());
  return { tabs: duplicates.length, groups: 0 };
};

export const groupTabsByDomain = (): OrganizeResult => {
  const buckets = new Map<string, ITab[]>();
  store.tabs.list.forEach((tab) => {
    if (tab.isClosing || tab.isPinned || tab.tabGroupId !== -1) return;
    const domain = getTabDomain(tab);
    if (!domain) return;
    const matches = buckets.get(domain) || [];
    matches.push(tab);
    buckets.set(domain, matches);
  });

  let groupedTabs = 0;
  let createdGroups = 0;
  buckets.forEach((tabs, domain) => {
    let group = findNamedGroup(domain);
    if (!group) {
      group = store.tabGroups.list.find((candidate) => {
        const members = candidate.tabs.filter((tab) => !tab.isClosing);
        return (
          members.length > 0 &&
          members.every((tab) => getTabDomain(tab) === domain)
        );
      });
    }

    // 单个散落标签只有在能并入现有分组时才处理，避免制造无意义的单标签组。
    if (!group && tabs.length < 2) return;
    if (!group) {
      group = createNamedGroup(domain);
      createdGroups += 1;
    }

    tabs.forEach((tab) => {
      store.tabs.setTabToGroup(tab, group.id);
      groupedTabs += 1;
    });
  });

  return { tabs: groupedTabs, groups: createdGroups };
};

let activeAiGrouping: Promise<OrganizeResult> | null = null;

const requestAiGrouping = async (): Promise<OrganizeResult> => {
  const tabs = store.tabs.list.filter((tab) => !tab.isClosing);
  const tabByPosition = new Map<number, ITab>();
  tabs.forEach((tab, index) => tabByPosition.set(index + 1, tab));

  const candidateCount = tabs.filter(
    (tab) => !tab.isPinned && tab.tabGroupId === -1,
  ).length;
  if (candidateCount === 0) return { tabs: 0, groups: 0 };

  const response = (await ipcRenderer.invoke('tab-organizer-ai-group', {
    tabs: tabs.map((tab, index) => ({
      position: index + 1,
      title: tab.title,
      url: tab.url,
      groupId: tab.tabGroupId,
      pinned: tab.isPinned,
    })),
    groups: store.tabGroups.list
      .filter((group) => group.tabs.some((tab) => !tab.isClosing))
      .map((group) => ({
        id: group.id,
        name: group.name,
        tabs: group.tabs
          .filter((tab) => !tab.isClosing)
          .map((tab) => tabs.indexOf(tab) + 1)
          .filter((position) => position > 0),
      })),
  })) as AiGroupResponse;

  if (response?.degraded) {
    throw new Error('AI_GROUPING_UNAVAILABLE');
  }

  const suggestions = Array.isArray(response?.groups) ? response.groups : [];
  const usedPositions = new Set<number>();
  const existingIds = new Set(store.tabGroups.list.map((group) => group.id));
  let groupedTabs = 0;
  let createdGroups = 0;

  suggestions.forEach((suggestion) => {
    const positions = Array.isArray(suggestion.positions)
      ? suggestion.positions
      : [];
    const candidates = positions
      .map((position) => ({
        position: Number(position),
        tab: tabByPosition.get(Number(position)),
      }))
      .filter(
        (item): item is { position: number; tab: ITab } =>
          !!item.tab &&
          !usedPositions.has(item.position) &&
          store.tabs.list.includes(item.tab) &&
          !item.tab.isClosing &&
          !item.tab.isPinned &&
          item.tab.tabGroupId === -1,
      )
      .filter(
        (item, index, list) =>
          list.findIndex(
            (candidate) => candidate.position === item.position,
          ) === index,
      );

    const rawRequestedId = suggestion.existingGroupId as any;
    const requestedId =
      rawRequestedId == null || rawRequestedId === ''
        ? NaN
        : Number(rawRequestedId);
    let group =
      Number.isInteger(requestedId) && existingIds.has(requestedId)
        ? store.tabGroups.getGroupById(requestedId)
        : undefined;

    if (!group) group = findNamedGroup(suggestion.name || '');
    if (!group && candidates.length < 2) return;

    if (!group) {
      const name = (suggestion.name || '').replace(/\s+/g, ' ').trim();
      if (!name) return;
      group = createNamedGroup(name.slice(0, 20));
      existingIds.add(group.id);
      createdGroups += 1;
    }

    candidates.forEach(({ position, tab }) => {
      usedPositions.add(position);
      store.tabs.setTabToGroup(tab, group.id);
      groupedTabs += 1;
    });
  });

  return { tabs: groupedTabs, groups: createdGroups };
};

export const groupTabsWithAi = (): Promise<OrganizeResult> => {
  if (activeAiGrouping) return activeAiGrouping;
  activeAiGrouping = requestAiGrouping().finally(() => {
    activeAiGrouping = null;
  });
  return activeAiGrouping;
};
