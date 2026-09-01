import { Menu, webContents, app, BrowserWindow, MenuItem } from 'electron';
import { viewSource, saveAs, printPage } from './common-actions';
import { WEBUI_BASE_URL, WEBUI_URL_SUFFIX } from '~/constants/files';
import { AppWindow } from '../windows';
import { Application } from '../application';
import { getWebUIURL } from '~/common/webui-main';
import { normalizeBookmarkBarDisplay } from '~/common/bookmark-bar';
import { getShortcutActionLabel } from './shortcut-actions';
import { getMainTranslator } from '../i18n';

const isMac = process.platform === 'darwin';

const getTranslator = () => {
  return getMainTranslator(
    Application.instance.settings?.object?.language,
  );
};

const createMenuItem = (
  shortcuts: string[],
  action: (
    window: AppWindow,
    menuItem: MenuItem,
    shortcutIndex: number,
  ) => void,
  label: string = null,
  // 可选:动作在 settings.shortcuts 里的稳定 id。传入后,若用户为该 id 配置过
  // 自定义 accelerator 数组,则用覆盖数组构建菜单项(实现「设置-快捷键」的改键);
  // 否则沿用传入的默认 shortcuts。id 仅用于读取覆盖,不影响菜单结构/顺序/可见性。
  // id 取值见 src/main/menus/shortcut-actions.ts。
  id?: string,
) => {
  const overrides = Application.instance.settings?.object?.shortcuts;
  const accels =
    id && overrides && Array.isArray(overrides[id]) && overrides[id].length > 0
      ? overrides[id]
      : shortcuts;

  const result: any = accels.map((shortcut, key) => ({
    accelerator: shortcut,
    visible: label != null && key === 0,
    label: label != null && key === 0 ? label : '',
    click: (menuItem: MenuItem, browserWindow: BrowserWindow) =>
      action(
        Application.instance.windows.list.find(
          (x) => x.win.id === browserWindow.id,
        ),
        menuItem,
        key,
      ),
  }));

  return result;
};

export const getMainMenu = () => {
  const t = getTranslator();
  const actionLabel = (id: string) => getShortcutActionLabel(id, t);
  const template: any = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about', label: t('menuAbout', { appName: app.name }) },
              { type: 'separator' },
              { role: 'services', label: t('menuServices') },
              { type: 'separator' },
              { role: 'hide', label: t('menuHideApp', { appName: app.name }) },
              { role: 'hideothers', label: t('menuHideOthers') },
              { role: 'unhide', label: t('menuShowAll') },
              { type: 'separator' },
              { role: 'quit', label: t('menuQuitApp', { appName: app.name }) },
            ],
          },
        ]
      : []),
    {
      label: t('menuFile'),
      submenu: [
        ...createMenuItem(
          ['CmdOrCtrl+N'],
          () => {
            Application.instance.windows.open();
          },
          actionLabel('new-window'),
          'new-window',
        ),
        ...createMenuItem(
          ['CmdOrCtrl+Shift+N'],
          () => {
            Application.instance.windows.open(true);
          },
          actionLabel('new-private-window'),
          'new-private-window',
        ),
        ...createMenuItem(
          ['CmdOrCtrl+T'],
          (window) => {
            // 启动行为「打开特定页面」:Ctrl+T 也打开配置网址,否则默认新标签页。
            const sb = Application.instance.settings.object.startupBehavior;
            const raw = sb.type === 'urls' && sb.url ? sb.url.trim() : '';
            const url = raw
              ? raw.includes('://')
                ? raw
                : `http://${raw}`
              : getWebUIURL('newtab');
            window.viewManager.create({
              url,
              active: true,
            });
          },
          actionLabel('new-tab'),
          'new-tab',
        ),
        ...createMenuItem(
          ['CmdOrCtrl+Shift+T'],
          (window) => {
            window.send('revert-closed-tab');
          },
          actionLabel('reopen-closed-tab'),
          'reopen-closed-tab',
        ),
        {
          type: 'separator',
        },
        ...createMenuItem(
          ['CmdOrCtrl+Shift+W'],
          (window) => {
            window.win.close();
          },
          actionLabel('close-window'),
          'close-window',
        ),
        ...createMenuItem(
          ['CmdOrCtrl+W', 'CmdOrCtrl+F4'],
          (window) => {
            window.send('remove-tab', window.viewManager.selectedId);
          },
          actionLabel('close-tab'),
          'close-tab',
        ),
        {
          type: 'separator',
        },
        ...createMenuItem(
          ['CmdOrCtrl+S'],
          () => {
            saveAs();
          },
          actionLabel('save-page'),
          'save-page',
        ),
        {
          type: 'separator',
        },
        ...createMenuItem(
          ['CmdOrCtrl+P'],
          () => {
            printPage();
          },
          actionLabel('print'),
          'print',
        ),

        // Hidden items

        // Focus address bar
        ...createMenuItem(['Ctrl+Space', 'CmdOrCtrl+L', 'Alt+D', 'F6'], () => {
          Application.instance.dialogs
            .getPersistent('search')
            .show(Application.instance.windows.current.win);
        }),

        // Toggle menu
        ...createMenuItem(['Alt+F', 'Alt+E'], () => {
          Application.instance.windows.current.send('show-menu-dialog');
        }),
      ],
    },
    {
      label: t('menuEdit'),
      submenu: [
        { role: 'undo', label: t('menuUndo') },
        { role: 'redo', label: t('menuRedo') },
        { type: 'separator' },
        { role: 'cut', label: t('menuCut') },
        { role: 'copy', label: t('menuCopy') },
        { role: 'paste', label: t('menuPaste') },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle', label: t('menuPasteAndMatchStyle') },
              { role: 'delete', label: t('menuDelete') },
              { role: 'selectAll', label: t('menuSelectAll') },
              { type: 'separator' },
              {
                label: t('menuSpeech'),
                submenu: [
                  { role: 'startspeaking', label: t('menuStartSpeaking') },
                  { role: 'stopspeaking', label: t('menuStopSpeaking') },
                ],
              },
            ]
          : [
              { role: 'delete', label: t('menuDelete') },
              { type: 'separator' },
              { role: 'selectAll', label: t('menuSelectAll') },
            ]),
        { type: 'separator' },
        ...createMenuItem(
          ['CmdOrCtrl+Shift+L'],
          () => {
            Application.instance.windows.current?.send(
              'addressbar-paste-and-go',
            );
          },
          actionLabel('paste-and-go'),
          'paste-and-go',
        ),
        ...createMenuItem(
          ['CmdOrCtrl+F'],
          () => {
            Application.instance.windows.current.send('find');
          },
          actionLabel('find-in-page'),
          'find-in-page',
        ),
      ],
    },
    {
      label: t('menuView'),
      submenu: [
        ...createMenuItem(
          ['CmdOrCtrl+R', 'F5'],
          () => {
            Application.instance.windows.current.viewManager.selected.webContents.reload();
          },
          actionLabel('reload'),
          'reload',
        ),
        ...createMenuItem(
          ['CmdOrCtrl+Shift+R', 'Shift+F5'],
          () => {
            Application.instance.windows.current.viewManager.selected.webContents.reloadIgnoringCache();
          },
          actionLabel('force-reload'),
          'force-reload',
        ),
      ],
    },
    {
      label: t('menuHistory'),
      submenu: [
        // TODO: Homepage - Ctrl+Shift+H
        ...createMenuItem(
          isMac ? ['Cmd+[', 'Cmd+Left'] : ['Alt+Left'],
          () => {
            const { selected } =
              Application.instance.windows.current.viewManager;
            if (selected) {
              selected.webContents.goBack();
            }
          },
          actionLabel('back'),
          'back',
        ),
        ...createMenuItem(
          isMac ? ['Cmd+]', 'Cmd+Right'] : ['Alt+Right'],
          () => {
            const { selected } =
              Application.instance.windows.current.viewManager;
            if (selected) {
              selected.webContents.goForward();
            }
          },
          actionLabel('forward'),
          'forward',
        ),
        // { type: 'separator' }
        // TODO: list last closed tabs
        // { type: 'separator' }
        // TODO: list last visited
        { type: 'separator' },
        ...createMenuItem(
          isMac ? ['Cmd+Y'] : ['Ctrl+H'],
          () => {
            Application.instance.windows.current.viewManager.create({
              url: getWebUIURL('history'),
              active: true,
            });
          },
          actionLabel('show-history'),
          'show-history',
        ),
      ],
    },
    {
      label: t('menuBookmarks'),
      submenu: [
        ...createMenuItem(
          isMac ? ['Cmd+Option+B'] : ['CmdOrCtrl+Shift+O'],
          () => {
            Application.instance.windows.current.viewManager.create({
              url: getWebUIURL('bookmarks'),
              active: true,
            });
          },
          actionLabel('manage-bookmarks'),
          'manage-bookmarks',
        ),
        ...createMenuItem(
          ['CmdOrCtrl+Shift+B'],
          () => {
            const settings = Application.instance.settings.object;
            const current = normalizeBookmarkBarDisplay(
              settings.bookmarksBarDisplay,
              settings.bookmarksBar,
            );
            const bookmarksBarDisplay =
              current === 'always'
                ? 'newtab'
                : current === 'newtab'
                ? 'never'
                : 'always';
            Application.instance.settings.updateSettings({
              bookmarksBarDisplay,
            });
          },
          actionLabel('toggle-bookmarks-bar'),
          'toggle-bookmarks-bar',
        ),
        ...createMenuItem(
          ['CmdOrCtrl+D'],
          () => {
            Application.instance.windows.current.webContents.send(
              'show-add-bookmark-dialog',
            );
          },
          actionLabel('add-bookmark'),
          'add-bookmark',
        ),
        // { type: 'separator' }
        // TODO: list bookmarks
      ],
    },
    {
      label: t('menuTools'),
      submenu: [
        ...createMenuItem(
          ['CmdOrCtrl+Shift+X'],
          () => {
            void Application.instance.openDesktopScreenshot();
          },
          actionLabel('screenshot'),
          'screenshot',
        ),
        ...createMenuItem(
          ['Ctrl+`'],
          () => {
            Application.instance.toggleBossKey();
          },
          actionLabel('boss-key'),
          'boss-key',
        ),
        { type: 'separator' },
        {
          label: t('menuDeveloper'),
          submenu: [
            ...createMenuItem(
              ['CmdOrCtrl+U'],
              () => {
                viewSource();
              },
              actionLabel('view-source'),
              'view-source',
            ),
            ...createMenuItem(
              ['CmdOrCtrl+Shift+I', 'CmdOrCtrl+Shift+J', 'F12'],
              () => {
                setTimeout(() => {
                  Application.instance.windows.current.viewManager.selected.webContents.toggleDevTools();
                });
              },
              actionLabel('devtools'),
              'devtools',
            ),

            // Developer tools (current webContents) (dev)
            ...createMenuItem(['CmdOrCtrl+Shift+F12'], () => {
              setTimeout(() => {
                webContents
                  .getFocusedWebContents()
                  .openDevTools({ mode: 'detach' });
              });
            }),
          ],
        },
      ],
    },
    {
      label: t('menuTabs'),
      submenu: [
        ...createMenuItem(
          isMac ? ['Cmd+Option+Right'] : ['Ctrl+Tab', 'Ctrl+PageDown'],
          () => {
            Application.instance.windows.current.webContents.send(
              'select-next-tab',
            );
          },
          actionLabel('next-tab'),
          'next-tab',
        ),
        ...createMenuItem(
          isMac ? ['Cmd+Option+Left'] : ['Ctrl+Shift+Tab', 'Ctrl+PageUp'],
          () => {
            Application.instance.windows.current.webContents.send(
              'select-previous-tab',
            );
          },
          actionLabel('previous-tab'),
          'previous-tab',
        ),
        // 标签栏整理(隐藏项,快捷键驱动):动作在 renderer 的 LayoutSwitcher,
        // 这里只把动作名经 organize-tabs IPC 转发过去。
        ...createMenuItem(
          ['CmdOrCtrl+Shift+D'],
          (window) => {
            window.send('organize-tabs', 'deduplicate');
          },
          null,
          'deduplicate-tabs',
        ),
        ...createMenuItem(
          ['CmdOrCtrl+Shift+G'],
          (window) => {
            window.send('organize-tabs', 'domain');
          },
          null,
          'group-tabs-by-domain',
        ),
      ],
    },
    {
      label: t('menuWindow'),
      submenu: [
        { role: 'minimize', label: t('menuMinimize') },
        {
          label: t('menuToggleFullscreen'),
          accelerator: 'F11',
          click: (_menuItem: MenuItem, browserWindow: BrowserWindow) => {
            const target = browserWindow || BrowserWindow.getFocusedWindow();
            const window = Application.instance.windows.list.find(
              (item) => item.win.id === target?.id,
            );
            window?.toggleFullscreenFromF11();
          },
        },
        { role: 'zoom', label: t('menuZoom') },
        ...(isMac
          ? [
              { type: 'separator' },
              { role: 'front', label: t('menuBringAllToFront') },
              { type: 'separator' },
              { role: 'window', label: t('menuWindow') },
            ]
          : [{ role: 'close', accelerator: '', label: t('menuClose') }]),
        { type: 'separator' },
        {
          label: t('menuAlwaysOnTop'),
          type: 'checkbox',
          checked: false,
          click(menuItem: MenuItem, browserWindow: BrowserWindow) {
            browserWindow.setAlwaysOnTop(!browserWindow.isAlwaysOnTop());
            menuItem.checked = browserWindow.isAlwaysOnTop();
          },
        },
      ],
    },
  ];

  // Ctrl+1 - Ctrl+8 (切到第 N 个标签,每个独立可配置)
  for (let i = 1; i <= 8; i++) {
    template[0].submenu = template[0].submenu.concat(
      createMenuItem(
        [`CmdOrCtrl+${i}`],
        () => {
          Application.instance.windows.current.webContents.send(
            'select-tab-index',
            i - 1,
          );
        },
        null,
        `select-tab-${i}`,
      ),
    );
  }

  // Ctrl+9
  template[0].submenu = template[0].submenu.concat(
    createMenuItem(
      ['CmdOrCtrl+9'],
      () => {
        Application.instance.windows.current.webContents.send(
          'select-last-tab',
        );
      },
      null,
      'select-last-tab',
    ),
  );

  // Ctrl+numadd - Ctrl+=
  template[0].submenu = template[0].submenu.concat(
    createMenuItem(
      ['CmdOrCtrl+numadd', 'CmdOrCtrl+='],
      () => {
        Application.instance.windows.current.viewManager.changeZoom('in');
      },
      null,
      'zoom-in',
    ),
  );

  // Ctrl+numsub - Ctrl+-
  template[0].submenu = template[0].submenu.concat(
    createMenuItem(
      ['CmdOrCtrl+numsub', 'CmdOrCtrl+-'],
      () => {
        Application.instance.windows.current.viewManager.changeZoom('out');
      },
      null,
      'zoom-out',
    ),
  );

  // Ctrl+0
  template[0].submenu = template[0].submenu.concat(
    createMenuItem(
      ['CmdOrCtrl+0', 'CmdOrCtrl+num0'],
      () => {
        Application.instance.windows.current.viewManager.resetZoom();
      },
      null,
      'reset-zoom',
    ),
  );

  return Menu.buildFromTemplate(template);
};
