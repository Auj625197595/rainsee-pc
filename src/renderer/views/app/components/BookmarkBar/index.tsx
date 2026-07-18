import { ipcRenderer } from 'electron';
import * as React from 'react';
import anime from 'animejs';
import store from '../../store';
import { observer } from 'mobx-react-lite';
import {
  BookmarkButton,
  BookmarkBar as StyledBookmarkBar,
  BookmarkSection,
  Favicon,
  Title,MibileBookmarkSection, MobileBookmarkIcon
} from './style';
import { ToolbarButton } from '../ToolbarButton';
import {
  ICON_ARROW_RIGHT,
  ICON_ALL
} from '~/renderer/constants/icons';
import { getWebUIURL } from '~/common/webui';
import { getIconByUrlNet } from '~/utils/url';
import { IBookmark } from '~/interfaces';
import { TAB_ANIMATION_DURATION } from '../../constants/tabs';

// 按下后位移超过此距离(px)才进入拖拽——对齐标签栏 mousedown→move 阈值,
// 消除原 350ms 长按死区(此前等待期内移动完全无响应)。纯点击(几乎不动)不触发拖拽,
// click 照常打开书签/进文件夹。
const ARM_THRESHOLD = 4;

// 黄色文件夹图标
const FolderIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="#FBC02D">
    <path d="M3.75 6.75A2.25 2.25 0 0 1 6 4.5h3.38c.6 0 1.17.24 1.59.66l1.12 1.12c.18.18.42.28.67.28H18a2.25 2.25 0 0 1 2.25 2.25v6.53A2.25 2.25 0 0 1 18 17.59H6a2.25 2.25 0 0 1-2.25-2.25V6.75Z" />
  </svg>
);

// 无法解析图标时的默认地球图标
const GlobeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="8.5" stroke="#5F6368" strokeWidth="1.6" />
    <path
      d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.4 3.5 8.5S14.3 18.1 12 20.5C9.7 18.1 8.5 15.1 8.5 12S9.7 5.9 12 3.5Z"
      stroke="#5F6368"
      strokeWidth="1.6"
    />
  </svg>
);


type BookmarkProps = {
  title: string;
  url: string;
  favicon?: string;
  isFolder: boolean;
  id: string;
  dragging: boolean;
  // 拖拽发生过为 true,Bookmark 用它在 click 里抑制误开标签,读后复位。
  dragOccurredRef: React.MutableRefObject<boolean>;
  onPointerDown: (id: string, e: React.PointerEvent<HTMLDivElement>) => void;
};

const Bookmark = observer(
  ({
    title,
    url,
    favicon,
    isFolder,
    id,
    dragging,
    dragOccurredRef,
    onPointerDown,
  }: BookmarkProps) => {
    const { buttonWidth } = store.bookmarksBar;

    // 图标解析(与书签管理器一致):优先本地 favicon(data URL 或 http URL),
    // 缺失时走在线图标服务 getIconByUrlNet(url)。在线图标加载失败则回退地球图标。
    const [iconFailed, setIconFailed] = React.useState(false);
    const faviconSrc =
      !isFolder && !iconFailed
        ? favicon || (url ? getIconByUrlNet(url) : undefined)
        : undefined;

    function onClick(event: any) {
      // 拖拽刚结束:抑制紧随其后的 click,避免松手时误开标签。
      if (dragOccurredRef.current) {
        dragOccurredRef.current = false;
        return;
      }
      if (url) {
        ipcRenderer.send(`add-tab-${store.windowId}`, {
          url,
          active: true,
        });
      } else {
        store.bookmarksBar.showFolderDropdown(event, id);
      }
    }

    function onContextMenu(event: any) {
      store.bookmarksBar.createContextMenu(event, id);
    }

    function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
      // 仅左键触发拖拽;右键留给上下文菜单。
      if (event.button !== 0) return;
      onPointerDown(id, event);
    }

    return (
      <BookmarkButton
        dense
        width={buttonWidth}
        dragging={dragging}
        data-id={id}
        theme={store.theme}
        toggled={false}
        disabled={false}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onPointerDown={handlePointerDown}
      >
        <Favicon>
          {isFolder ? (
            <FolderIcon />
          ) : faviconSrc ? (
            <img
              src={faviconSrc}
              width={16}
              height={16}
              draggable={false}
              style={{ display: 'block' }}
              onError={() => setIconFailed(true)}
            />
          ) : (
            <GlobeIcon />
          )}
        </Favicon>
        <Title>{title}</Title>
      </BookmarkButton>
    );
  },
);

export const BookmarkBar = observer(() => {
  const { bookmarkBarItems: list, showOverflow } = store.bookmarksBar;

  // dragId / order 既有 state(驱动渲染)又有 ref(window 监听闭包内读取最新值,避免 stale)。
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [order, setOrder] = React.useState<string[] | null>(null);
  const dragIdRef = React.useRef<string | null>(null);
  const orderRef = React.useRef<string[] | null>(null);
  const sectionRef = React.useRef<HTMLDivElement>(null);
  const dragOccurredRef = React.useRef(false);
  // 按下点(arm):仅记录起始 id+坐标,位移过阈值后才升级为拖拽。
  const armedRef = React.useRef<{ id: string; x: number; y: number } | null>(
    null,
  );
  // FLIP 快照:重排前各子项的布局坐标(transform 免疫)。
  const firstRectsRef = React.useRef<Map<string, { x: number; y: number }> | null>(
    null,
  );
  // 被拖项跟手:按下点坐标 + 槽位累计位移。被拖项 transform = 光标位移 - slotShift,
  // 这样它实时贴着光标滑动;每次换槽(slotLeft 变化)时把增量并入 slotShift,保持视觉连续不跳。
  const dragStartPointerRef = React.useRef({ x: 0, y: 0 });
  const slotShiftRef = React.useRef({ x: 0, y: 0 });
  // 松手归位动画实例:新一轮拖拽开始前 pause,避免与跟手 anime.set 互相覆盖抖动。
  const dropAnimRef = React.useRef<ReturnType<typeof anime> | null>(null);

  const setDragIdBoth = React.useCallback((v: string | null) => {
    dragIdRef.current = v;
    setDragId(v);
  }, []);
  const setOrderBoth = React.useCallback((v: string[] | null) => {
    orderRef.current = v;
    setOrder(v);
  }, []);

  // 当前被拖项 DOM(React 按 key 移动节点而非重建,故每次按 data-id 取最新引用)。
  const getDraggedEl = React.useCallback((): HTMLElement | null => {
    const id = dragIdRef.current;
    const section = sectionRef.current;
    if (!id || !section) return null;
    const el = Array.from(section.children).find(
      (c) => (c as HTMLElement).dataset.id === id,
    ) as HTMLElement | undefined;
    return el ?? null;
  }, []);

  // 被拖项即时跟手(anime.set 无动画,对齐标签栏 animation:false)。仅水平跟随:
  // 书签栏单行为主,纵向跟随会被 section 的 overflow:hidden 裁切,且换行由命中重排处理。
  const applyDraggedTransform = React.useCallback(
    (clientX: number) => {
      const el = getDraggedEl();
      if (!el) return;
      const tx = clientX - dragStartPointerRef.current.x - slotShiftRef.current.x;
      anime.set(el, { translateX: tx });
    },
    [getDraggedEl],
  );

  // 重排前快照各子项布局坐标。用 offsetLeft/offsetTop(忽略 CSS transform),
  // 这样即使上一轮 FLIP 动画仍在进行,旧位采样也不会被 transform 污染、不会漂移。
  const snapshotFirst = React.useCallback(() => {
    const section = sectionRef.current;
    if (!section) {
      firstRectsRef.current = null;
      return;
    }
    const m = new Map<string, { x: number; y: number }>();
    Array.from(section.children).forEach((child) => {
      const el = child as HTMLElement;
      const elId = el.dataset.id;
      if (elId) m.set(elId, { x: el.offsetLeft, y: el.offsetTop });
    });
    firstRectsRef.current = m;
  }, []);

  // FLIP Play:order 变更提交后立即跑(useLayoutEffect 在浏览器绘制前同步执行)。
  // 被拖项跳过(它由 applyDraggedTransform 单独跟手管理);其余项从旧位反演 transform
  // 后用 easeOutCirc 滑动归零——与标签栏同时长、同缓动。
  React.useLayoutEffect(() => {
    const first = firstRectsRef.current;
    const curDragId = dragIdRef.current;
    if (!first) return; // 无快照(首次锁定/收尾渲染),不动画
    firstRectsRef.current = null;
    const section = sectionRef.current;
    if (!section) return;
    Array.from(section.children).forEach((child) => {
      const el = child as HTMLElement;
      const elId = el.dataset.id;
      if (!elId) return;
      const oldPos = first.get(elId);
      if (!oldPos) return;
      const dx = oldPos.x - el.offsetLeft;
      const dy = oldPos.y - el.offsetTop;
      if (dx === 0 && dy === 0) return;
      if (elId === curDragId) return; // 被拖项不 FLIP
      anime.set(el, { translateX: dx, translateY: dy });
      anime({
        targets: el,
        translateX: 0,
        translateY: 0,
        duration: TAB_ANIMATION_DURATION,
        easing: 'easeOutCirc',
      });
    });
  }, [order]);

  const onWinPointerMove = React.useCallback(
    (e: PointerEvent) => {
      // 1) 位移阈值判定进入拖拽(对齐标签栏:按下后移动足够才升级,纯点击不触发)
      const armed = armedRef.current;
      if (armed && !dragIdRef.current) {
        const dx = e.clientX - armed.x;
        const dy = e.clientY - armed.y;
        if (dx * dx + dy * dy < ARM_THRESHOLD * ARM_THRESHOLD) return;
        dragOccurredRef.current = true;
        dragStartPointerRef.current = { x: armed.x, y: armed.y };
        slotShiftRef.current = { x: 0, y: 0 };
        if (dropAnimRef.current) {
          // 中断上一次松手归位动画,避免与跟手 set 互相覆盖。
          dropAnimRef.current.pause();
          dropAnimRef.current = null;
        }
        const ids = store.bookmarksBar.bookmarkBarItems.map((b) => b._id);
        setOrderBoth(ids);
        setDragIdBoth(armed.id);
      }

      const id = dragIdRef.current;
      if (!id) return;
      const section = sectionRef.current;
      if (!section) return;
      const cur = orderRef.current;
      if (!cur) return;

      // 2) 被拖项实时跟手(即便不换槽也跟随光标,这是手感的关键)
      applyDraggedTransform(e.clientX);

      // 3) 命中并重排
      const others = Array.from(section.children).filter(
        (n) => (n as HTMLElement).dataset.id !== id,
      ) as HTMLElement[];
      // 命中:指针在某项所在行上方,或同行且偏左 → 应插到该项之前。
      // 单行退化为纯"偏左即插前",多行按行正确处理(修复原逻辑"中点下方一律跳末尾")。
      let to = others.length;
      for (let i = 0; i < others.length; i++) {
        const r = others[i].getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const beforeRow = e.clientY < r.top;
        const sameRowBefore =
          e.clientY >= r.top && e.clientY <= r.bottom && e.clientX < cx;
        if (beforeRow || sameRowBefore) {
          to = i;
          break;
        }
      }

      const from = cur.indexOf(id);
      if (from === -1) return;
      const next = cur.slice();
      next.splice(from, 1);
      next.splice(Math.min(to, next.length), 0, id);
      if (next.join(' ') === cur.join(' ')) return; // 顺序未变(仅跟手位移)

      // 4) 换槽:记录被拖项旧槽位 → 快照邻居 → 重排 → 把槽位增量并入 slotShift → 重校跟手 transform
      const draggedEl = getDraggedEl();
      const oldX = draggedEl ? draggedEl.offsetLeft : 0;
      snapshotFirst(); // 邻居旧位(布局坐标)
      setOrderBoth(next); // React17 同步 → DOM 已重排
      if (draggedEl) {
        slotShiftRef.current.x += draggedEl.offsetLeft - oldX;
      }
      applyDraggedTransform(e.clientX); // 用更新后的 slotShift 重校,保持视觉连续
    },
    [applyDraggedTransform, getDraggedEl, setDragIdBoth, setOrderBoth, snapshotFirst],
  );

  const onWinPointerUp = React.useCallback(() => {
    armedRef.current = null;

    window.removeEventListener('pointermove', onWinPointerMove);
    window.removeEventListener('pointerup', onWinPointerUp);
    window.removeEventListener('pointercancel', onWinPointerUp);

    const finalOrder = orderRef.current;
    const hadDrag = dragOccurredRef.current;
    const id = dragIdRef.current;

    // 被拖项从跟手位置 easeOutCirc 滑回最终槽位(对齐标签栏 mouseup 后 updateTabsBounds(true))。
    if (id) {
      const el = getDraggedEl();
      if (el) {
        dropAnimRef.current = anime({
          targets: el,
          translateX: 0,
          duration: TAB_ANIMATION_DURATION,
          easing: 'easeOutCirc',
        });
      }
    }

    setDragIdBoth(null);

    if (hadDrag && finalOrder && finalOrder.length > 1) {
      const storeIds = store.bookmarksBar.bookmarkBarItems.map((b) => b._id);
      if (finalOrder.join(' ') !== storeIds.join(' ')) {
        // 顺序确实改变:提交。保留本地 order,防止 store 重载前回退闪烁——
        // anti-flicker effect 会在 store 重载后顺序一致时清掉 order。
        store.bookmarksBar.reorder(finalOrder);
        return;
      }
    }
    // 未拖拽 / 净未变 / 单项:立即清本地 order。
    setOrderBoth(null);
  }, [getDraggedEl, onWinPointerMove, setDragIdBoth, setOrderBoth]);

  const onItemPointerDown = React.useCallback(
    (id: string, e: React.PointerEvent<HTMLDivElement>) => {
      dragOccurredRef.current = false;
      armedRef.current = { id, x: e.clientX, y: e.clientY };
      window.addEventListener('pointermove', onWinPointerMove);
      window.addEventListener('pointerup', onWinPointerUp);
      window.addEventListener('pointercancel', onWinPointerUp);
    },
    [onWinPointerMove, onWinPointerUp],
  );

  // 卸载清理:避免监听残留。
  React.useEffect(
    () => () => {
      armedRef.current = null;
      window.removeEventListener('pointermove', onWinPointerMove);
      window.removeEventListener('pointerup', onWinPointerUp);
      window.removeEventListener('pointercancel', onWinPointerUp);
    },
    [onWinPointerMove, onWinPointerUp],
  );

  // 书签栏可见性或行数变化时(含设置页跨窗口改行数触发的 update-settings 广播、
  // 以及刚开启书签栏 section 挂载后),用 section 实测宽度重新拆分可见项/溢出项。
  React.useEffect(() => {
    store.bookmarksBar.setBookmarkBarItems();
  }, [store.settings.object.bookmarksBar, store.settings.object.bookmarksBarRows]);

  // 修正估算拆分的裁切:setBookmarkBarItems 按字符数估算按钮宽度,中文/宽字符标题
  // 实际更宽,估算偏乐观会把 CSS 装不下的项也塞进 bookmarkBarItems——它们被
  // BookmarkSection 的 overflow:hidden + max-height 裁切,既不可见、又不在溢出菜单,
  // 表现为"书签栏最后一个可见项"与"溢出菜单第一项"之间缺失若干。这里在渲染后实测
  // 各按钮 offsetTop,把超出可见行的尾部项下沉到 overflowItems(经 refitOverflow),
  // 使两者首尾相接。useLayoutEffect 在绘制前同步执行,无闪烁。
  const measuredRows = store.settings.object.bookmarksBarRows || 1;
  React.useLayoutEffect(() => {
    if (dragId) return; // 拖拽中不修正,避免干扰排序
    const section = sectionRef.current;
    if (!section) return;
    // 与 BookmarkSection 的 CSS max-height 一致:行高 26px(dense) + 行间 gap 4px
    const maxH = measuredRows * 26 + (measuredRows - 1) * 4;
    const children = Array.from(section.children) as HTMLElement[];
    // 第一个 offsetTop 越过可见区域的按钮 = 被裁切的开始;之前的都可见
    let splitIdx = children.length;
    for (let i = 0; i < children.length; i++) {
      if (children[i].offsetTop >= maxH) {
        splitIdx = i;
        break;
      }
    }
    if (splitIdx < children.length) {
      store.bookmarksBar.refitOverflow(splitIdx);
    }
  }, [list, measuredRows, dragId, order]);

  // 防回退闪烁:提交后保留本地 order,等 store 重载到提交顺序后安全切回 list 渲染。
  // - 顺序完全一致 → 切回(无视觉变化)。
  // - 可见项集合变了(增删致本地顺序过期)→ 切回。
  // - 同集合但顺序仍不同(store 尚未重载完成)→ 继续等待。
  React.useEffect(() => {
    const local = orderRef.current;
    if (!local) return;
    const cur = store.bookmarksBar.bookmarkBarItems.map((b) => b._id);
    const sameOrder = cur.join(' ') === local.join(' ');
    const setChanged =
      cur.slice().sort().join(' ') !== local.slice().sort().join(' ');
    if (sameOrder || setChanged) {
      setOrderBoth(null);
    }
  }, [store.bookmarksBar.bookmarkBarItems, setOrderBoth]);

  // 渲染顺序:拖拽中用本地 order,否则用 store 顺序。
  const items: IBookmark[] = order
    ? (order
        .map((id) => list.find((b) => b._id === id))
        .filter(Boolean) as IBookmark[])
    : list;

  // 书签栏没有任何可显示的书签(可见项与溢出项都为空)时整行隐藏,
  // 避免空占位行挤占页面空间。hasBookmarks 仅在书签栏顶层(main 文件夹)有内容时为真。
  const hasBookmarks =
    list.length > 0 || store.bookmarksBar.overflowItems.length > 0;

  return store.settings.object.bookmarksBar && hasBookmarks ? (
    <StyledBookmarkBar>
      <BookmarkSection
        ref={sectionRef}
        rows={store.settings.object.bookmarksBarRows || 1}
        dragging={!!dragId}
        data-bookmark-section
      >
        {items.map(({ title, url, favicon, _id, isFolder }: IBookmark) => (
          <Bookmark
            key={_id}
            id={_id}
            title={title}
            url={url}
            favicon={favicon}
            isFolder={isFolder}
            dragging={dragId === _id}
            dragOccurredRef={dragOccurredRef}
            onPointerDown={onItemPointerDown}
          />
        ))}
      </BookmarkSection>
      {store.bookmarksBar.overflowItems.length > 0 && (
        <ToolbarButton
          icon={ICON_ARROW_RIGHT}
          onClick={showOverflow}
          onMouseEnter={store.bookmarksBar.preloadOverflow}
        />
      )}
      <MibileBookmarkSection
        onClick={() => {
          ipcRenderer.send(`add-tab-${store.windowId}`, {
            url: getWebUIURL('bookmarks'),
            active: true,
          });
        }}
      >
        <MobileBookmarkIcon src={ICON_ALL} alt="" draggable={false} />
        <div>全部</div>
      </MibileBookmarkSection>
    </StyledBookmarkBar>
  ) : null;
});
