import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { IDownloadItem } from '~/interfaces';
import {
  ICON_CHECK,
  ICON_PAUSE,
  ICON_RESUME,
  ICON_FOLDER,
  ICON_LINK,
  ICON_TRASH,
  ICON_CLOSE,
} from '~/renderer/constants';
import store from '../../store';
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from '~/renderer/components/ContextMenu';
import {
  openItem,
  toggleOpenWhenDone,
  showInFolder,
  copyLink,
  pauseDownload,
  resumeDownload,
  cancelDownload,
  removeDownload,
  trashDownload,
} from '../download-menu';
import { useI18n } from '~/renderer/components/I18n';

// 把纯操作函数包装成下拉菜单项的事件处理器:执行操作后收起所有菜单并阻止冒泡
// (避免触发外层 dialogClicked)。
const wrap =
  (item: IDownloadItem, fn: (i: IDownloadItem) => void) =>
  (e: React.MouseEvent<HTMLDivElement>) => {
    fn(item);
    store.closeAllDownloadMenu();
    e.stopPropagation();
  };

export const DownloadItemMenu = observer(
  ({ item, visible }: { item: IDownloadItem; visible: boolean }) => {
    const t = useI18n();
    return (
      <ContextMenu
        style={{
          top: 50,
          right: 10,
          width: 200,
          fontSize: 12,
        }}
        visible={visible}
      >
        {!item.canceled &&
          (item.completed ? (
            <ContextMenuItem onClick={wrap(item, openItem)} icon={' '}>
              {t('dldOpenFile')}
            </ContextMenuItem>
          ) : (
            <ContextMenuItem
              onClick={wrap(item, toggleOpenWhenDone)}
              icon={item.openWhenDone ? ICON_CHECK : ' '}
            >
              {t('dldOpenWhenDone')}
            </ContextMenuItem>
          ))}

        {!item.canceled && <ContextMenuSeparator />}

        {!item.completed &&
          !item.canceled &&
          (item.paused && !item.retrying ? (
            <ContextMenuItem onClick={wrap(item, resumeDownload)} icon={ICON_RESUME}>
              {t('dldResume')}
            </ContextMenuItem>
          ) : (
            <ContextMenuItem onClick={wrap(item, pauseDownload)} icon={ICON_PAUSE}>
              {t('dldPause')}
            </ContextMenuItem>
          ))}
        {!item.canceled && (
          <ContextMenuItem onClick={wrap(item, showInFolder)} icon={ICON_FOLDER}>
            {t('dldShowInFolder')}
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={wrap(item, copyLink)} icon={ICON_LINK}>
          {t('dldCopyLink')}
        </ContextMenuItem>

        <ContextMenuSeparator />

        {item.completed && (
          <ContextMenuItem onClick={wrap(item, trashDownload)} icon={ICON_TRASH}>
            {t('dldDeleteFile')}
          </ContextMenuItem>
        )}
        {(item.completed || item.canceled) && (
          <ContextMenuItem onClick={wrap(item, removeDownload)} icon={ICON_CLOSE}>
            {t('dldRemoveFromList')}
          </ContextMenuItem>
        )}
        {!item.completed && !item.canceled && (
          <ContextMenuItem onClick={wrap(item, cancelDownload)} icon={ICON_CLOSE}>
            {t('dldCancelDownload')}
          </ContextMenuItem>
        )}
      </ContextMenu>
    );
  },
);
