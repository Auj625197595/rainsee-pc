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
              打开文件
            </ContextMenuItem>
          ) : (
            <ContextMenuItem
              onClick={wrap(item, toggleOpenWhenDone)}
              icon={item.openWhenDone ? ICON_CHECK : ' '}
            >
              完成时打开
            </ContextMenuItem>
          ))}

        {!item.canceled && <ContextMenuSeparator />}

        {!item.completed &&
          !item.canceled &&
          (item.paused ? (
            <ContextMenuItem onClick={wrap(item, resumeDownload)} icon={ICON_RESUME}>
              恢复下载
            </ContextMenuItem>
          ) : (
            <ContextMenuItem onClick={wrap(item, pauseDownload)} icon={ICON_PAUSE}>
              暂停下载
            </ContextMenuItem>
          ))}
        {!item.canceled && (
          <ContextMenuItem onClick={wrap(item, showInFolder)} icon={ICON_FOLDER}>
            在文件夹中显示
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={wrap(item, copyLink)} icon={ICON_LINK}>
          复制下载链接
        </ContextMenuItem>

        <ContextMenuSeparator />

        {item.completed && (
          <ContextMenuItem onClick={wrap(item, trashDownload)} icon={ICON_TRASH}>
            删除文件
          </ContextMenuItem>
        )}
        {(item.completed || item.canceled) && (
          <ContextMenuItem onClick={wrap(item, removeDownload)} icon={ICON_CLOSE}>
            从列表中移除
          </ContextMenuItem>
        )}
        {!item.completed && !item.canceled && (
          <ContextMenuItem onClick={wrap(item, cancelDownload)} icon={ICON_CLOSE}>
            取消下载
          </ContextMenuItem>
        )}
      </ContextMenu>
    );
  },
);
