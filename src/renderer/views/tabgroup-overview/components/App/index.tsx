import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';
import { Plus, X, DotsThree, PushPin } from '@phosphor-icons/react';

import {
  Root,
  Backdrop,
  Scrim,
  Scroller,
  Content,
  TopBar,
  GroupDot,
  NameInput,
  Count,
  IconButton,
  PaletteAnchor,
  Swatches,
  Swatch,
  Spacer,
  Pills,
  Pill,
  Grid,
  Card,
  Preview,
  Placeholder,
  CardClose,
  Badges,
  Badge,
  CardInfo,
  CardFav,
  Spinner,
  CardText,
  CardTitle,
  CardHost,
  AddCard,
} from './style';
import store, { IOverviewTab } from '../../store';
import { UIStyle } from '~/renderer/mixins/default-styles';
import { useI18n } from '~/renderer/components/I18n';

const GlobeIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <circle cx="12" cy="12" r="8.5" stroke="#8b93a7" strokeWidth="1.6" />
    <path
      d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.4 3.5 8.5S14.3 18.1 12 20.5C9.7 18.1 8.5 15.1 8.5 12S9.7 5.9 12 3.5Z"
      stroke="#8b93a7"
      strokeWidth="1.6"
    />
  </svg>
);

// 图标解码失败时回退地球,避免破图。
const Favicon = ({ src, size }: { src: string; size?: number }) => {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [src]);
  if (!src || failed) return <GlobeIcon size={size} />;
  return (
    <img src={src} alt="" draggable={false} onError={() => setFailed(true)} />
  );
};

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || url;
  } catch {
    return url || '';
  }
};

// 一个标签页 = 一张卡片:上半是页面截图(无截图时大图标占位),下半是图标+标题+域名。
const TabCard = observer(
  ({ tab, color, index }: { tab: IOverviewTab; color: string; index: number }) => {
    const t = useI18n();
    const thumbnail = store.thumbnails[tab.id];
    const select = () => store.action({ type: 'select-tab', tabId: tab.id });
    const close = () => store.action({ type: 'close-tab', tabId: tab.id });

    return (
      <Card
        role="button"
        tabIndex={0}
        title={tab.url ? `${tab.title}\n${tab.url}` : tab.title}
        aria-current={tab.selected || undefined}
        $color={color}
        $selected={tab.selected}
        $index={index}
        onClick={select}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            select();
          } else if (e.key === 'Delete') {
            e.preventDefault();
            close();
          }
        }}
        onContextMenu={(e: React.MouseEvent) => {
          e.preventDefault();
          store.action({ type: 'tab-menu', tabId: tab.id });
        }}
        onMouseDown={(e: React.MouseEvent) => {
          // 阻止中键自动滚动光标。
          if (e.button === 1) e.preventDefault();
        }}
        onAuxClick={(e: React.MouseEvent) => {
          // 中键关闭,与标签栏一致。
          if (e.button === 1) close();
        }}
      >
        <Preview $color={color} $dim={!!tab.discarded}>
          {thumbnail ? (
            <img className="shot" src={thumbnail} alt="" draggable={false} />
          ) : (
            <Placeholder>
              <Favicon src={tab.favicon} size={28} />
            </Placeholder>
          )}
          <Badges>
            {tab.selected && <Badge $color={color}>{t('tgoCurrent')}</Badge>}
          </Badges>
          <CardClose
            className="card-close"
            type="button"
            title={t('close')}
            aria-label={t('close')}
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              close();
            }}
          >
            <X size={13} weight="bold" />
          </CardClose>
        </Preview>
        <CardInfo>
          <CardFav $dim={!!tab.discarded}>
            {tab.loading && !tab.discarded ? (
              <Spinner />
            ) : (
              <Favicon src={tab.favicon} />
            )}
          </CardFav>
          <CardText>
            <CardTitle $selected={tab.selected}>
              {tab.title || tab.url}
            </CardTitle>
            <CardHost>{hostOf(tab.url)}</CardHost>
          </CardText>
        </CardInfo>
      </Card>
    );
  },
);

// 顶栏:聚焦分组的颜色/名称(可直接改名)/标签数/更多操作/关闭。
const GroupHeader = observer(() => {
  const t = useI18n();
  const group = store.focusGroup;
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  // 改名:本地 state 为输入源,避免每次宿主刷新回写打断输入。
  const [name, setName] = React.useState(group?.name || '');
  const editing = React.useRef(false);
  React.useEffect(() => {
    if (!editing.current) setName(group?.name || '');
  }, [group?.id, group?.name]);

  // 色盘点外部关闭;切换分组时收起。
  React.useEffect(() => {
    if (!paletteOpen) return undefined;
    const close = () => setPaletteOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [paletteOpen]);
  React.useEffect(() => setPaletteOpen(false), [group?.id]);

  if (!group) return null;
  const fallbackName = t('sghTabCountFallback', { count: group.count });

  return (
    <TopBar data-overview-keep>
      <PaletteAnchor>
        <GroupDot
          type="button"
          title={t('shellPickGroupColor')}
          aria-label={t('shellPickGroupColor')}
          onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
          onClick={() => setPaletteOpen((v) => !v)}
        >
          <span style={{ backgroundColor: group.color }} />
        </GroupDot>
        {paletteOpen && (
          <Swatches onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}>
            {store.palette.map((c) => (
              <Swatch
                key={c}
                type="button"
                aria-label={c}
                $active={c === group.color}
                style={{ backgroundColor: c, color: c }}
                onClick={() => {
                  store.action({ type: 'setcolor', groupId: group.id, color: c });
                  setPaletteOpen(false);
                }}
              />
            ))}
          </Swatches>
        )}
      </PaletteAnchor>
      <NameInput
        value={name}
        placeholder={fallbackName}
        aria-label={t('tgoRenameGroup')}
        spellCheck={false}
        size={Math.max(4, Math.min(28, (name || fallbackName).length + 1))}
        onFocus={() => {
          editing.current = true;
        }}
        onBlur={() => {
          editing.current = false;
        }}
        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault();
            if (e.key === 'Escape') {
              setName(group.name);
              store.action({ type: 'rename', groupId: group.id, name: group.name });
            }
            e.currentTarget.blur();
          }
        }}
        onChange={(e) => {
          const v = e.target.value;
          setName(v);
          store.action({ type: 'rename', groupId: group.id, name: v });
        }}
      />
      <Count $color={group.color}>{group.count}</Count>
      {group.pinned && (
        <Badge $color={group.color} $static>
          <PushPin size={11} weight="fill" />
          {t('tgoPinned')}
        </Badge>
      )}
      <Spacer />
      <IconButton
        type="button"
        title={t('tgoMoreActions')}
        aria-label={t('tgoMoreActions')}
        onClick={() => store.action({ type: 'group-menu', groupId: group.id })}
      >
        <DotsThree size={20} weight="bold" />
      </IconButton>
      <IconButton
        type="button"
        title={`${t('close')} (Esc)`}
        aria-label={t('close')}
        onClick={() => store.action({ type: 'close-overview' })}
      >
        <X size={18} weight="bold" />
      </IconButton>
    </TopBar>
  );
});

// 多个分组时显示切换条,点击切到该组的标签卡片。
const GroupSwitcher = observer(() => {
  const t = useI18n();
  if (store.groups.length < 2) return null;
  return (
    <Pills data-overview-keep role="tablist" aria-label={t('tgoTitle')}>
      {store.groups.map((g) => {
        const active = g.id === store.focusGroupId;
        return (
          <Pill
            key={g.id}
            type="button"
            role="tab"
            aria-selected={active}
            $color={g.color}
            $active={active}
            onClick={() =>
              !active && store.action({ type: 'focus-group', groupId: g.id })
            }
          >
            <i style={{ backgroundColor: g.color }} />
            <span>{g.name || t('sghTabCountFallback', { count: g.count })}</span>
            <b>{g.count}</b>
          </Pill>
        );
      })}
    </Pills>
  );
});

export const App = observer(() => {
  const t = useI18n();
  const group = store.focusGroup;
  const backdrop =
    store.backdropId !== -1 ? store.thumbnails[store.backdropId] : undefined;

  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <UIStyle />
      <Root $visible={store.visible}>
        {backdrop && (
          <Backdrop style={{ backgroundImage: `url("${backdrop}")` }} />
        )}
        <Scrim />
        <Scroller
          onMouseDown={(e: React.MouseEvent) => {
            // 点卡片以外的空白处收起。
            if (
              e.button === 0 &&
              !(e.target as HTMLElement).closest('[data-overview-keep]')
            ) {
              store.action({ type: 'close-overview' });
            }
          }}
        >
          <Content>
            <GroupHeader />
            <GroupSwitcher />
            {group && (
              <Grid key={store.animSeq}>
                {store.tabs.map((tab, index) => (
                  <div key={tab.id} data-overview-keep>
                    <TabCard tab={tab} color={group.color} index={index} />
                  </div>
                ))}
                <div data-overview-keep>
                  <AddCard
                    type="button"
                    $color={group.color}
                    $index={store.tabs.length}
                    onClick={() =>
                      store.action({ type: 'new-tab', groupId: group.id })
                    }
                  >
                    <Plus size={22} weight="bold" />
                    <span>{t('tgoNewTab')}</span>
                  </AddCard>
                </div>
              </Grid>
            )}
          </Content>
        </Scroller>
      </Root>
    </ThemeProvider>
  );
});
