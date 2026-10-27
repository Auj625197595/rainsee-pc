// 扩展统一排序(settings.extensionOrder):地址栏钉住图标与「全部扩展」列表共用一套顺序。
// 列表展示完整顺序;地址栏只展示其中已钉住的子集,子集内相对顺序与完整顺序一致。

// 按 order 排序;order 中没有的 id 保持原相对顺序排在末尾。
export const sortByExtensionOrder = <T>(
  items: T[],
  order: string[] | undefined,
  getId: (item: T) => string,
): T[] => {
  const index = new Map<string, number>();
  (order || []).forEach((id, i) => index.set(id, i));
  return items
    .map((item, i) => ({ item, i, o: index.get(getId(item)) }))
    .sort((a, b) => {
      if (a.o !== undefined && b.o !== undefined) return a.o - b.o;
      if (a.o !== undefined) return -1;
      if (b.o !== undefined) return 1;
      return a.i - b.i;
    })
    .map((x) => x.item);
};

// 把 fromId 移到 toId 前(after=false)或后(after=true),返回新的完整顺序。
// knownIds 为当前视图中按现有顺序展示的 id;未在 order 里的会先补到末尾,
// 保证视图里看到的顺序就是落盘的顺序。视图外的 id(如已停用的扩展)保留原位。
export const moveInExtensionOrder = (
  order: string[] | undefined,
  knownIds: string[],
  fromId: string,
  toId: string,
  after: boolean,
): string[] => {
  const base = [...(order || [])];
  const seen = new Set(base);
  for (const id of knownIds) {
    if (!seen.has(id)) {
      base.push(id);
      seen.add(id);
    }
  }
  if (fromId === toId || !seen.has(fromId) || !seen.has(toId)) return base;
  const next = base.filter((id) => id !== fromId);
  const target = next.indexOf(toId);
  next.splice(after ? target + 1 : target, 0, fromId);
  return next;
};
