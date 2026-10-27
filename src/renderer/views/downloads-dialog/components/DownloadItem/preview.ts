import * as React from 'react';
import { ipcRenderer } from 'electron';
import { IDownloadItem } from '~/interfaces';
import { FileCategory, getFileExt } from '~/renderer/components/FileTypeIcon';

export type PreviewKind = 'thumbnail' | 'icon';

// 图片/视频用系统缩略图;只有自带图标的可执行安装包取系统图标。
// apk/dmg 等在 Windows 上没有关联程序,系统只会给一张空白通用文件图,反而比自绘图标难看。
const ICON_EXTS = new Set(['exe', 'msi', 'appx', 'msix']);

export const getPreviewKind = (
  fileName: string | undefined,
  category: FileCategory,
): PreviewKind | undefined => {
  if (category === 'image' || category === 'video') return 'thumbnail';
  if (ICON_EXTS.has(getFileExt(fileName))) return 'icon';
  return undefined;
};

// 以「id + 保存路径」为键缓存,弹窗反复打开/列表重渲染时不重复向主进程取图。
// null 表示已取过但无可用预览,同样缓存,避免反复请求。
const cache = new Map<string, string | null>();
const MAX_CACHE = 200;

export const useFilePreview = (
  item: IDownloadItem,
  kind: PreviewKind | undefined,
): string | null => {
  if (!item.completed) kind = undefined;
  const key = kind ? `${item.id}|${item.savePath}|${kind}` : '';
  const [src, setSrc] = React.useState<string | null>(() =>
    key ? cache.get(key) ?? null : null,
  );

  React.useEffect(() => {
    if (!key) {
      setSrc(null);
      return undefined;
    }
    if (cache.has(key)) {
      setSrc(cache.get(key));
      return undefined;
    }

    let alive = true;
    ipcRenderer
      .invoke('download-file-preview', item.id, kind)
      .catch((): null => null)
      .then((url: string | null) => {
        const value = typeof url === 'string' && url ? url : null;
        if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
        cache.set(key, value);
        if (alive) setSrc(value);
      });
    return () => {
      alive = false;
    };
  }, [key]);

  return src;
};
