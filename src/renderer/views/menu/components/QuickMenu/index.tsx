import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ipcRenderer } from 'electron';

import {
  Root,
  Header,
  HeaderInfo,
  Avatar,
  HeaderName,
  HeaderSub,
  HeaderActions,
  RoundButton,
  TileGrid,
  Tile,
  TileIcon,
  TileLabel,
  ListPanel,
  ListGroup,
  Row,
  RowIcon,
  RowLabel,
  RowCaret,
  Divider,
  ZoomBar,
  ZoomIcon,
  ZoomLabel,
  ZoomControls,
  ZoomButton,
  ZoomValue,
  ActionGrid,
  ActionTile,
  ActionIcon,
  ActionLabel,
  SectionTitle,
  ProfileRowWrap,
  ProfileRow,
  ProfileMeta,
  ProfileName,
  StatusBadge,
  MoreButton,
  MoreMenu,
  MoreMenuItem,
  InlineNotice,
  ModalOverlay,
  Modal,
  ModalHeader,
  ModalClose,
  ProfileInput,
  ProfileHint,
  CloneSection,
  CloneSectionTitle,
  CloneOptionsGrid,
  CloneOption,
  CloneCheckbox,
  CloneOptionLabel,
  ModalMessage,
  ConfirmText,
  ModalActions,
  ModalButton,
} from './style';
import store from '../../store';
import { getWebUIURL } from '~/common/webui';
import type { MessageKey } from '~/common/i18n';
import { useI18n } from '~/renderer/components/I18n';
import { Switch } from '~/renderer/components/Switch';
import {
  IconUser,
  IconShare,
  IconSettings,
  IconExtension,
  IconBookmark,
  IconDownload,
  IconHistory,
  IconPlusSquare,
  IconBrowser,
  IconWindows,
  IconZoom,
  IconMinus,
  IconPlus,
  IconPrinter,
  IconTranslate,
  IconCamera,
  IconPassword,
  IconQuestion,
  IconCaretRight,
  IconMoon,
  IconAppWindow,
  IconFind,
  IconUserPlus,
  IconProfile,
  IconMore,
  IconDesktop,
  IconTrash,
  IconClose,
} from './icons';

interface IProfileInfo {
  name: string;
  current: boolean;
  running: boolean;
}

interface IProfilesPayload {
  currentProfile: string | null;
  profiles: IProfileInfo[];
  ok?: boolean;
  error?: string;
}

interface IProfileResult {
  ok: boolean;
  message?: string;
}

const AVATAR_LONG_PRESS_MS = 650;

type CloneDataKey =
  | 'bookmarks'
  | 'passwords'
  | 'history'
  | 'extensions'
  | 'settings';

const EMPTY_CLONE_DATA: Record<CloneDataKey, boolean> = {
  bookmarks: false,
  passwords: false,
  history: false,
  extensions: false,
  settings: false,
};

const CLONE_DATA_OPTIONS: Array<{key: CloneDataKey; labelKey: MessageKey}> = [
  {key: 'bookmarks', labelKey: 'abSuggestBookmarks'},
  {key: 'passwords', labelKey: 'sysPasswords'},
  {key: 'history', labelKey: 'wbHistoryLabel'},
  {key: 'extensions', labelKey: 'qmExtensions'},
  {key: 'settings', labelKey: 'settings'},
];

const addNewTab = (url: string, incognito = false) => {
  ipcRenderer.send(`add-tab-${store.windowId}`, {
    url,
    active: true,
    incognito,
  });
  store.hide();
};

const goToWebUIPage = (name: string) => () => addNewTab(getWebUIURL(name));

// 新建标签页
const newTab = () => addNewTab(getWebUIURL('newtab'));

// 新建窗口 / 无痕窗口（全局通道，由主进程 application.ts 处理）
const newWindow = () => {
  ipcRenderer.send('create-window', false);
  store.hide();
};
const newIncognitoWindow = () => {
  ipcRenderer.send('create-window', true);
  store.hide();
};

// 打印当前页（主进程 webContents.print）
const printPage = () => {
  ipcRenderer.send(`print-page-${store.windowId}`);
  store.hide();
};

// 翻译当前页：开启翻译(主进程注入脚本并设 active),地址栏随之显示翻译图标。
const translatePage = () => {
  ipcRenderer.send(`translate-start-${store.windowId}`);
  store.hide();
};

// 查找页内内容：唤起查找浮层(主进程 find dialog,窗口右上角常驻)
const findInPage = () => {
  ipcRenderer.send(`find-show-${store.windowId}`);
  store.hide();
};

// 安装为 PWA:主进程对当前页注入合成 manifest(若无),使任意 http(s) 网页可安装为独立应用。
const installPwa = () => {
  ipcRenderer.send(`quickmenu-install-pwa-${store.windowId}`);
  store.hide();
};

// 开源版：无账号体系,头像点击不再触发登录流程。

// 分享当前网页:屏幕居中弹窗(二维码 + 短链)
const openShareDialog = () => {
  ipcRenderer.send(`show-share-dialog-${store.windowId}`);
  store.hide();
};

// 截图:打开全屏截图浮层(主进程 screenshot dialog)
const openScreenshot = () => {
  ipcRenderer.send(`show-screenshot-dialog-${store.windowId}`);
  store.hide();
};

// 密码:跳转到设置页的「密码填充」分区
const openPasswordSettings = () =>
  addNewTab(`${getWebUIURL('settings')}?section=autofill`);

// 暗色模式开关:在「深色 / 浅色」间切换(关掉 themeAuto,显式选定)。
// 走 store.save() → 主进程检测主题状态变化 → darknight 扩展联动 + 当前页刷新。
// 不隐藏菜单:让用户看到开关翻转与菜单自身的主题切换(与缩放控件同样的内联交互)。
const toggleTheme = () => {
  const isDark = store.settings.theme === 'wexond-dark';
  store.settings.themeAuto = false;
  store.settings.theme = isDark ? 'wexond-light' : 'wexond-dark';
  store.save();
};

// 开源版:项目仓库地址
const openGithubRepo = () =>
  addNewTab('https://github.com/Auj625197595/rainsee-pc');

// 顶部四宫格
const TILES = [
  {
    labelKey: 'qmTilesExtensions' as MessageKey,
    icon: <IconExtension />,
    bg: '#1a1a1a',
    darkBg: '#2b3348',
    onClick: goToWebUIPage('extensions'),
  },
  {
    labelKey: 'abSuggestBookmarks' as MessageKey,
    icon: <IconBookmark />,
    bg: '#eef2ff',
    darkBg: '#25304c',
    onClick: goToWebUIPage('bookmarks'),
  },
  {
    labelKey: 'downloads' as MessageKey,
    icon: <IconDownload />,
    bg: '#eef0ff',
    darkBg: '#233148',
    onClick: goToWebUIPage('downloads'),
  },
  {
    labelKey: 'wbHistoryLabel' as MessageKey,
    icon: <IconHistory />,
    bg: '#f6eefe',
    darkBg: '#312644',
    onClick: goToWebUIPage('history'),
  },
];

// 列表区：新建相关
const NEW_ITEMS = [
  {
    labelKey: 'shellNewTab' as MessageKey,
    icon: <IconPlusSquare />,
    bg: '#eef2ff',
    darkBg: '#202b46',
    color: '#3357f6',
    darkColor: '#8ba5ff',
    onClick: newTab,
  },
  {
    labelKey: 'qmNewWindow' as MessageKey,
    icon: <IconBrowser />,
    bg: '#eaf9f3',
    darkBg: '#1d332c',
    color: '#1d9a6d',
    darkColor: '#7ad6b2',
    onClick: newWindow,
  },
  {
    labelKey: 'qmNewIncognito' as MessageKey,
    icon: <IconWindows />,
    bg: '#f3eeff',
    darkBg: '#2f2741',
    color: '#7a5cf0',
    darkColor: '#b39bff',
    onClick: newIncognitoWindow,
  },
];

// 二宫格快捷动作
const ACTIONS = [
  {
    labelKey: 'qmPrint' as MessageKey,
    icon: <IconPrinter />,
    bg: '#fff7f4',
    darkBg: '#392720',
    color: '#e06a4d',
    darkColor: '#ff9a7f',
    onClick: printPage,
  },
  {
    labelKey: 'qmTranslate' as MessageKey,
    icon: <IconTranslate />,
    bg: '#f3f7ff',
    darkBg: '#202d49',
    color: '#3b6fe8',
    darkColor: '#8fb0ff',
    onClick: translatePage,
  },
  {
    labelKey: 'shellScreenshot' as MessageKey,
    icon: <IconCamera />,
    bg: '#effaf8',
    darkBg: '#1c322e',
    color: '#2a9a79',
    darkColor: '#75d1b5',
    onClick: openScreenshot,
  },
  {
    labelKey: 'sysPasswords' as MessageKey,
    icon: <IconPassword />,
    bg: '#fff8e8',
    darkBg: '#392f1d',
    color: '#c98312',
    darkColor: '#e7b15a',
    onClick: openPasswordSettings,
  },
];

// 缩放：菜单显示时拉取当前标签页缩放，+/- 即时调整并同步显示
const useZoom = () => {
  const [zoom, setZoom] = React.useState(1);

  React.useEffect(() => {
    if (!store.visible) return;
    ipcRenderer
      .invoke(`get-selected-zoom-${store.windowId}`)
      .then((z: number) => {
        if (typeof z === 'number') setZoom(z);
      })
      .catch(() => {});
  }, [store.visible]);

  React.useEffect(() => {
    const listener = (_e: Electron.IpcRendererEvent, factor: number) => {
      if (typeof factor === 'number') setZoom(factor);
    };
    ipcRenderer.on('zoom-factor-updated', listener);
    return () => {
      ipcRenderer.removeListener('zoom-factor-updated', listener);
    };
  }, []);

  const zoomIn = () => ipcRenderer.send('change-zoom', 'in', false);
  const zoomOut = () => ipcRenderer.send('change-zoom', 'out', false);

  return { zoom, zoomIn, zoomOut };
};

// 当前选中标签页 URL:菜单每次显示时拉取一次,用于判断「安装为 PWA」是否可用
// (仅 http(s)/file 页面可安装;内部页 yjllq://、chrome-extension:// 等禁用)。
const useSelectedUrl = () => {
  const [url, setUrl] = React.useState('');
  React.useEffect(() => {
    if (!store.visible) return;
    ipcRenderer
      .invoke(`get-selected-url-${store.windowId}`)
      .then((u: string) => {
        if (typeof u === 'string') setUrl(u);
      })
      .catch(() => {});
  }, [store.visible]);
  return url;
};

export const QuickMenu = observer(() => {
  const t = useI18n();
  const { zoom, zoomIn, zoomOut } = useZoom();
  const selectedUrl = useSelectedUrl();
  // 仅 http(s)/file 页面可安装为 PWA;其余页面(内部页、扩展页等)禁用并置灰。
  const canInstallPwa = /^(https?|file):\/\//i.test(selectedUrl);
  const [profileData, setProfileData] = React.useState<IProfilesPayload>({
    currentProfile: null,
    profiles: [],
  });
  const [createOpen, setCreateOpen] = React.useState(false);
  const [profileName, setProfileName] = React.useState('');
  const [cloneData, setCloneData] = React.useState(EMPTY_CLONE_DATA);
  const [profileError, setProfileError] = React.useState('');
  const [profileBusy, setProfileBusy] = React.useState(false);
  const [moreProfile, setMoreProfile] = React.useState<string | null>(null);
  const [deleteProfile, setDeleteProfile] = React.useState<IProfileInfo | null>(
    null,
  );
  const [profileListError, setProfileListError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [cookieOpen, setCookieOpen] = React.useState(false);
  const [cookieText, setCookieText] = React.useState('');
  const [cookieError, setCookieError] = React.useState('');
  const [cookieBusy, setCookieBusy] = React.useState(false);
  const avatarLongPressTimer = React.useRef<number | null>(null);
  const avatarLongPressTriggered = React.useRef(false);

  const refreshProfiles = React.useCallback(async () => {
    try {
      const payload = (await ipcRenderer.invoke(
        'profiles-list',
      )) as IProfilesPayload;
      if (payload?.ok === false) {
        // 扫描失败不能当成“没有小号”，否则一次瞬时 D 盘 I/O 错误会把
        // 整个列表隐藏。保留上次成功结果，待下次打开面板自动重试。
        setProfileListError(
          payload.error
            ? t('qmProfileListFailed', {error: payload.error})
            : t('qmProfileListFailedPlain'),
        );
        return;
      }
      if (!payload || !Array.isArray(payload.profiles)) {
        setProfileListError(t('qmProfileListFailedFormat'));
        return;
      }
      setProfileData(payload);
      setProfileListError('');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setProfileListError(
        message
          ? t('qmProfileListFailed', {error: message})
          : t('qmProfileListFailedPlain'),
      );
    }
  }, []);

  React.useEffect(() => {
    if (!store.visible) return;
    setMoreProfile(null);
    refreshProfiles();
  }, [store.visible, refreshProfiles]);

  React.useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  React.useEffect(() => {
    if (!createOpen && !deleteProfile && !cookieOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || profileBusy || cookieBusy) return;
      setCreateOpen(false);
      setDeleteProfile(null);
      setCookieOpen(false);
      setProfileError('');
      setCookieError('');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [createOpen, deleteProfile, profileBusy, cookieOpen, cookieBusy]);

  React.useEffect(
    () => () => {
      if (avatarLongPressTimer.current !== null) {
        window.clearTimeout(avatarLongPressTimer.current);
      }
    },
    [],
  );

  const cancelAvatarLongPress = () => {
    if (avatarLongPressTimer.current !== null) {
      window.clearTimeout(avatarLongPressTimer.current);
      avatarLongPressTimer.current = null;
    }
  };

  const startAvatarLongPress = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    cancelAvatarLongPress();
    avatarLongPressTriggered.current = false;
    avatarLongPressTimer.current = window.setTimeout(() => {
      avatarLongPressTimer.current = null;
      avatarLongPressTriggered.current = true;
      setCookieText('');
      setCookieError('');
      setCookieOpen(true);
    }, AVATAR_LONG_PRESS_MS);
  };

  const handleAvatarClick = (event: React.MouseEvent) => {
    if (avatarLongPressTriggered.current) {
      avatarLongPressTriggered.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
  };

  // (开源版)普通点击不再打开登录窗,仅长按进入 Cookie 设置。

  const submitCookie = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!cookieText.trim() || cookieBusy) {
      if (!cookieText.trim()) setCookieError(t('qmCookieRequired'));
      return;
    }
    setCookieBusy(true);
    setCookieError('');
    try {
      const result = (await ipcRenderer.invoke(
        'quickmenu-set-cookie',
        cookieText,
      )) as IProfileResult;
      if (!result?.ok) {
        setCookieError(result?.message || t('qmCookieInvalid'));
        return;
      }
      setCookieOpen(false);
      store.hide();
    } catch {
      setCookieError(t('qmCookieSetFailed'));
    } finally {
      setCookieBusy(false);
    }
  };

  const openCreate = () => {
    setProfileName('');
    setCloneData(EMPTY_CLONE_DATA);
    setProfileError('');
    setMoreProfile(null);
    setCreateOpen(true);
  };

  const createProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (profileBusy) return;
    setProfileBusy(true);
    setProfileError('');
    try {
      const result = (await ipcRenderer.invoke(
        'profiles-create',
        profileName,
        { cloneData },
      )) as IProfileResult;
      if (!result?.ok) {
        setProfileError(result?.message || t('qmCreateFailed'));
        return;
      }
      setCreateOpen(false);
      await refreshProfiles();
      store.hide();
    } catch {
      setProfileError(t('qmCreateFailed'));
    } finally {
      setProfileBusy(false);
    }
  };

  const openProfile = async (profile: IProfileInfo) => {
    if (profile.current) return;
    setMoreProfile(null);
    try {
      const result = (await ipcRenderer.invoke(
        'profiles-open',
        profile.name,
      )) as IProfileResult;
      if (!result?.ok) setNotice(result?.message || t('qmOpenFailed'));
      else store.hide();
    } catch {
      setNotice(t('qmOpenFailed'));
    }
  };

  const createShortcut = async (profile: IProfileInfo) => {
    setMoreProfile(null);
    try {
      const result = (await ipcRenderer.invoke(
        `profile-shortcut-open-${store.windowId}`,
        profile.name,
      )) as IProfileResult;
      if (!result?.ok) {
        setNotice(result?.message || t('qmShortcutFailed'));
      }
    } catch {
      setNotice(t('qmShortcutFailed'));
    }
  };

  const requestDelete = (profile: IProfileInfo) => {
    setMoreProfile(null);
    if (profile.running) {
      setNotice(t('qmDeleteRunning'));
      return;
    }
    setDeleteProfile(profile);
  };

  const confirmDelete = async () => {
    if (!deleteProfile || profileBusy) return;
    setProfileBusy(true);
    try {
      const result = (await ipcRenderer.invoke(
        'profiles-delete',
        deleteProfile.name,
      )) as IProfileResult;
      setNotice(
        result?.message ||
          (result?.ok ? t('qmDeleted') : t('qmDeleteFailed')),
      );
      if (result?.ok) {
        setDeleteProfile(null);
        await refreshProfiles();
      }
    } catch {
      setNotice(t('qmDeleteFailed'));
    } finally {
      setProfileBusy(false);
    }
  };

  return (
    <Root>
      <Header>
        <HeaderInfo>
          <Avatar
            onClick={handleAvatarClick}
            onPointerDown={startAvatarLongPress}
            onPointerUp={cancelAvatarLongPress}
            onPointerCancel={cancelAvatarLongPress}
            onPointerLeave={cancelAvatarLongPress}
            title="本地浏览器"
          >
            <IconUser />
          </Avatar>
          <div>
            <HeaderName>本地浏览器</HeaderName>
            <HeaderSub>
              {profileData.currentProfile
                ? `小号 · ${profileData.currentProfile}`
                : '本地优先 · 无账号'}
            </HeaderSub>
          </div>
        </HeaderInfo>
        <HeaderActions>
          <RoundButton onClick={openShareDialog} title={t('qmSharePage')}>
            <IconShare />
          </RoundButton>
          <RoundButton onClick={goToWebUIPage('settings')}>
            <IconSettings />
          </RoundButton>
        </HeaderActions>
      </Header>

      <TileGrid>
        {TILES.map((tile) => (
          <Tile key={tile.labelKey} onClick={tile.onClick || undefined}>
            <TileIcon className="tile-icon" bg={tile.bg} darkBg={tile.darkBg}>
              {tile.icon}
            </TileIcon>
            <TileLabel>{t(tile.labelKey)}</TileLabel>
          </Tile>
        ))}
      </TileGrid>

      <ListPanel>
        <ListGroup>
          {NEW_ITEMS.map((it) => (
            <Row key={it.labelKey} onClick={it.onClick}>
              <RowIcon
                bg={it.bg}
                darkBg={it.darkBg}
                color={it.color}
                darkColor={it.darkColor}
              >
                {it.icon}
              </RowIcon>
              <RowLabel>{t(it.labelKey)}</RowLabel>
              <RowCaret>
                <IconCaretRight />
              </RowCaret>
            </Row>
          ))}

          <Row onClick={openCreate}>
            <RowIcon
              bg="#fff3e8"
              darkBg="#3a2b1f"
              color="#c86f22"
              darkColor="#f1a45f"
            >
              <IconUserPlus />
            </RowIcon>
            <RowLabel>{t('qmNewAlt')}</RowLabel>
            <RowCaret>
              <IconCaretRight />
            </RowCaret>
          </Row>

          {profileListError && (
            <InlineNotice data-error="true" role="alert" aria-live="assertive">
              {profileListError}
            </InlineNotice>
          )}

          {profileData.profiles.length > 0 && (
            <>
              <SectionTitle>
                <span>{t('qmAltSection')}</span>
                <span>{profileData.profiles.length}</span>
              </SectionTitle>
              {profileData.profiles.map((profile) => (
                <ProfileRowWrap key={profile.name}>
                  <ProfileRow
                    role="button"
                    tabIndex={0}
                    onClick={() => openProfile(profile)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openProfile(profile);
                      }
                    }}
                  >
                    <RowIcon
                      bg="#edf7f4"
                      darkBg="#20332f"
                      color="#24866b"
                      darkColor="#76d0b5"
                    >
                      <IconProfile />
                    </RowIcon>
                    <ProfileMeta>
                      <ProfileName title={profile.name}>
                        {profile.name}
                      </ProfileName>
                      {profile.current ? (
                        <StatusBadge>{t('qmCurrent')}</StatusBadge>
                      ) : profile.running ? (
                        <StatusBadge>{t('qmRunning')}</StatusBadge>
                      ) : null}
                    </ProfileMeta>
                    <MoreButton
                      aria-label={t('qmMoreAria', {name: profile.name})}
                      title={t('qmMore')}
                      onClick={(event) => {
                        event.stopPropagation();
                        setMoreProfile(
                          moreProfile === profile.name ? null : profile.name,
                        );
                      }}
                    >
                      <IconMore />
                    </MoreButton>
                  </ProfileRow>
                  {moreProfile === profile.name && (
                    <MoreMenu onClick={(event) => event.stopPropagation()}>
                      <MoreMenuItem onClick={() => createShortcut(profile)}>
                        <IconDesktop />
                        {t('qmAddToDesktop')}
                      </MoreMenuItem>
                      <MoreMenuItem
                        data-danger="true"
                        onClick={() => requestDelete(profile)}
                      >
                        <IconTrash />
                        {t('delete')}
                      </MoreMenuItem>
                    </MoreMenu>
                  )}
                </ProfileRowWrap>
              ))}
            </>
          )}
          {notice && <InlineNotice>{notice}</InlineNotice>}
        </ListGroup>

        <Divider />

        <ListGroup>
          <ZoomBar>
            <ZoomIcon>
              <IconZoom />
            </ZoomIcon>
            <ZoomLabel>{t('qmZoom')}</ZoomLabel>
            <ZoomControls>
              <ZoomButton aria-label={t('qmZoomOut')} onClick={zoomOut}>
                <IconMinus />
              </ZoomButton>
              <ZoomValue>{(zoom * 100).toFixed(0)}%</ZoomValue>
              <ZoomButton aria-label={t('qmZoomIn')} onClick={zoomIn}>
                <IconPlus size={12} />
              </ZoomButton>
            </ZoomControls>
          </ZoomBar>

          <ActionGrid>
            {ACTIONS.map((a) => (
              <ActionTile
                key={a.labelKey}
                bg={a.bg}
                darkBg={a.darkBg}
                onClick={a.onClick || undefined}
                style={a.onClick ? undefined : { opacity: 0.5 }}
              >
                <ActionIcon color={a.color} darkColor={a.darkColor}>
                  {a.icon}
                </ActionIcon>
                <ActionLabel>{t(a.labelKey)}</ActionLabel>
              </ActionTile>
            ))}
          </ActionGrid>

          <Row style={{ marginTop: 10 }} onClick={findInPage}>
            <RowIcon
              bg="#eef2ff"
              darkBg="#202b46"
              color="#3357f6"
              darkColor="#8ba5ff"
            >
              <IconFind />
            </RowIcon>
            <RowLabel>{t('qmFind')}</RowLabel>
            <RowCaret>
              <IconCaretRight />
            </RowCaret>
          </Row>

          <Row
            style={{ marginTop: 10 }}
            disabled={!canInstallPwa}
            onClick={installPwa}
            title={
              canInstallPwa
                ? t('qmInstallPwa')
                : t('qmInstallPwaDisabled')
            }
          >
            <RowIcon
              bg="#eef2ff"
              darkBg="#202b46"
              color="#3357f6"
              darkColor="#8ba5ff"
            >
              <IconAppWindow />
            </RowIcon>
            <RowLabel>{t('qmInstallPwa')}</RowLabel>
            <RowCaret>
              <IconCaretRight />
            </RowCaret>
          </Row>

          <Row style={{ marginTop: 10 }} onClick={toggleTheme}>
            <RowIcon
              bg="#efeaff"
              darkBg="#2a2548"
              color="#6470e8"
              darkColor="#9aa3ff"
            >
              <IconMoon />
            </RowIcon>
            <RowLabel>{t('qmDarkMode')}</RowLabel>
            <Switch value={store.settings.theme === 'wexond-dark'} />
          </Row>

          <Row style={{ marginTop: 10 }} onClick={openGithubRepo}>
            <RowIcon
              bg="#eef2ff"
              darkBg="#202b46"
              color="#4960e6"
              darkColor="#8ba5ff"
            >
              <IconQuestion />
            </RowIcon>
            <RowLabel>{t('qmHelpFeedback')}</RowLabel>
            <RowCaret>
              <IconCaretRight />
            </RowCaret>
          </Row>
        </ListGroup>
      </ListPanel>

      {createOpen && (
        <ModalOverlay onMouseDown={() => !profileBusy && setCreateOpen(false)}>
          <Modal onMouseDown={(event) => event.stopPropagation()}>
            <form onSubmit={createProfile}>
              <ModalHeader>
                <span>{t('qmNewAlt')}</span>
                <ModalClose
                  type="button"
                  aria-label={t('close')}
                  onClick={() => !profileBusy && setCreateOpen(false)}
                >
                  <IconClose />
                </ModalClose>
              </ModalHeader>
              <ProfileInput
                autoFocus
                value={profileName}
                placeholder={t('qmWindowNamePlaceholder')}
                disabled={profileBusy}
                onChange={(event) => {
                  setProfileName(event.target.value);
                  setProfileError('');
                }}
              />
              <ProfileHint>{t('qmAltHint')}</ProfileHint>
              <CloneSection>
                <CloneSectionTitle>{t('qmCloneData')}</CloneSectionTitle>
                <CloneOptionsGrid>
                  {CLONE_DATA_OPTIONS.map((option) => (
                    <CloneOption key={option.key}>
                      <CloneCheckbox
                        type="checkbox"
                        checked={cloneData[option.key]}
                        disabled={profileBusy}
                        onChange={(event) =>
                          setCloneData((current) => ({
                            ...current,
                            [option.key]: event.target.checked,
                          }))
                        }
                      />
                      <CloneOptionLabel>{t(option.labelKey)}</CloneOptionLabel>
                    </CloneOption>
                  ))}
                </CloneOptionsGrid>
              </CloneSection>
              <ModalMessage>{profileError}</ModalMessage>
              <ModalActions>
                <ModalButton
                  type="button"
                  disabled={profileBusy}
                  onClick={() => setCreateOpen(false)}
                >
                  {t('cancel')}
                </ModalButton>
                <ModalButton
                  type="submit"
                  data-primary="true"
                  disabled={profileBusy}
                >
                  {profileBusy ? t('qmCreating') : t('qmCreate')}
                </ModalButton>
              </ModalActions>
            </form>
          </Modal>
        </ModalOverlay>
      )}

      {cookieOpen && (
        <ModalOverlay onMouseDown={() => !cookieBusy && setCookieOpen(false)}>
          <Modal onMouseDown={(event) => event.stopPropagation()}>
            <form onSubmit={submitCookie}>
              <ModalHeader>
                <span>{t('qmSetCookie')}</span>
                <ModalClose
                  type="button"
                  aria-label={t('close')}
                  onClick={() => !cookieBusy && setCookieOpen(false)}
                >
                  <IconClose />
                </ModalClose>
              </ModalHeader>
              <ProfileInput
                autoFocus
                value={cookieText}
                placeholder="Cookie JSON"
                disabled={cookieBusy}
                onChange={(event) => {
                  setCookieText(event.target.value);
                  setCookieError('');
                }}
              />
              <ModalMessage>{cookieError}</ModalMessage>
              <ModalActions>
                <ModalButton
                  type="button"
                  disabled={cookieBusy}
                  onClick={() => setCookieOpen(false)}
                >
                  {t('cancel')}
                </ModalButton>
                <ModalButton
                  type="submit"
                  data-primary="true"
                  disabled={cookieBusy}
                >
                  {cookieBusy ? t('qmSetting') : t('settings')}
                </ModalButton>
              </ModalActions>
            </form>
          </Modal>
        </ModalOverlay>
      )}

      {deleteProfile && (
        <ModalOverlay
          onMouseDown={() => !profileBusy && setDeleteProfile(null)}
        >
          <Modal onMouseDown={(event) => event.stopPropagation()}>
            <ModalHeader>
              <span>{t('qmDeleteTitle')}</span>
              <ModalClose
                type="button"
                aria-label={t('close')}
                onClick={() => !profileBusy && setDeleteProfile(null)}
              >
                <IconClose />
              </ModalClose>
            </ModalHeader>
            <ConfirmText>
              {t('qmDeleteConfirm', {name: deleteProfile.name})}
            </ConfirmText>
            <ModalActions>
              <ModalButton
                type="button"
                disabled={profileBusy}
                onClick={() => setDeleteProfile(null)}
              >
                {t('cancel')}
              </ModalButton>
              <ModalButton
                type="button"
                data-danger="true"
                disabled={profileBusy}
                onClick={confirmDelete}
              >
                {profileBusy ? t('qmDeleting') : t('delete')}
              </ModalButton>
            </ModalActions>
          </Modal>
        </ModalOverlay>
      )}
    </Root>
  );
});
