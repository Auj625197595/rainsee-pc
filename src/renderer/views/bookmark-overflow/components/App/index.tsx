import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';

import store from '../../store';
import { UIStyle } from '~/renderer/mixins/default-styles';
import { getIconByUrlNet } from '~/utils/url';
import { IBookmark } from '~/interfaces';
import {
  Backdrop,
  Panel,
  Columns,
  Column,
  Row,
  Favicon,
  Title,
  ScrollArrow,
  EmptyHint,
  TransparentBackground,
} from './style';

// 黄色文件夹图标(与书签栏 BookmarkBar/index.tsx 的 FolderIcon 一致)
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

const RowItem = observer(({ b }: { b: IBookmark }) => {
  const [iconFailed, setIconFailed] = React.useState(false);
  const isFolder = !!b.isFolder;
  // 图标解析与书签栏一致:本地 favicon(data/http URL) → 在线图标服务 → 地球兜底
  const faviconSrc =
    !isFolder && !iconFailed
      ? b.favicon || (b.url ? getIconByUrlNet(b.url) : undefined)
      : undefined;

  const handleEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    // 文件夹悬停 → 延迟弹原生单列子菜单(rect 同步取)
    if (isFolder) {
      store.hoverFolder(b._id || '', e.currentTarget.getBoundingClientRect());
    }
  };
  const handleLeave = () => {
    if (isFolder) store.leaveFolder();
  };
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isFolder) {
      // toggle:hover 已弹则点击关闭,未弹则立即弹出
      store.clickFolder(b._id || '', e.currentTarget.getBoundingClientRect());
    } else {
      store.openBookmark(b.url || '');
    }
  };
  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    store.showContextMenu(b);
  };

  return (
    <Row
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
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
            onError={() => setIconFailed(true)}
          />
        ) : (
          <GlobeIcon />
        )}
      </Favicon>
      <Title>{b.title || ''}</Title>
    </Row>
  );
});

export const App = observer(() => {
  // 末列滚动控制:箭头悬停 → raf 自增 scrollTop,移开取消。
  const lastColRef = React.useRef<HTMLDivElement>(null);
  const rafRef = React.useRef<number | null>(null);

  const cancelScroll = React.useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const startScroll = React.useCallback(() => {
    const el = lastColRef.current;
    if (!el) return;
    cancelScroll();
    const tick = () => {
      el.scrollTop += 5;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [cancelScroll]);

  React.useEffect(() => () => cancelScroll(), [cancelScroll]);

  const { items, cols, rowsPerCol, overflow } = store;

  // 切列:前 cols-1 列各取 rowsPerCol 项(满列不滚动);
  // 末列取剩余全部——overflow 时 > rowsPerCol,靠内部滚动 + 底部箭头。
  const columns: IBookmark[][] = [];
  for (let c = 0; c < cols; c++) {
    columns.push(
      c < cols - 1
        ? items.slice(c * rowsPerCol, (c + 1) * rowsPerCol)
        : items.slice(c * rowsPerCol),
    );
  }
  const lastIdx = Math.max(0, columns.length - 1);

  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <UIStyle />
      <TransparentBackground />
      <Backdrop onClick={store.backdropClick}>
        <Panel
          style={{
            left: store.panelX,
            top: store.panelY,
            width: store.panelW,
            height: store.panelH,
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <Columns>
            {columns.map((col, ci) => {
              const isLast = ci === lastIdx;
              const colOverflow = isLast && overflow;
              return (
                <Column
                  key={ci}
                  overflow={colOverflow}
                  ref={isLast ? lastColRef : undefined}
                >
                  {col.length === 0 && isLast && <EmptyHint>(空)</EmptyHint>}
                  {col.map((b) => (
                    <RowItem key={b._id || Math.random()} b={b} />
                  ))}
                  {colOverflow && (
                    <ScrollArrow
                      onMouseEnter={startScroll}
                      onMouseLeave={cancelScroll}
                    >
                      ▼
                    </ScrollArrow>
                  )}
                </Column>
              );
            })}
          </Columns>
        </Panel>
      </Backdrop>
    </ThemeProvider>
  );
});
