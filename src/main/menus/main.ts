import { Menu, webContents, app, BrowserWindow, MenuItem } from 'electron';
import { viewSource, saveAs, printPage } from './common-actions';
import { WEBUI_BASE_URL, WEBUI_URL_SUFFIX } from '~/constants/files';
import { AppWindow } from '../windows';
import { Application } from '../application';
import { getWebUIURL } from '~/common/webui-main';

const isMac = process.platform === 'darwin';

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
  const template: any = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideothers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: '文件',
      submenu: [
        ...createMenuItem(
          ['CmdOrCtrl+N'],
          () => {
            Application.instance.windows.open();
          },
          '打开新的窗口',
          'new-window',
        ),
        ...createMenuItem(
          ['CmdOrCtrl+Shift+N'],
          () => {
            Application.instance.windows.open(true);
          },
          '打开新的无痕窗口',
          'new-private-window',
        ),
        ...createMenuItem(
          ['CmdOrCtrl+T'],
          (window) => {
            // 启动行为「打开特定页面」:Ctrl+T 也打开配置网址,否则默认新标签页。
            const sb = Application.instance.settings.object.startupBehavior;
            const raw = sb.type === 'urls' && sb.url ? sb.url.trim() : '';
            const url = raw ? (raw.includes('://') ? raw : `http://${raw}`) : getWebUIURL('newtab');
            window.viewManager.create({
              url,
              active: true
            });
          },
          '打开新的标签页',
          'new-tab',
        ),
        ...createMenuItem(
          ['CmdOrCtrl+Shift+T'],
          (window) => {
            window.send('revert-closed-tab');
          },
          '撤销关闭的标签',
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
          '关闭窗口',
          'close-window',
        ),
        ...createMenuItem(
          ['CmdOrCtrl+W', 'CmdOrCtrl+F4'],
          (window) => {
            window.send('remove-tab', window.viewManager.selectedId);
          },
          '关闭标签页',
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
          '保存页面为...',
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
          '打印',
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
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' },
              { role: 'delete' },
              { role: 'selectAll' },
              { type: 'separator' },
              {
                label: 'Speech',
                submenu: [{ role: 'startspeaking' }, { role: 'stopspeaking' }],
              },
            ]
          : [{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }]),
        { type: 'separator' },
        ...createMenuItem(
          ['CmdOrCtrl+Shift+L'],
          () => {
            Application.instance.windows.current?.send('addressbar-paste-and-go');
          },
          '粘贴并转到',
          'paste-and-go',
        ),
        ...createMenuItem(
          ['CmdOrCtrl+F'],
          () => {
            Application.instance.windows.current.send('find');
          },
          '页内查找',
          'find-in-page',
        ),
      ],
    },
    {
      label: '视图',
      submenu: [
        ...createMenuItem(
          ['CmdOrCtrl+R', 'F5'],
          () => {
            Application.instance.windows.current.viewManager.selected.webContents.reload();
          },
          'Reload',
          'reload',
        ),
        ...createMenuItem(
          ['CmdOrCtrl+Shift+R', 'Shift+F5'],
          () => {
            Application.instance.windows.current.viewManager.selected.webContents.reloadIgnoringCache();
          },
          'Reload ignoring cache',
          'force-reload',
        ),
      ],
    },
    {
      label: '历史记录',
      submenu: [
        // TODO: Homepage - Ctrl+Shift+H
        ...createMenuItem(
          isMac ? ['Cmd+[', 'Cmd+Left'] : ['Alt+Left'],
          () => {
            const {
              selected,
            } = Application.instance.windows.current.viewManager;
            if (selected) {
              selected.webContents.goBack();
            }
          },
          '返回',
          'back',
        ),
        ...createMenuItem(
          isMac ? ['Cmd+]', 'Cmd+Right'] : ['Alt+Right'],
          () => {
            const {
              selected,
            } = Application.instance.windows.current.viewManager;
            if (selected) {
              selected.webContents.goForward();
            }
          },
          '前进',
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
          '管理历史记录',
          'show-history',
        ),
      ],
    },
    {
      label: '书签',
      submenu: [
        ...createMenuItem(
          isMac ? ['Cmd+Option+B'] : ['CmdOrCtrl+Shift+O'],
          () => {
            Application.instance.windows.current.viewManager.create({
              url: getWebUIURL('bookmarks'),
              active: true,
            });
          },
          '管理书签',
          'manage-bookmarks',
        ),
        ...createMenuItem(
          ['CmdOrCtrl+Shift+B'],
          () => {
            const { bookmarksBar } = Application.instance.settings.object;
            Application.instance.settings.updateSettings({
              bookmarksBar: !bookmarksBar,
            });
          },
          'Toggle bookmarks bar',
          'toggle-bookmarks-bar',
        ),
        ...createMenuItem(
          ['CmdOrCtrl+D'],
          () => {
            Application.instance.windows.current.webContents.send(
              'show-add-bookmark-dialog',
            );
          },
          'Add this website to bookmarks',
          'add-bookmark',
        ),
        // { type: 'separator' }
        // TODO: list bookmarks
      ],
    },
    {
      label: '工具',
      submenu: [
        {
          label: 'Developer',
          submenu: [
            ...createMenuItem(
              ['CmdOrCtrl+U'],
              () => {
                viewSource();
              },
              'View source',
              'view-source',
            ),
            ...createMenuItem(
              ['CmdOrCtrl+Shift+I', 'CmdOrCtrl+Shift+J', 'F12'],
              () => {
                setTimeout(() => {
                  Application.instance.windows.current.viewManager.selected.webContents.toggleDevTools();
                });
              },
              'Developer tools...',
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
      label: '标签页',
      submenu: [
        ...createMenuItem(
          isMac ? ['Cmd+Option+Right'] : ['Ctrl+Tab', 'Ctrl+PageDown'],
          () => {
            Application.instance.windows.current.webContents.send(
              'select-next-tab',
            );
          },
          'Select next tab',
          'next-tab',
        ),
        ...createMenuItem(
          isMac ? ['Cmd+Option+Left'] : ['Ctrl+Shift+Tab', 'Ctrl+PageUp'],
          () => {
            Application.instance.windows.current.webContents.send(
              'select-previous-tab',
            );
          },
          'Select previous tab',
          'previous-tab',
        ),
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize' },
        { role: 'togglefullscreen' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' },
              { role: 'front' },
              { type: 'separator' },
              { role: 'window' },
            ]
          : [{ role: 'close', accelerator: '' }]),
        { type: 'separator' },
        {
          label: '置顶窗口',
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
        Application.instance.windows.current.webContents.send('select-last-tab');
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
