import { observer } from 'mobx-react-lite';
import * as React from 'react';
import * as remote from '@electron/remote';
import { ipcRenderer, nativeImage } from 'electron';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CopySimple,
  Folders,
  Globe,
  Toolbox,
  ArrowsClockwise,
} from '@phosphor-icons/react';

import { SwitcherButton } from './style';
import store from '../../store';
import { TabsLayout } from '~/interfaces';
import { getCurrentWindow } from '../../utils/windows';
import { useActionBubble } from '../../utils/action-bubble';
import { getShellTranslator } from '../../utils/i18n';
import { buildRecentlyClosedTabsMenu } from '../RecentlyClosedTabs';
import type { MessageKey, Translator } from '~/common/i18n';
import {
  deduplicateTabs,
  groupTabsByDomain,
  OrganizeResult,
} from '../../utils/tab-organizer';

interface Props {
  // visual variant: 'tab' sits at the end of the top tab strip,
  // 'bar' sits inside a toolbar/right-buttons group.
  variant?: 'tab' | 'bar';
}

// hover → 弹出菜单的延迟(与 TabGroup 悬停预览一致),防止鼠标快速划过时误触。
const HOVER_OPEN_DELAY = 250;
// 菜单关闭后这段时间内不因 hover 重新弹出:选完项 / 按 Esc 关菜单后,鼠标若
// 还停留在按钮上(或刚离开又回来),避免立刻又弹一次。
const REPOP_COOLDOWN = 350;

const resultMessage = (
  action: MessageKey,
  result: OrganizeResult,
  t: Translator,
) => {
  if (result.tabs === 0)
    return t('lsResultNone', { action: t(action) });
  if (result.groups === 0)
    return t('lsResultTabs', { action: t(action), count: result.tabs });
  return t('lsResultGroups', {
    action: t(action),
    count: result.tabs,
    groups: result.groups,
  });
};

const menuIconCache = new Map<string, Promise<Electron.NativeImage>>();

const menuIcon = (
  name: string,
  IconComponent: React.ComponentType<any>,
): Promise<Electron.NativeImage> => {
  const theme = remote.nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  const key = `${theme}:${name}`;
  const cached = menuIconCache.get(key);
  if (cached) return cached;

  const color = theme === 'dark' ? '#e3e3e3' : '#1c1c1c';
  const svg = renderToStaticMarkup(
    React.createElement(IconComponent, {
      size: 16,
      color,
      weight: 'regular',
    }),
  );
  const task = new Promise<Electron.NativeImage>((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 16;
      const context = canvas.getContext('2d');
      if (!context) {
        resolve(nativeImage.createEmpty());
        return;
      }
      context.drawImage(image, 0, 0, 16, 16);
      resolve(nativeImage.createFromDataURL(canvas.toDataURL('image/png')));
    };
    image.onerror = () => resolve(nativeImage.createEmpty());
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  menuIconCache.set(key, task);
  return task;
};

// 读取某整理动作「当前生效」的 accelerator(用户改键后跟随),回退注册表默认。
// id / defaults 与 src/main/menus/shortcut-actions.ts 逐字一致;Electron 菜单会把
// CmdOrCtrl 在 Windows 上格式化成 Ctrl 显示,与主菜单隐藏项实际生效的绑定一致。
const resolveOrganizeAccel = (id: string, defaults: string[]): string => {
  const overrides = store.settings?.object?.shortcuts;
  if (overrides && Array.isArray(overrides[id]) && overrides[id].length > 0) {
    return overrides[id][0];
  }
  return defaults[0];
};

const buildMenu = (
  current: TabsLayout,
  run: (
    action: MessageKey,
    task: () => OrganizeResult | Promise<OrganizeResult>,
  ) => void,
  icons: {
    layout: Electron.NativeImage;
    organize: Electron.NativeImage;
    top: Electron.NativeImage;
    left: Electron.NativeImage;
    right: Electron.NativeImage;
    deduplicate: Electron.NativeImage;
    domain: Electron.NativeImage;
  },
  recentlyClosed: Electron.MenuItemConstructorOptions,
) => {
  const t = getShellTranslator();
  const item = (value: TabsLayout, labelKey: MessageKey) => ({
    label: t(labelKey),
    type: 'radio' as const,
    checked: current === value,
    click: () => store.settings.setTabsLayout(value),
  });

  return remote.Menu.buildFromTemplate([
    recentlyClosed,
    { type: 'separator' },
    {
      label: t('lsMoveTabs'),
      icon: icons.layout,
      submenu: [
        { ...item('top', 'lsTop'), icon: icons.top },
        { ...item('left', 'lsLeft'), icon: icons.left },
        { ...item('right', 'lsRight'), icon: icons.right },
      ],
    },
    {
      label: t('lsOrganize'),
      icon: icons.organize,
      submenu: [
        {
          label: t('lsDeduplicate'),
          icon: icons.deduplicate,
          accelerator: resolveOrganizeAccel('deduplicate-tabs', [
            'CmdOrCtrl+Shift+D',
          ]),
          click: () => run('lsDeduplicate', deduplicateTabs),
        },
        {
          label: t('lsGroupByDomain'),
          icon: icons.domain,
          accelerator: resolveOrganizeAccel('group-tabs-by-domain', [
            'CmdOrCtrl+Shift+G',
          ]),
          click: () => run('lsGroupByDomain', groupTabsByDomain),
        },
      ],
    },
  ]);
};

export const LayoutSwitcher = observer(({ variant = 'bar' }: Props) => {
  const t = getShellTranslator();
  const { show: showBubble, portal: bubblePortal } = useActionBubble(1800);
  const buttonRef = React.useRef<HTMLDivElement>(null);

  // 把「执行整理动作 + 弹反馈气泡」抽出来供两处复用:
  //   1) 工具箱弹出菜单点击(锚点 = 被点击的按钮);
  //   2) 主菜单隐藏项的快捷键 IPC(锚点 = 工具箱按钮 ref)。
  const runWithAnchor = React.useCallback(
    async (
      anchor: Element | null,
      action: MessageKey,
      task: () => OrganizeResult | Promise<OrganizeResult>,
    ) => {
      if (!anchor) return;
      const t = getShellTranslator();
      if (action === 'lsAiGroup') showBubble(t('lsAiWorking'), anchor);
      try {
        const result = await task();
        showBubble(resultMessage(action, result, t), anchor);
      } catch {
        showBubble(t('lsUnavailable', { action: t(action) }), anchor);
      }
    },
    [showBubble],
  );

  // 快捷键:主菜单的隐藏菜单项通过 organize-tabs IPC 把动作名转发到这里,
  // 复用菜单点击的同套执行 + 反馈气泡(气泡锚到工具箱按钮)。
  React.useEffect(() => {
    const handler = (_e: unknown, action: string) => {
      if (action === 'deduplicate') {
        runWithAnchor(buttonRef.current, 'lsDeduplicate', deduplicateTabs);
      } else if (action === 'domain') {
        runWithAnchor(buttonRef.current, 'lsGroupByDomain', groupTabsByDomain);
        runWithAnchor(buttonRef.current, 'lsAiGroup', groupTabsWithAi);
      }
    };
    ipcRenderer.on('organize-tabs', handler);
    return () => {
      ipcRenderer.removeListener('organize-tabs', handler);
    };
  }, [runWithAnchor]);

  // 悬停打开定时器 + 防重弹时间戳:菜单关闭后(lastPopAt 已记录)REPOP_COOLDOWN
  // 内不再因 hover 弹出,避免鼠标在按钮上抖动 / 刚关菜单又回来时反复弹。
  const openTimer = React.useRef<any>(null);
  const lastPopAt = React.useRef(0);

  const doPopup = React.useCallback(
    async (anchor: Element) => {
      const run = (
        action: string,
        task: () => OrganizeResult | Promise<OrganizeResult>,
      ) => runWithAnchor(anchor, action, task);

      const [
        layout,
        organize,
        top,
        left,
        right,
        deduplicate,
        domain,
        recentlyClosed,
      ] = await Promise.all([
        menuIcon('layout', ArrowsClockwise),
        menuIcon('organize', Folders),
        menuIcon('top', ArrowUp),
        menuIcon('left', ArrowLeft),
        menuIcon('right', ArrowRight),
        menuIcon('deduplicate', CopySimple),
        menuIcon('domain', Globe),
        buildRecentlyClosedTabsMenu(),
      ]);

      buildMenu(
        store.tabsLayout,
        run,
        {
          layout,
          organize,
          top,
          left,
          right,
          deduplicate,
          domain,
        },
        recentlyClosed,
      ).popup({
        window: getCurrentWindow(),
      });
      lastPopAt.current = Date.now();
    },
    [runWithAnchor],
  );

  // 悬停即弹(带延迟);点击仍可立即触发(取消延迟直接弹)。原生菜单是模态的,
  // 弹出期间按钮收不到鼠标事件,故点击与 hover 不会重复弹。
  const onMouseEnter = (e: React.MouseEvent) => {
    if (Date.now() - lastPopAt.current < REPOP_COOLDOWN) return;
    clearTimeout(openTimer.current);
    openTimer.current = setTimeout(
      () => doPopup(e.currentTarget),
      HOVER_OPEN_DELAY,
    );
  };

  const onMouseLeave = () => {
    clearTimeout(openTimer.current);
  };

  const onMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    clearTimeout(openTimer.current);
    doPopup(e.currentTarget);
  };

  React.useEffect(() => () => clearTimeout(openTimer.current), []);

  return (
    <>
      <SwitcherButton
        ref={buttonRef}
        data-rainsee-part="toolbar-button"
        data-rainsee-action="tab-tools"
        variant={variant}
        title={t('lsToolboxTitle')}
        onMouseDown={onMouseDown}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <Toolbox size={18} weight="bold" />
      </SwitcherButton>
      {bubblePortal}
    </>
  );
});
