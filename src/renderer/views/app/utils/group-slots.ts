// 侧栏(垂直标签栏)分组渲染的「连续块」重排工具。
//
// 背景:store.tabs.list 假定同一分组的成员在列表中连续,但这并非硬不变量——
// 拖拽重排、组内关闭标签、会话恢复、整组钉住/取消,以及分组记录水合竞争
// (tabGroup 对象尚未就绪时 tabGroup 取值为 undefined),都可能把同一组的成员
// 拆成不连续的几段。
//
// 若渲染时仅用一个 lastGroupId 游标「进入新组段即发一个组头」,同一组被拆成
// 几段就会发几个组头;而这些组头又共用 React key `g{gid}`,互相覆盖,表现为
// 「展开/收起复制出几个分组」。折叠/展开本身不改列表,只是触发重渲染,把已经
// 存在的拆分暴露出来。
//
// 修复:不再依赖连续性。本函数把扁平列表重排成「散落标签 + 连续分组块」序列——
// 首次遇到某组时,把该组全部成员聚拢成一个连续块(头 + 成员),整块置于该组
// 首个成员的原始位置;后续再遇到该组成员则跳过(已并入块)。散落/固定标签原位
// 渲染。这样每个组恒为单一连续块,与 Chrome 语义及顶部芯片栏 getSlots() 一致;
// 且仅按稳定的 groupId 数值判定,不依赖 tabGroup 对象是否已水合。
//
// 当列表本就连续时(常态),输出顺序与旧的游标方案完全一致——只在不变量被破坏
// 时才会「愈合」拆分,因此对正常情况零行为影响。

export type GroupSlot<T> =
  | { kind: 'tab'; item: T }
  | { kind: 'group'; groupId: number; items: T[] };

/**
 * 把扁平的、可能非连续的标签列表重排成「散落标签 + 连续分组块」渲染序列。
 *
 * @param items       有序列表(侧栏:ITab[];浮层:IPanelTab[])。调用方应先过滤
 *                    掉关闭中的标签(isClosing)。
 * @param getGroupId  取成员的分组 id;返回 -1 / null / undefined 视为散落标签
 *                    (固定标签也应返回 -1,与顶部 getSlots 一致——固定标签恒为
 *                    独立行,即便误带 tabGroupId 也不并入分组块)。
 */
export function buildGroupSlots<T>(
  items: T[],
  getGroupId: (item: T) => number,
): GroupSlot<T>[] {
  const slots: GroupSlot<T>[] = [];

  // 第一遍:按组收集成员(保持列表序),O(n)。
  const membersByGroup = new Map<number, T[]>();
  for (const item of items) {
    const gid = getGroupId(item);
    if (gid === -1 || gid == null) continue;
    let bucket = membersByGroup.get(gid);
    if (!bucket) {
      bucket = [];
      membersByGroup.set(gid, bucket);
    }
    bucket.push(item);
  }

  // 第二遍:按列表序输出。散落标签原位;每组的块只在其首个成员处整体出现一次。
  const seen = new Set<number>();
  for (const item of items) {
    const gid = getGroupId(item);
    if (gid === -1 || gid == null) {
      slots.push({ kind: 'tab', item });
      continue;
    }
    if (seen.has(gid)) continue; // 该组块已整体发出,跳过后续散落成员
    seen.add(gid);
    slots.push({ kind: 'group', groupId: gid, items: membersByGroup.get(gid)! });
  }

  return slots;
}
