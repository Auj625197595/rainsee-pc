import * as React from 'react';

// 按住拖动调整顺序(扩展工具栏图标 / 全部扩展列表共用)。
// 用 mouse 事件而非 HTML5 DnD:工具栏处在窗口拖拽区附近,原生 DnD 会带出拖影和
// 系统光标,且无法精确控制「拖动后不触发 click」。
// 条目通过 attr 属性(值为 id)标识,在容器上捕获 mousedown,无需包装每个条目。
// 拖动中按指针位置实时预览新顺序;松手时回调 onMove(fromId, toId, after)。

interface Options {
  axis: 'x' | 'y';
  // 当前展示顺序的 id 列表。
  ids: string[];
  // 条目元素上存放 id 的属性名,如 data-rainsee-extension-id。
  attr: string;
  onMove: (fromId: string, toId: string, after: boolean) => void;
}

const DRAG_THRESHOLD = 4;

// 拖动结束后吞掉紧随的那次 click,避免松手时打开扩展 popup。
const suppressNextClick = () => {
  const handler = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener('click', handler, true);
  setTimeout(() => window.removeEventListener('click', handler, true), 0);
};

export const useDragReorder = <T extends HTMLElement>({
  axis,
  ids,
  attr,
  onMove,
}: Options) => {
  const containerRef = React.useRef<T>(null);
  const [drag, setDrag] = React.useState<{ id: string; slot: number } | null>(
    null,
  );
  const latest = React.useRef({ ids, onMove });
  latest.current = { ids, onMove };

  const onMouseDown = React.useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const container = containerRef.current;
      const itemEl = (e.target as HTMLElement).closest(
        `[${attr}]`,
      ) as HTMLElement | null;
      if (!container || !itemEl || !container.contains(itemEl)) return;
      const id = itemEl.getAttribute(attr);
      const startIds = latest.current.ids;
      if (!id || !startIds.includes(id) || startIds.length < 2) return;

      const startX = e.clientX;
      const startY = e.clientY;
      // 以拖动开始时的布局为准计算落点,避免实时预览导致位置抖动。
      const others = startIds.filter((x) => x !== id);
      const mids = others.map((otherId) => {
        const el = container.querySelector(
          `[${attr}="${CSS.escape(otherId)}"]`,
        ) as HTMLElement | null;
        if (!el) return Infinity;
        const r = el.getBoundingClientRect();
        return axis === 'x' ? r.left + r.width / 2 : r.top + r.height / 2;
      });
      let started = false;
      let slot = startIds.indexOf(id);

      const onMoveEvt = (ev: MouseEvent) => {
        if (!started) {
          if (
            Math.abs(ev.clientX - startX) < DRAG_THRESHOLD &&
            Math.abs(ev.clientY - startY) < DRAG_THRESHOLD
          ) {
            return;
          }
          started = true;
        }
        const pos = axis === 'x' ? ev.clientX : ev.clientY;
        slot = mids.filter((m) => m < pos).length;
        setDrag((cur) =>
          cur && cur.id === id && cur.slot === slot ? cur : { id, slot },
        );
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMoveEvt, true);
        window.removeEventListener('mouseup', onUp, true);
        if (!started) return;
        suppressNextClick();
        setDrag(null);
        if (others.length === 0) return;
        const origin = startIds.indexOf(id);
        if (slot === origin) return;
        if (slot < others.length) {
          latest.current.onMove(id, others[slot], false);
        } else {
          latest.current.onMove(id, others[others.length - 1], true);
        }
      };

      window.addEventListener('mousemove', onMoveEvt, true);
      window.addEventListener('mouseup', onUp, true);
    },
    [attr, axis],
  );

  // 拖动中的预览顺序。
  const previewIds = React.useMemo(() => {
    if (!drag || !ids.includes(drag.id)) return ids;
    const next = ids.filter((x) => x !== drag.id);
    next.splice(drag.slot, 0, drag.id);
    return next;
  }, [ids, drag]);

  return {
    containerRef,
    onMouseDown,
    draggingId: drag ? drag.id : null,
    previewIds,
  };
};
