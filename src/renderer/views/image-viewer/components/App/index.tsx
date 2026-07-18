import * as React from 'react';
import {observer} from 'mobx-react-lite';
import {
  SquaresFourIcon,
  ListIcon,
  CheckIcon,
  MinusIcon,
  DownloadSimpleIcon,
  PackageIcon,
  XIcon,
  CaretLeftIcon,
  CaretRightIcon,
  ImageIcon,
  BookOpenIcon,
} from '@phosphor-icons/react';

import store, {ImageItem} from '../../store';
import {
  StyledApp,
  Header,
  HeaderLeft,
  Title,
  Count,
  Spacer,
  ViewSwitcher,
  ViewBtn,
  ToolbarRight,
  SelectAllLabel,
  Checkbox,
  ToolbarBtn,
  Content,
  Grid,
  GridCard,
  CardImg,
  CardOverlay,
  CardType,
  CardCheckbox,
  ListRow,
  ListThumb,
  ListInfo,
  ListAlt,
  ListUrl,
  ListMeta,
  Strip,
  StripItem,
  StripImg,
  Lightbox,
  LightboxImg,
  LightboxArrow,
  LightboxBtn,
  LightboxCounter,
  CenterState,
  Spinner,
  Toast,
  ZipMask,
  ZipDialog,
  ZipTitle,
  ZipBarTrack,
  ZipBarFill,
  ZipProgressText,
} from './style';

const formatSize = (w: number, h: number): string => {
  if (w && h) return `${w} × ${h}`;
  if (w || h) return `${w || h}px`;
  return '';
};

const shortUrl = (url: string): string => {
  try {
    const u = new URL(url);
    return (u.pathname + u.search).slice(0, 80) || u.host;
  } catch {
    return url.slice(0, 80);
  }
};

const zipPct = () => {
  if (!store.zipTotal) return 0;
  return Math.min(100, Math.round((store.zipDone / store.zipTotal) * 100));
};

// ── 加载失败占位 ──
const FailedBox: React.FC<{size?: number}> = ({size = 38}) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#3a3a42',
    }}
  >
    <ImageIcon size={size} weight="duotone" />
  </div>
);

// ── grid 卡片 ──
const GridItem = observer(({item, idx}: {item: ImageItem; idx: number}) => {
  const [hover, setHover] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const selected = store.selected.has(item.url);
  return (
    <GridCard
      $selected={selected}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => store.openPreview(idx)}
    >
      {failed ? (
        <FailedBox />
      ) : (
        <CardImg
          src={item.url}
          referrerPolicy="no-referrer"
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
        />
      )}
      <CardCheckbox
        $checked={selected}
        $visible={hover}
        onClick={(e) => {
          e.stopPropagation();
          store.toggleSelect(item.url);
        }}
      >
        {selected && <CheckIcon weight="bold" />}
      </CardCheckbox>
      <CardOverlay>
        <span>{formatSize(item.width, item.height)}</span>
        <CardType>{item.type}</CardType>
      </CardOverlay>
    </GridCard>
  );
});

// ── list 行 ──
const ListLine = observer(({item, idx}: {item: ImageItem; idx: number}) => {
  const [failed, setFailed] = React.useState(false);
  const selected = store.selected.has(item.url);
  return (
    <ListRow $selected={selected} onClick={() => store.toggleSelect(item.url)}>
      <Checkbox
        $checked={selected}
        $size={18}
        onClick={(e) => {
          e.stopPropagation();
          store.toggleSelect(item.url);
        }}
      >
        {selected && <CheckIcon weight="bold" />}
      </Checkbox>
      <ListThumb
        onClick={(e) => {
          e.stopPropagation();
          store.openPreview(idx);
        }}
      >
        {failed ? (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#3a3a42',
            }}
          >
            <ImageIcon size={22} />
          </div>
        ) : (
          <img
            src={item.url}
            referrerPolicy="no-referrer"
            loading="lazy"
            onError={() => setFailed(true)}
          />
        )}
      </ListThumb>
      <ListInfo>
        <ListAlt>{item.alt || item.type || '图片'}</ListAlt>
        <ListUrl>{shortUrl(item.url)}</ListUrl>
      </ListInfo>
      <ListMeta>
        {formatSize(item.width, item.height)} · {item.type}
      </ListMeta>
      <ToolbarBtn
        onClick={(e) => {
          e.stopPropagation();
          store.downloadOne(item);
        }}
        title="下载"
      >
        <DownloadSimpleIcon />
      </ToolbarBtn>
    </ListRow>
  );
});

// ── strip(平铺/漫画)行:垂直连续大图 ──
const StripLine = observer(({item, idx}: {item: ImageItem; idx: number}) => {
  const [hover, setHover] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const selected = store.selected.has(item.url);
  return (
    <StripItem
      $selected={selected}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {failed ? (
        <div
          style={{
            height: 220,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#3a3a42',
          }}
        >
          <ImageIcon size={48} weight="duotone" />
        </div>
      ) : (
        <StripImg
          src={item.url}
          referrerPolicy="no-referrer"
          loading="lazy"
          draggable={false}
          onClick={() => store.openPreview(idx)}
          onError={() => setFailed(true)}
        />
      )}
      <CardCheckbox
        $checked={selected}
        $visible={hover}
        onClick={(e) => {
          e.stopPropagation();
          store.toggleSelect(item.url);
        }}
      >
        {selected && <CheckIcon weight="bold" />}
      </CardCheckbox>
    </StripItem>
  );
});

// ── 大图预览 ──
const LightboxView = observer(() => {
  const item = store.previewItem;
  const [view, setView] = React.useState({scale: 1, x: 0, y: 0});
  const [dragging, setDragging] = React.useState(false);
  const dragStart = React.useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    x: number;
    y: number;
  } | null>(null);

  React.useEffect(() => {
    setView({scale: 1, x: 0, y: 0});
    setDragging(false);
    dragStart.current = null;
  }, [item && item.url]);

  if (!item) return null;
  const idx = store.previewIndex;

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    const cursorX = event.clientX - (bounds.left + bounds.width / 2);
    const cursorY = event.clientY - (bounds.top + bounds.height / 2);
    const factor = Math.exp(-event.deltaY * 0.0015);

    setView((previous) => {
      const scale = Math.min(8, Math.max(0.25, previous.scale * factor));
      const ratio = scale / previous.scale;
      return {
        scale,
        x: cursorX - (cursorX - previous.x) * ratio,
        y: cursorY - (cursorY - previous.y) * ratio,
      };
    });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLImageElement>) => {
    event.stopPropagation();
    if (view.scale <= 1) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      x: view.x,
      y: view.y,
    };
    setDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLImageElement>) => {
    const start = dragStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.stopPropagation();
    setView((previous) => ({
      ...previous,
      x: start.x + event.clientX - start.clientX,
      y: start.y + event.clientY - start.clientY,
    }));
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLImageElement>) => {
    if (dragStart.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    dragStart.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <Lightbox onClick={() => store.closePreview()} onWheel={handleWheel}>
      <LightboxBtn
        style={{right: 24}}
        onClick={(e) => {
          e.stopPropagation();
          store.closePreview();
        }}
        title="关闭"
      >
        <XIcon />
      </LightboxBtn>
      {idx > 0 && (
        <LightboxArrow
          $left
          onClick={(e) => {
            e.stopPropagation();
            store.previewPrev();
          }}
        >
          <CaretLeftIcon weight="bold" />
        </LightboxArrow>
      )}
      <LightboxImg
        src={item.url}
        referrerPolicy="no-referrer"
        draggable={false}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          cursor: view.scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in',
          transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
        }}
      />
      {idx < store.images.length - 1 && (
        <LightboxArrow
          onClick={(e) => {
            e.stopPropagation();
            store.previewNext();
          }}
        >
          <CaretRightIcon weight="bold" />
        </LightboxArrow>
      )}
      <LightboxCounter>
        {idx + 1} / {store.images.length} · {Math.round(view.scale * 100)}%
      </LightboxCounter>
    </Lightbox>
  );
});

export const App = observer(() => {
  // lightbox 键盘:Esc 关闭、←/→ 切换。
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (store.previewIndex < 0) return;
      if (e.key === 'Escape') store.closePreview();
      else if (e.key === 'ArrowLeft') store.previewPrev();
      else if (e.key === 'ArrowRight') store.previewNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const none = store.selectedCount === 0;
  const indeterminate =
    store.selectedCount > 0 && !store.allSelected;

  return (
    <StyledApp>
      <Header>
        <HeaderLeft>
          <Title>看图模式</Title>
          <Count>共 {store.count} 张{store.selectedCount > 0 ? ` · 已选 ${store.selectedCount}` : ''}</Count>
        </HeaderLeft>

        <Spacer />

        <ViewSwitcher>
          <ViewBtn
            $active={store.viewMode === 'grid'}
            onClick={() => store.setView('grid')}
            title="网格视图"
          >
            <SquaresFourIcon size={18} weight="fill" />
          </ViewBtn>
          <ViewBtn
            $active={store.viewMode === 'list'}
            onClick={() => store.setView('list')}
            title="列表视图"
          >
            <ListIcon size={18} weight="fill" />
          </ViewBtn>
          <ViewBtn
            $active={store.viewMode === 'strip'}
            onClick={() => store.setView('strip')}
            title="平铺模式(漫画)"
          >
            <BookOpenIcon size={18} weight="fill" />
          </ViewBtn>
        </ViewSwitcher>

        <SelectAllLabel onClick={() => store.toggleSelectAll()}>
          <Checkbox $checked={store.allSelected} $indeterminate={indeterminate}>
            {store.allSelected ? (
              <CheckIcon weight="bold" />
            ) : indeterminate ? (
              <MinusIcon weight="bold" />
            ) : null}
          </Checkbox>
          全选
        </SelectAllLabel>

        <ToolbarRight>
          <ToolbarBtn
            $disabled={none}
            onClick={() => !none && store.downloadSelected()}
            title="逐张下载到下载面板"
          >
            <DownloadSimpleIcon />
            下载选中{store.selectedCount > 0 ? ` (${store.selectedCount})` : ''}
          </ToolbarBtn>
          <ToolbarBtn
            $primary
            $disabled={none}
            onClick={() => !none && store.downloadZip()}
            title="打包为 ZIP"
          >
            <PackageIcon />
            打包 ZIP{store.selectedCount > 0 ? ` (${store.selectedCount})` : ''}
          </ToolbarBtn>
        </ToolbarRight>
      </Header>

      <Content>
        {store.viewMode === 'grid' ? (
          <Grid>
            {store.images.map((item, idx) => (
              <GridItem key={item.url + idx} item={item} idx={idx} />
            ))}
          </Grid>
        ) : store.viewMode === 'list' ? (
          <div>
            {store.images.map((item, idx) => (
              <ListLine key={item.url + idx} item={item} idx={idx} />
            ))}
          </div>
        ) : (
          <Strip>
            {store.images.map((item, idx) => (
              <StripLine key={item.url + idx} item={item} idx={idx} />
            ))}
          </Strip>
        )}
      </Content>

      {store.previewIndex >= 0 && <LightboxView />}

      {store.toast && <Toast>{store.toast}</Toast>}

      {store.zipping && (
        <ZipMask>
          <ZipDialog>
            <ZipTitle>
              <PackageIcon />
              正在打包下载
            </ZipTitle>
            <ZipBarTrack>
              <ZipBarFill $pct={zipPct()} />
            </ZipBarTrack>
            <ZipProgressText>
              {store.zipDone} / {store.zipTotal}
            </ZipProgressText>
          </ZipDialog>
        </ZipMask>
      )}

      {store.loading && (
        <CenterState>
          <Spinner />
          <div>正在收集图片…</div>
        </CenterState>
      )}

      {!store.loading && store.error && (
        <CenterState>
          <ImageIcon size={56} />
          <div>未找到图片</div>
        </CenterState>
      )}
    </StyledApp>
  );
});
