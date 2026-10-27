import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ToolbarButton } from '../ToolbarButton';
import { IBrowserAction } from '../../models';
import { ipcRenderer } from 'electron';
import * as remote from '@electron/remote';
import store from '../../store';
import { getShellTranslator } from '../../utils/i18n';
import { extensionMainChannel } from '~/common/rpc/extensions';
import { getWebUIURL } from '~/common/webui';
import {Application} from "~/main/application";

interface Props {
  data: IBrowserAction;
  // 正在被拖动排序(半透明占位)。
  dragging?: boolean;
}

const showPopup = (
  data: IBrowserAction,
  left: number,
  top: number,
  devtools: boolean,
) => {
  store.extensions.currentlyToggledPopup = data.extensionId;
  ipcRenderer.send(
    `show-extension-popup-${store.windowId}`,
    left,
    top,
    data.popup,
    devtools,
    data.extensionId
  );
};

let canOpenPopup = true;

const onClick = (data: IBrowserAction) => (
  e: React.MouseEvent<HTMLDivElement>,
) => {
  console.log(
    `[action-click] toolbar onClick extId=${data.extensionId} popup=${JSON.stringify(
      data.popup,
    )} tabId=${data.tabId} canOpenPopup=${canOpenPopup}`,
  );
  if (canOpenPopup) {
    // A disabled action is not clickable: skip both the popup and the
    // onClicked dispatch. (The main process also gates activateClick, but
    // popup-declared actions bypass activateClick and go straight through
    // show-extension-popup, so the gate must live here too.)
    if (data.enabled === false) {
      console.log(`[action-click] toolbar onClick SKIPPED (disabled) extId=${data.extensionId}`);
      return;
    }
    if (!data.popup) {
      // No declared popup (e.g. CircleReader): a left-click must fire
      // chrome.action.onClicked for the active tab, not open the management
      // context menu (that stays on right-click via onContextMenu). The main
      // process routes this to browserAction.activate -> onClicked.
      console.log(`[action-click] toolbar onClick -> dispatchActionClick (no popup) extId=${data.extensionId}`);
      const r = e.currentTarget.getBoundingClientRect();
      extensionMainChannel
        .getInvoker()
        .dispatchActionClick(
          data.extensionId,
          typeof data.tabId === 'number' ? data.tabId : -1,
          { x: r.left, y: r.top, width: r.width, height: r.height },
        );
    } else {
      console.log(`[action-click] toolbar onClick -> showPopup popup=${JSON.stringify(data.popup)} extId=${data.extensionId}`);
      const { left, top } = e.currentTarget.getBoundingClientRect();
      showPopup(data, left, top, false);
    }
  } else {
    console.log(`[action-click] toolbar onClick SKIPPED (canOpenPopup=false) extId=${data.extensionId}`);
  }
};

const onContextMenu = (data: IBrowserAction) => (
  e: React.MouseEvent<HTMLDivElement>,
) => {
  // 阻止冒泡到工具栏容器的 onContextMenu(否则「自定义工具栏」菜单会覆盖本扩展菜单)。
  e.preventDefault();
  e.stopPropagation();
  const t = getShellTranslator();
  const { target } = e;
  const menu = remote.Menu.buildFromTemplate([
    {
      label: t('shellShortcutSettings'),
      click: () => {
        // 打开设置页「快捷键」分区并滚动到该扩展的命令区块(?ext= 由 Shortcuts 组件读取定位)。
        ipcRenderer.send(`add-tab-${store.windowId}`, {
          url: `${getWebUIURL('settings')}?section=shortcuts&ext=${data.extensionId}`,
          active: true,
        });
      },
    },
    {
      label: t('shellUninstallExtension'),
      click: () => {
        store.extensions.uninstallExtension(data.extensionId);
      },
    },
    {
      label: t('shellInspect'),
      click: () => {
        const { left, top } = (target as any).getBoundingClientRect();
        showPopup(data, left, top, true);
      },
    },
    {
      label: t('shellInspectBackground'),
      click: () => {
        extensionMainChannel
          .getInvoker()
          .inspectBackgroundPage(data.extensionId);
      },
    },
  ]);

  menu.popup();
};

const onMouseDown = (data: IBrowserAction) => async (e: any) => {
  canOpenPopup =
    !store.dialogsVisibility['extension-popup'] ||
    data.extensionId !== store.extensions.currentlyToggledPopup;
  // ipcRenderer.send(`hide-extension-popup-${store.windowId}`);
};

export const BrowserAction = observer(({ data, dragging }: Props) => {
  const {
    icon,
    badgeText,
    badgeBackgroundColor,
    badgeTextColor,
    extensionId,
    title,
  } = data;

  return (
    <ToolbarButton
      rainseeAction="extension-action"
      rainseeExtensionId={extensionId}
      title={title}
      className="right-action right-action--extension"
      onClick={onClick(data)}
      onMouseDown={onMouseDown(data)}
      onContextMenu={onContextMenu(data)}
      style={dragging ? { opacity: 0.45 } : undefined}
      opacity={data.enabled === false ? 0.4 : 1}
      autoInvert={false}
      size={16}
      toggled={
        store.dialogsVisibility['extension-popup'] &&
        store.extensions.currentlyToggledPopup === extensionId
      }
      icon={icon}
      badge={badgeText.trim() !== ''}
      badgeBackground={badgeBackgroundColor}
      badgeTextColor={badgeTextColor}
      badgeText={badgeText}
    ></ToolbarButton>
  );
});
