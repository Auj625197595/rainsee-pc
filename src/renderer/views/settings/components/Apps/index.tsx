import * as React from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import styled, { css } from 'styled-components';
import {
  ArrowLeft,
  ArrowSquareOut,
  CaretDown,
  CaretRight,
  Cookie,
  Desktop,
  DotsThreeVertical,
  Info,
  LockKey,
  PushPin,
  ShieldCheck,
  SquaresFour,
  Trash,
} from '@phosphor-icons/react';

import {
  Control,
  Row,
  SecondaryText,
  SettingCopy,
  SettingGroup,
  SettingGroupBlock,
  SettingGroupLabel,
  SettingIcon,
  Title,
} from '../App/style';
import { NormalButton } from '../App';
import store from '../../store';
import { ipcRenderer } from '~/common/renderer-ipc';
import { getSettingsTranslator } from '../../utils';
import { getPalette } from '../../utils/palette';
import { Switch } from '~/renderer/components/Switch';
import { IPermissionRecord, ITheme } from '~/interfaces';
import { getDomain } from '~/utils';

// 与主进程 src/main/services/pwa-management.ts 的 PwaAppInfo 对应。
interface IPwaApp {
  id: string;
  name: string;
  origin: string;
  host: string;
  startUrl: string;
  description: string;
  iconDataUrl: string;
  themeColor: string;
  installedAt: number;
  handleLinks: boolean;
  supportedLinks: string[];
  hasDesktopShortcut: boolean;
  hasStartMenuShortcut: boolean;
  running: boolean;
}

interface IActionResult {
  ok: boolean;
  message?: string;
}

type AppChannel =
  | 'pwa-app-open'
  | 'pwa-app-uninstall'
  | 'pwa-app-create-desktop-shortcut'
  | 'pwa-app-pin-taskbar'
  | 'pwa-app-pin-start'
  | 'pwa-app-clear-cookies'
  | 'pwa-app-set-handle-links';

const themed = (
  fn: (p: ReturnType<typeof getPalette>) => ReturnType<typeof css>,
) => ({ theme }: { theme?: ITheme }) => fn(getPalette(theme));

const AppIconBox = styled.div<{ size: number }>`
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font-weight: 700;

  ${({ size }) => css`
    width: ${size}px;
    height: ${size}px;
    border-radius: ${Math.round(size / 4)}px;
    font-size: ${Math.round(size / 2.4)}px;
  `}
  ${themed(
    (p) => css`
      color: ${p.primary};
      background-color: ${p.primarySoft};
    `,
  )}

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
`;

const RowActions = styled.div`
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const MoreAnchor = styled.div`
  position: relative;
`;

const IconAction = styled.button`
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  cursor: pointer;

  ${themed(
    (p) => css`
      color: ${p.textSub};

      &:hover {
        background-color: ${p.primarySoft};
        color: ${p.primary};
      }

      &:focus-visible {
        outline: 2px solid ${p.primary};
      }
    `,
  )}
`;

// 经 portal 挂到 body + fixed 定位:列表卡片容器有 overflow 裁切,absolute 会被截断。
const Menu = styled.div`
  position: fixed;
  z-index: 1000;
  min-width: 200px;
  padding: 6px;
  border-radius: 12px;

  ${themed(
    (p) => css`
      background-color: ${p.surface};
      box-shadow: inset 0 0 0 1px ${p.line}, 0 12px 32px -12px rgba(20, 30, 60, 0.35);
    `,
  )}
`;

const MenuItem = styled.button<{ danger?: boolean }>`
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: none;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 10px;
  background: transparent;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;

  ${({ danger, theme }: { danger?: boolean; theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${danger ? p.danger : p.textMain};

      &:hover,
      &:focus-visible {
        outline: none;
        background-color: ${p.hover};
        box-shadow: inset 0 0 0 1px ${p.line};
      }
    `;
  }}
`;

const MenuSeparator = styled.div`
  height: 1px;
  margin: 4px 6px;

  ${themed(
    (p) => css`
      background-color: ${p.line};
    `,
  )}
`;

const Notice = styled.div`
  margin-top: 16px;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 12.5px;
  line-height: 1.5;

  ${themed(
    (p) => css`
      color: ${p.primary};
      background-color: ${p.primarySoft};
    `,
  )}
`;

const Empty = styled.div`
  margin-top: 26px;
  padding: 36px 18px;
  border-radius: 18px;
  text-align: center;
  font-size: 13px;
  line-height: 1.6;

  ${themed(
    (p) => css`
      color: ${p.textSub};
      background-color: ${p.surface};
      border: 1px solid ${p.line};
    `,
  )}
`;

const BackButton = styled.button`
  margin-top: 6px;
  height: 32px;
  padding: 0 10px 0 6px;
  border: none;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;

  ${themed(
    (p) => css`
      color: ${p.textSub};

      &:hover {
        color: ${p.primary};
        background-color: ${p.primarySoft};
      }
    `,
  )}
`;

const HeroCard = styled.div`
  margin-top: 14px;
  padding: 20px;
  border-radius: 18px;

  ${themed(
    (p) => css`
      background-color: ${p.surface};
      border: 1px solid ${p.line};
    `,
  )}
`;

const HeroTop = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
`;

const HeroName = styled.div`
  font-size: 18px;
  font-weight: 700;

  ${themed(
    (p) => css`
      color: ${p.textMain};
    `,
  )}
`;

const HeroActions = styled.div`
  margin-top: 18px;
  padding-top: 16px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;

  ${themed(
    (p) => css`
      border-top: 1px solid ${p.line};
    `,
  )}
`;

const DangerButton = styled.button`
  margin-left: auto;
  height: 36px;
  padding: 0 16px;
  border: none;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;

  ${themed(
    (p) => css`
      color: ${p.danger};
      background-color: ${p.danger}14;

      &:hover {
        background-color: ${p.danger}22;
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `,
  )}
`;

const LinkButton = styled.button`
  margin-top: 4px;
  padding: 0;
  border: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;

  ${themed(
    (p) => css`
      color: ${p.primary};

      &:hover {
        text-decoration: underline;
      }
    `,
  )}
`;

const LinkList = styled.ul`
  margin: 8px 0 0;
  padding: 0;
  list-style: none;

  li {
    padding: 6px 10px;
    border-radius: 8px;
    font-family: Consolas, 'Courier New', monospace;
    font-size: 12px;
    word-break: break-all;
  }

  ${themed(
    (p) => css`
      li {
        color: ${p.textMain};
        background-color: ${p.bg};
      }

      li + li {
        margin-top: 4px;
      }
    `,
  )}
`;

const DetailText = styled.div`
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;

  ${themed(
    (p) => css`
      color: ${p.textMain};
    `,
  )}
`;

const DetailMeta = styled.div`
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.6;
  word-break: break-all;

  ${themed(
    (p) => css`
      color: ${p.textSub};
    `,
  )}
`;

const SectionLabel = styled(SettingGroupLabel)`
  margin-top: 26px;
`;

const AppIcon = ({ app, size }: { app: IPwaApp; size: number }) => (
  <AppIconBox size={size} aria-hidden="true">
    {app.iconDataUrl ? (
      <img src={app.iconDataUrl} alt="" />
    ) : (
      (app.name || app.host).trim().charAt(0).toUpperCase() || <SquaresFour />
    )}
  </AppIconBox>
);

// 列表项「更多」菜单。点击外部或按 Esc 关闭。
const MoreMenu = ({
  app,
  onAction,
  onUninstall,
}: {
  app: IPwaApp;
  onAction: (channel: AppChannel, app: IPwaApp) => void;
  onUninstall: (app: IPwaApp) => void;
}) => {
  const t = getSettingsTranslator();
  const [open, setOpen] = React.useState(false);
  const [position, setPosition] = React.useState<{ top: number; left: number } | null>(null);
  const anchorRef = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  // 按触发按钮的视口坐标定位,右对齐;下方放不下则向上翻,并夹在视口内。
  React.useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;
    const gap = 4;
    const margin = 8;
    const rect = anchor.getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    let top = rect.bottom + gap;
    if (top + height > window.innerHeight - margin && rect.top - gap - height >= margin) {
      top = rect.top - gap - height;
    }
    top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));
    const left = Math.max(margin, Math.min(rect.right - width, window.innerWidth - width - margin));
    setPosition({ top, left });
  }, [open]);

  React.useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    // fixed 菜单不随内容滚动,滚动/缩放时直接收起,避免与按钮错位。
    const onScroll = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      close();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [open]);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <MoreAnchor ref={anchorRef} onClick={(event) => event.stopPropagation()}>
      <IconAction
        type="button"
        title={t('pwaAppsMore')}
        aria-label={t('pwaAppsMore')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <DotsThreeVertical size={18} weight="bold" />
      </IconAction>
      {open && createPortal(
        <Menu
          ref={menuRef}
          role="menu"
          onClick={(event) => event.stopPropagation()}
          style={
            position
              ? { top: position.top, left: position.left }
              : { top: 0, left: 0, visibility: 'hidden' }
          }
        >
          <MenuItem
            type="button"
            role="menuitem"
            onClick={run(() => onAction('pwa-app-pin-taskbar', app))}
          >
            <PushPin size={16} />
            {t('pwaAppsPinTaskbar')}
          </MenuItem>
          <MenuItem
            type="button"
            role="menuitem"
            onClick={run(() => onAction('pwa-app-pin-start', app))}
          >
            <SquaresFour size={16} />
            {t('pwaAppsPinStart')}
          </MenuItem>
          <MenuItem
            type="button"
            role="menuitem"
            onClick={run(() => onAction('pwa-app-create-desktop-shortcut', app))}
          >
            <Desktop size={16} />
            {t('pwaAppsCreateDesktopShortcut')}
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            type="button"
            role="menuitem"
            danger
            onClick={run(() => onUninstall(app))}
          >
            <Trash size={16} />
            {t('pwaAppsUninstall')}
          </MenuItem>
        </Menu>,
        document.body,
      )}
    </MoreAnchor>
  );
};

const summarizePermissions = (records: IPermissionRecord[], host: string) => {
  let allowed = 0;
  let blocked = 0;
  for (const record of records) {
    if (getDomain(record.url).trim().toLowerCase() !== host) continue;
    if (record.type === 1) allowed += 1;
    else if (record.type === 2) blocked += 1;
  }
  return { allowed, blocked };
};

const AppDetails = ({
  app,
  busy,
  onBack,
  onAction,
  onUninstall,
}: {
  app: IPwaApp;
  busy: boolean;
  onBack: () => void;
  onAction: (channel: AppChannel, app: IPwaApp, ...args: unknown[]) => void;
  onUninstall: (app: IPwaApp) => void;
}) => {
  const t = getSettingsTranslator();
  const [linksExpanded, setLinksExpanded] = React.useState(false);
  const [permissions, setPermissions] = React.useState({ allowed: 0, blocked: 0 });

  React.useEffect(() => {
    let cancelled = false;
    ipcRenderer
      .invoke('storage-get', { scope: 'permissions', query: {} })
      .then((records) => {
        if (cancelled) return;
        setPermissions(
          summarizePermissions(
            Array.isArray(records) ? (records as IPermissionRecord[]) : [],
            app.host.toLowerCase(),
          ),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [app.host]);

  // 跳到「权限管理」并直接展开本站点(Permissions 组件挂载时读 ?site=)。
  const openSitePermissions = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('site', app.host);
    url.hash = 'permissions';
    window.history.replaceState({ section: 'permissions' }, '', url.toString());
    store.selectedSection = 'permissions';
  };

  const permissionSummary =
    permissions.allowed || permissions.blocked
      ? t('pwaAppsPermissionSummary', {
          allowed: permissions.allowed,
          blocked: permissions.blocked,
        })
      : t('pwaAppsPermissionNone');

  const installedDate = app.installedAt
    ? new Date(app.installedAt).toLocaleDateString()
    : '';

  return (
    <>
      <BackButton type="button" onClick={onBack}>
        <ArrowLeft size={16} weight="bold" />
        {t('pwaAppsBackToList')}
      </BackButton>

      <HeroCard>
        <HeroTop>
          <AppIcon app={app} size={56} />
          <SettingCopy>
            <HeroName>{app.name}</HeroName>
            <SecondaryText>
              {t('pwaAppsPublisher')} {app.host}
            </SecondaryText>
          </SettingCopy>
          <NormalButton
            variant="primary"
            disabled={busy}
            onClick={() => onAction('pwa-app-open', app)}
          >
            {t('pwaAppsOpen')}
          </NormalButton>
        </HeroTop>
        <HeroActions>
          <NormalButton
            variant="soft"
            disabled={busy}
            onClick={() => onAction('pwa-app-pin-taskbar', app)}
          >
            <PushPin size={15} />
            {t('pwaAppsPinTaskbar')}
          </NormalButton>
          <NormalButton
            variant="soft"
            disabled={busy}
            onClick={() => onAction('pwa-app-pin-start', app)}
          >
            <SquaresFour size={15} />
            {t('pwaAppsPinStart')}
          </NormalButton>
          <NormalButton
            variant="soft"
            disabled={busy}
            onClick={() => onAction('pwa-app-create-desktop-shortcut', app)}
          >
            <Desktop size={15} />
            {t('pwaAppsCreateDesktopShortcut')}
          </NormalButton>
          <DangerButton
            type="button"
            disabled={busy}
            onClick={() => onUninstall(app)}
          >
            <Trash size={15} />
            {t('pwaAppsUninstall')}
          </DangerButton>
        </HeroActions>
      </HeroCard>

      <SettingGroupBlock>
        <SettingGroup>
          {/* <Row style={{ cursor: 'not-allowed', opacity: 0.6 }} aria-disabled="true">
            <SettingCopy>
              <Title>{t('pwaAppsLaunchOnLogin')}</Title>
              <SecondaryText>{t('pwaAppsLaunchOnLoginUnsupported')}</SecondaryText>
            </SettingCopy>
            <Control>
              <Switch value={false} />
            </Control>
          </Row> */}
          <Row
            role="switch"
            aria-checked={app.handleLinks}
            tabIndex={0}
            onClick={() => !busy && onAction('pwa-app-set-handle-links', app, !app.handleLinks)}
            onKeyDown={(event) => {
              if ((event.key === 'Enter' || event.key === ' ') && !busy) {
                event.preventDefault();
                onAction('pwa-app-set-handle-links', app, !app.handleLinks);
              }
            }}
          >
            <SettingCopy>
              <Title>{t('pwaAppsHandleLinks')}</Title>
              <SecondaryText>{t('pwaAppsHandleLinksDesc')}</SecondaryText>
              <LinkButton
                type="button"
                aria-expanded={linksExpanded}
                onClick={(event) => {
                  event.stopPropagation();
                  setLinksExpanded((value) => !value);
                }}
              >
                {t('pwaAppsViewSupportedLinks')}
                {linksExpanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
              </LinkButton>
              {linksExpanded && (
                <LinkList onClick={(event) => event.stopPropagation()}>
                  {app.supportedLinks.map((link) => (
                    <li key={link}>{link}*</li>
                  ))}
                </LinkList>
              )}
            </SettingCopy>
            <Control>
              <Switch value={app.handleLinks} />
            </Control>
          </Row>
        </SettingGroup>
      </SettingGroupBlock>

      <SectionLabel>{t('pwaAppsAbout')}</SectionLabel>
      <SettingGroup style={{ marginTop: 0 }}>
        <Row style={{ cursor: 'default', alignItems: 'flex-start' }}>
          <SettingIcon tone="blue">
            <Info size={19} weight="fill" />
          </SettingIcon>
          <SettingCopy>
            <DetailText>
              {app.description || t('pwaAppsNoDescription', { host: app.host })}
            </DetailText>
            <DetailMeta>
              {t('pwaAppsStartUrl')}: {app.startUrl}
              {installedDate && (
                <>
                  <br />
                  {t('pwaAppsInstalledAt')}: {installedDate}
                </>
              )}
            </DetailMeta>
          </SettingCopy>
        </Row>
      </SettingGroup>

      <SectionLabel>{t('pwaAppsPermissions')}</SectionLabel>
      <SettingGroup style={{ marginTop: 0 }}>
        <Row onClick={openSitePermissions}>
          <SettingIcon tone="red">
            <LockKey size={19} weight="fill" />
          </SettingIcon>
          <SettingCopy>
            <Title>{t('pwaAppsSitePermissions')}</Title>
            <SecondaryText>{permissionSummary}</SecondaryText>
          </SettingCopy>
          <Control>
            <CaretRight size={16} />
          </Control>
        </Row>
      </SettingGroup>

      <SectionLabel>{t('pwaAppsPrivacy')}</SectionLabel>
      <SettingGroup style={{ marginTop: 0 }}>
        <Row style={{ cursor: 'default' }}>
          <SettingIcon tone="orange">
            <Cookie size={19} weight="fill" />
          </SettingIcon>
          <SettingCopy>
            <Title>{t('pwaAppsCookies')}</Title>
            <SecondaryText>{t('pwaAppsCookiesDesc', { origin: app.origin })}</SecondaryText>
          </SettingCopy>
          <Control>
            <NormalButton
              variant="soft"
              disabled={busy}
              onClick={() => onAction('pwa-app-clear-cookies', app)}
            >
              {t('pwaAppsClearCookies')}
            </NormalButton>
          </Control>
        </Row>
        <Row onClick={() => (store.selectedSection = 'privacy')}>
          <SettingIcon tone="green">
            <ShieldCheck size={19} weight="fill" />
          </SettingIcon>
          <SettingCopy>
            <Title>{t('pwaAppsTrackingPrevention')}</Title>
            <SecondaryText>{t('pwaAppsTrackingPreventionDesc')}</SecondaryText>
          </SettingCopy>
          <Control>
            <ArrowSquareOut size={16} />
          </Control>
        </Row>
      </SettingGroup>
    </>
  );
};

export const PwaApps = observer(() => {
  const t = getSettingsTranslator();
  const [apps, setApps] = React.useState<IPwaApp[] | null>(null);
  const [selectedId, setSelectedId] = React.useState('');
  const [busyId, setBusyId] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const noticeTimer = React.useRef<number>(0);

  const refresh = React.useCallback(async () => {
    try {
      const list = await ipcRenderer.invoke('pwa-apps-list');
      setApps(Array.isArray(list) ? (list as IPwaApp[]) : []);
    } catch {
      setApps([]);
    }
  }, []);

  React.useEffect(() => {
    refresh();
    // 在别处安装/卸载后切回设置页时同步一次。
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearTimeout(noticeTimer.current);
    };
  }, [refresh]);

  const showNotice = (message?: string) => {
    window.clearTimeout(noticeTimer.current);
    setNotice(message || '');
    if (message) {
      noticeTimer.current = window.setTimeout(() => setNotice(''), 8000);
    }
  };

  const runAction = async (channel: AppChannel, app: IPwaApp, ...args: unknown[]) => {
    if (busyId) return;
    setBusyId(app.id);
    try {
      const result = (await ipcRenderer.invoke(channel, app.id, ...args)) as IActionResult;
      if (result?.message || !result?.ok) {
        showNotice(result?.message || t('pwaAppsActionFailed'));
      }
      await refresh();
    } catch {
      showNotice(t('pwaAppsActionFailed'));
    } finally {
      setBusyId('');
    }
  };

  const uninstall = async (app: IPwaApp) => {
    if (!window.confirm(t('pwaAppsUninstallConfirm', { name: app.name }))) return;
    await runAction('pwa-app-uninstall', app);
    if (selectedId === app.id) setSelectedId('');
  };

  const selected = apps?.find((app) => app.id === selectedId);

  if (selected) {
    return (
      <>
        {notice && <Notice role="status">{notice}</Notice>}
        <AppDetails
          app={selected}
          busy={busyId === selected.id}
          onBack={() => setSelectedId('')}
          onAction={runAction}
          onUninstall={uninstall}
        />
      </>
    );
  }

  return (
    <>
      <SecondaryText style={{ marginTop: 6 }}>{t('pwaAppsIntro')}</SecondaryText>
      {notice && <Notice role="status">{notice}</Notice>}
      {apps && apps.length === 0 ? (
        <Empty>{t('pwaAppsEmpty')}</Empty>
      ) : (
        <SettingGroupBlock>
          <SettingGroupLabel>
            {t('pwaAppsInstalledCount', { count: apps?.length || 0 })}
          </SettingGroupLabel>
          <SettingGroup>
            {(apps || []).map((app) => (
              <Row
                key={app.id}
                onClick={() => setSelectedId(app.id)}
                title={t('pwaAppsDetails')}
              >
                <AppIcon app={app} size={38} />
                <SettingCopy>
                  <Title>{app.name}</Title>
                  <SecondaryText>{app.host}</SecondaryText>
                </SettingCopy>
                <RowActions onClick={(event) => event.stopPropagation()}>
                  <NormalButton
                    variant="soft"
                    disabled={busyId === app.id}
                    onClick={() => runAction('pwa-app-open', app)}
                  >
                    {t('pwaAppsOpen')}
                  </NormalButton>
                  <NormalButton variant="soft" onClick={() => setSelectedId(app.id)}>
                    {t('pwaAppsDetails')}
                  </NormalButton>
                  <MoreMenu app={app} onAction={runAction} onUninstall={uninstall} />
                </RowActions>
              </Row>
            ))}
          </SettingGroup>
        </SettingGroupBlock>
      )}
    </>
  );
});
