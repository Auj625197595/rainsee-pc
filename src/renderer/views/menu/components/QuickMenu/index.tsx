import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ipcRenderer } from 'electron';

import {
  Root,
  Header,
  HeaderInfo,
  Avatar,
  AvatarImg,
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
} from './style';
import store from '../../store';
import { getWebUIURL } from '~/common/webui';
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
} from './icons';

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

const openGithubRepo = () =>
  addNewTab('https://www.zhso.org/t/t-493c6d6c6e?node=11');

// 顶部四宫格
const TILES = [
  {
    label: '拓展',
    icon: <IconExtension />,
    bg: '#1a1a1a',
    darkBg: '#2b3348',
    onClick: goToWebUIPage('extensions'),
  },
  {
    label: '书签',
    icon: <IconBookmark />,
    bg: '#eef2ff',
    darkBg: '#25304c',
    onClick: goToWebUIPage('bookmarks'),
  },
  {
    label: '下载',
    icon: <IconDownload />,
    bg: '#eef0ff',
    darkBg: '#233148',
    onClick: goToWebUIPage('downloads'),
  },
  {
    label: '历史',
    icon: <IconHistory />,
    bg: '#f6eefe',
    darkBg: '#312644',
    onClick: goToWebUIPage('history'),
  },
];

// 列表区：新建相关
const NEW_ITEMS = [
  {
    label: '新建标签页',
    icon: <IconPlusSquare />,
    bg: '#eef2ff',
    darkBg: '#202b46',
    color: '#3357f6',
    darkColor: '#8ba5ff',
    onClick: newTab,
  },
  {
    label: '新建窗口',
    icon: <IconBrowser />,
    bg: '#eaf9f3',
    darkBg: '#1d332c',
    color: '#1d9a6d',
    darkColor: '#7ad6b2',
    onClick: newWindow,
  },
  {
    label: '新建无痕窗口',
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
    label: '打印',
    icon: <IconPrinter />,
    bg: '#fff7f4',
    darkBg: '#392720',
    color: '#e06a4d',
    darkColor: '#ff9a7f',
    onClick: printPage,
  },
  {
    label: '翻译',
    icon: <IconTranslate />,
    bg: '#f3f7ff',
    darkBg: '#202d49',
    color: '#3b6fe8',
    darkColor: '#8fb0ff',
    onClick: translatePage,
  },
  {
    label: '截图',
    icon: <IconCamera />,
    bg: '#effaf8',
    darkBg: '#1c322e',
    color: '#2a9a79',
    darkColor: '#75d1b5',
    onClick: openScreenshot,
  },
  {
    label: '密码',
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
    ipcRenderer
      .invoke(`get-selected-zoom-${store.windowId}`)
      .then((z: number) => {
        if (typeof z === 'number') setZoom(z);
      })
      .catch(() => {});

    const listener = (e: Electron.IpcRendererEvent, factor: number) => {
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

export const QuickMenu = observer(() => {
  const { zoom, zoomIn, zoomOut } = useZoom();

  return (
    <Root>
      <Header>
        <HeaderInfo>
          <Avatar title="雨见桌面端">
            <IconUser />
          </Avatar>
          <div>
            <HeaderName>雨见桌面端</HeaderName>
            <HeaderSub>开源版</HeaderSub>
          </div>
        </HeaderInfo>
        <HeaderActions>
          <RoundButton onClick={openShareDialog} title="分享网页">
            <IconShare />
          </RoundButton>
          <RoundButton onClick={goToWebUIPage('settings')}>
            <IconSettings />
          </RoundButton>
        </HeaderActions>
      </Header>

      <TileGrid>
        {TILES.map((t) => (
          <Tile key={t.label} onClick={t.onClick || undefined}>
            <TileIcon className="tile-icon" bg={t.bg} darkBg={t.darkBg}>
              {t.icon}
            </TileIcon>
            <TileLabel>{t.label}</TileLabel>
          </Tile>
        ))}
      </TileGrid>

      <ListPanel>
        <ListGroup>
          {NEW_ITEMS.map((it) => (
            <Row key={it.label} onClick={it.onClick}>
              <RowIcon
                bg={it.bg}
                darkBg={it.darkBg}
                color={it.color}
                darkColor={it.darkColor}
              >
                {it.icon}
              </RowIcon>
              <RowLabel>{it.label}</RowLabel>
              <RowCaret>
                <IconCaretRight />
              </RowCaret>
            </Row>
          ))}
        </ListGroup>

        <Divider />

        <ListGroup>
          <ZoomBar>
            <ZoomIcon>
              <IconZoom />
            </ZoomIcon>
            <ZoomLabel>缩放</ZoomLabel>
            <ZoomControls>
              <ZoomButton aria-label="缩小" onClick={zoomOut}>
                <IconMinus />
              </ZoomButton>
              <ZoomValue>{(zoom * 100).toFixed(0)}%</ZoomValue>
              <ZoomButton aria-label="放大" onClick={zoomIn}>
                <IconPlus size={12} />
              </ZoomButton>
            </ZoomControls>
          </ZoomBar>

          <ActionGrid>
            {ACTIONS.map((a) => (
              <ActionTile
                key={a.label}
                bg={a.bg}
                darkBg={a.darkBg}
                onClick={a.onClick || undefined}
                style={a.onClick ? undefined : { opacity: 0.5 }}
              >
                <ActionIcon color={a.color} darkColor={a.darkColor}>
                  {a.icon}
                </ActionIcon>
                <ActionLabel>{a.label}</ActionLabel>
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
            <RowLabel>查找</RowLabel>
            <RowCaret>
              <IconCaretRight />
            </RowCaret>
          </Row>

          <Row style={{ marginTop: 10 }} onClick={installPwa}>
            <RowIcon
              bg="#eef2ff"
              darkBg="#202b46"
              color="#3357f6"
              darkColor="#8ba5ff"
            >
              <IconAppWindow />
            </RowIcon>
            <RowLabel>安装为 PWA</RowLabel>
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
            <RowLabel>暗色模式</RowLabel>
            <Switch value={store.settings.theme === 'wexond-dark'} />
          </Row>

          <Row
            style={{ marginTop: 10 }}
            onClick={openGithubRepo}
          >
            <RowIcon
              bg="#eef2ff"
              darkBg="#202b46"
              color="#4960e6"
              darkColor="#8ba5ff"
            >
              <IconQuestion />
            </RowIcon>
            <RowLabel>帮助与反馈</RowLabel>
            <RowCaret>
              <IconCaretRight />
            </RowCaret>
          </Row>
        </ListGroup>
      </ListPanel>
    </Root>
  );
});
