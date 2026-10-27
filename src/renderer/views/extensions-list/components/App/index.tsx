import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';
import { PushPin, PushPinSlash, SlidersHorizontal, GearSix } from '@phosphor-icons/react';

import {
  StyledApp,
  Header,
  List,
  Empty,
  Item,
  ItemIcon,
  ItemName,
  PinButton,
  OptionsButton,
  FooterDivider,
  Footer,
  FooterItem,
} from './style';
import store from '../../store';
import { UIStyle } from '~/renderer/mixins/default-styles';
import { IExtItem } from '~/interfaces';
import { useI18n } from '~/renderer/components/I18n';
import { useDragReorder } from '~/renderer/utils/use-drag-reorder';

const onPinClick = (ext: IExtItem) => (e: React.MouseEvent) => {
  e.stopPropagation();
  store.togglePin(ext.id);
};

// 点击「设置」:跳转该扩展的选项页(options_page / options_ui),并关闭列表弹窗。
// stopPropagation 避免触发行级的 openExtensionAction(popup / onClicked)。
const onOptionsClick = (ext: IExtItem) => (e: React.MouseEvent) => {
  e.stopPropagation();
  store.openOptions(ext);
};

const onItemClick = (ext: IExtItem) => () => {
  store.openExtensionAction(ext);
};

const onManageClick = () => {
  store.openManager();
};

export const App = observer(() => {
  const t = useI18n();
  const extensions = store.sortedExtensions;
  const rootRef = React.useRef<HTMLDivElement>(null);
  // 按住行上下拖动调整顺序;与地址栏图标共用 extensionOrder。
  const reorder = useDragReorder<HTMLDivElement>({
    axis: 'y',
    ids: extensions.map((x) => x.id),
    attr: 'data-ext-id',
    onMove: (from, to, after) => store.moveExtension(from, to, after),
  });

  // 内容高度自适应:测量后上报给主进程重排弹窗高度。
  React.useEffect(() => {
    if (!rootRef.current) return undefined;
    const report = () => {
      // StyledApp 自身 margin 为 3px(顶) + 16px(底);另强制 +80 修正列表高度异常。
      const h = Math.ceil(rootRef.current.scrollHeight) + 20 + 80;
      store.send('resize-dialog', h);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, [extensions.length]);

  return (
    <ThemeProvider
      theme={{ ...store.theme, dark: store.theme['dialog.lightForeground'] }}
    >
      <StyledApp ref={rootRef}>
        <UIStyle />
        <Header>{t('exlTitle')}</Header>
        <List ref={reorder.containerRef} onMouseDown={reorder.onMouseDown}>
          {extensions.length === 0 && <Empty>{t('exlEmpty')}</Empty>}
          {reorder.previewIds.map((id) => {
            const ext = extensions.find((x) => x.id === id);
            if (!ext) return null;
            const pinned = store.isPinned(ext.id);
            return (
              <Item
                key={ext.id}
                data-ext-id={ext.id}
                dragging={reorder.draggingId === ext.id}
                onClick={onItemClick(ext)}
                title={ext.name}
              >
                <ItemIcon
                  style={{ backgroundImage: ext.icon ? `url(${ext.icon})` : 'none' }}
                />
                <ItemName>{ext.name}</ItemName>
                {ext.optionsUrl && (
                  <OptionsButton
                    onClick={onOptionsClick(ext)}
                    title={t('exlOptions')}
                  >
                    <GearSix size={16} />
                  </OptionsButton>
                )}
                <PinButton
                  pinned={pinned}
                  onClick={onPinClick(ext)}
                  title={pinned ? t('exlUnpin') : t('exlPin')}
                >
                  {pinned ? (
                    <PushPin size={16} weight="fill" />
                  ) : (
                    <PushPinSlash size={16} />
                  )}
                </PinButton>
              </Item>
            );
          })}
        </List>
        <FooterDivider />
        <Footer>
          <FooterItem onClick={onManageClick}>
            <SlidersHorizontal size={18} />
            {t('exlManage')}
          </FooterItem>
        </Footer>
      </StyledApp>
    </ThemeProvider>
  );
});
