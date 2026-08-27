import * as React from 'react';
import { ipcRenderer, webUtils } from 'electron';
import {
  BookOpen,
  FileHtml,
  ImageSquare,
  MagnifyingGlass,
  MagicWand,
  Play,
} from '@phosphor-icons/react';

import { getHeaderDropFileType, HeaderDropFileType } from '~/constants/files';
import {
  ActionButton,
  ActionList,
  DropOverlay,
  FileName,
  FileSummary,
  FileType,
  IActionAccent,
} from './style';

export type HeaderDropAction =
  | 'pdf-read'
  | 'image-view'
  | 'image-compress'
  | 'image-search'
  | 'video-play'
  | 'reader-read'
  | 'html-open';

interface DropActionItem {
  id: HeaderDropAction;
  label: string;
  icon: React.ComponentType<any>;
  accent: IActionAccent;
  disabled?: boolean;
}

const ACCENTS: Record<string, IActionAccent> = {
  blue: {
    color: '#2563eb',
    surface: 'rgba(37, 99, 235, 0.12)',
    border: 'rgba(37, 99, 235, 0.24)',
    shadow: 'rgba(37, 99, 235, 0.3)',
  },
  violet: {
    color: '#7c3aed',
    surface: 'rgba(124, 58, 237, 0.12)',
    border: 'rgba(124, 58, 237, 0.24)',
    shadow: 'rgba(124, 58, 237, 0.3)',
  },
  green: {
    color: '#059669',
    surface: 'rgba(5, 150, 105, 0.12)',
    border: 'rgba(5, 150, 105, 0.24)',
    shadow: 'rgba(5, 150, 105, 0.3)',
  },
  amber: {
    color: '#d97706',
    surface: 'rgba(217, 119, 6, 0.12)',
    border: 'rgba(217, 119, 6, 0.24)',
    shadow: 'rgba(217, 119, 6, 0.3)',
  },
  rose: {
    color: '#e11d48',
    surface: 'rgba(225, 29, 72, 0.12)',
    border: 'rgba(225, 29, 72, 0.24)',
    shadow: 'rgba(225, 29, 72, 0.3)',
  },
  cyan: {
    color: '#0891b2',
    surface: 'rgba(8, 145, 178, 0.12)',
    border: 'rgba(8, 145, 178, 0.24)',
    shadow: 'rgba(8, 145, 178, 0.3)',
  },
};

const ACTIONS: Record<HeaderDropFileType, DropActionItem[]> = {
  pdf: [
    { id: 'pdf-read', label: '阅读', icon: BookOpen, accent: ACCENTS.blue },
  ],
  image: [
    {
      id: 'image-view',
      label: '查看',
      icon: ImageSquare,
      accent: ACCENTS.cyan,
    },
    {
      id: 'image-compress',
      label: '压缩',
      icon: MagicWand,
      accent: ACCENTS.green,
    },
    {
      id: 'image-search',
      label: '以图搜索',
      icon: MagnifyingGlass,
      accent: ACCENTS.amber,
    },
  ],
  video: [
    { id: 'video-play', label: '播放', icon: Play, accent: ACCENTS.rose },
  ],
  reader: [
    { id: 'reader-read', label: '查看', icon: BookOpen, accent: ACCENTS.green },
  ],
  html: [
    { id: 'html-open', label: '打开', icon: FileHtml, accent: ACCENTS.amber },
  ],
};

const DEFAULT_ACTIONS: Record<HeaderDropFileType, HeaderDropAction> = {
  pdf: 'pdf-read',
  image: 'image-view',
  video: 'video-play',
  reader: 'reader-read',
  html: 'html-open',
};

const TYPE_LABELS: Record<HeaderDropFileType, string> = {
  pdf: 'PDF 文档',
  image: '图片文件',
  video: '视频文件',
  reader: '可阅读文件',
  html: '网页文件',
};

interface DraggedFile {
  name: string;
  type: HeaderDropFileType;
}

const READER_MIME_TYPES = new Set([
  'application/epub+zip',
  'application/x-mobipocket-ebook',
  'application/vnd.amazon.ebook',
  'application/vnd.amazon.mobi8-ebook',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.comicbook-rar',
  'application/vnd.comicbook+zip',
  'application/x-cbr',
  'application/x-cbz',
  'application/x-cbt',
  'application/x-cb7',
  'application/x-fictionbook+xml',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
]);

// 明确「不是阅读器格式」的 MIME:真压缩包 / 可执行 / 安装包。
// 这些拖到地址栏时不应回退成「可阅读文件」菜单（避免误导）。
// 注意 cbz/cbr 虽本质是 zip/rar，但未注册时 Chromium 按扩展名查不到、type 为空，
// 不会落到这里；只有真 .zip/.rar/.exe 等扩展名才会拿到这些 MIME。
const NON_READER_MIME_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/x-zip',
  'application/gzip',
  'application/x-gzip',
  'application/x-rar-compressed',
  'application/vnd.rar',
  'application/x-7z-compressed',
  'application/x-tar',
  'application/x-bzip2',
  'application/java-archive',
  'application/x-msdownload',
  'application/x-msi',
  'application/vnd.microsoft.portable-executable',
  'application/x-sh',
  'application/x-bat',
  'application/x-msdos-program',
  'application/vnd.android.package-archive',
  'application/x-apple-diskimage',
]);

const getDraggedFile = (
  dataTransfer: DataTransfer | null,
): DraggedFile | null => {
  if (!dataTransfer) return null;
  const items = Array.from(dataTransfer.items || []).filter(
    (item) => item.kind === 'file',
  );
  const file =
    Array.from(dataTransfer.files || [])[0] || items[0]?.getAsFile() || null;
  if (file) {
    const type = getHeaderDropFileType(file.name);
    if (type) return { name: file.name, type };
  }

  // Windows 原生文件刚进入 Electron 窗口时，FileList/getAsFile 可能暂时为空，
  // 但 DataTransferItem.type 已可用。先按 MIME 展示面板，drop 时再用真实路径校验。
  const mime = (items[0]?.type || '').split(';')[0].trim().toLowerCase();
  if (mime === 'application/pdf') return { name: 'PDF 文件', type: 'pdf' };
  if (mime.startsWith('image/')) return { name: '图片文件', type: 'image' };
  if (mime.startsWith('video/')) return { name: '视频文件', type: 'video' };
  if (mime === 'text/html') return { name: 'HTML 文件', type: 'html' };
  if (READER_MIME_TYPES.has(mime)) {
    return { name: '可阅读文件', type: 'reader' };
  }
  // 兜底：epub/mobi/azw3/md/fb2/cbz/cbr 等阅读器格式在 Windows 注册表常未登记
  // Content Type，Chromium 在 dragenter/dragover 期间无法读文件内容、推断不出
  // application/epub+zip 等，DataTransferItem.type 多为空或 octet-stream → 这些格式
  // 此前 dragenter 阶段就拿不到类型，悬浮菜单完全不显示。
  // 现规则：只要确实在拖文件、且 MIME 不是明确的压缩包/可执行类，就回退为 reader
  // 先把菜单亮出来；drop 时再用 getHeaderDropFileType(filePath) 校验真实扩展名，
  // 非阅读器格式会被拦截，不会误打开。
  if (items.length > 0 && !NON_READER_MIME_TYPES.has(mime)) {
    return { name: '可阅读文件', type: 'reader' };
  }
  return null;
};

const hasDraggedFiles = (dataTransfer: DataTransfer | null) =>
  !!dataTransfer &&
  (dataTransfer.files.length > 0 ||
    Array.from(dataTransfer.items || []).some((item) => item.kind === 'file'));

interface Props {
  targetRef: React.RefObject<HTMLElement>;
  windowId: number;
}

export const HeaderFileDropPanel = ({ targetRef, windowId }: Props) => {
  const [draggedFile, setDraggedFile] = React.useState<DraggedFile | null>(
    null,
  );
  const [activeAction, setActiveAction] =
    React.useState<HeaderDropAction | null>(null);
  const draggedFileRef = React.useRef<DraggedFile | null>(null);
  const activeActionRef = React.useRef<HeaderDropAction | null>(null);

  const updateDraggedFile = React.useCallback((value: DraggedFile | null) => {
    draggedFileRef.current = value;
    setDraggedFile(value);
    activeActionRef.current = null;
    setActiveAction(null);
  }, []);

  React.useEffect(() => {
    const target = targetRef.current;
    if (!target) return undefined;

    const isInsideTarget = (event: DragEvent) => {
      const rect = target.getBoundingClientRect();
      return (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      );
    };

    const onDragEnter = (event: DragEvent) => {
      if (!isInsideTarget(event) || !hasDraggedFiles(event.dataTransfer))
        return;
      const file = getDraggedFile(event.dataTransfer);
      event.preventDefault();
      event.stopPropagation();
      if (!file) return;
      if (
        !draggedFileRef.current ||
        draggedFileRef.current.name !== file.name ||
        draggedFileRef.current.type !== file.type
      ) {
        updateDraggedFile(file);
      }
    };

    const onDragOver = (event: DragEvent) => {
      if (!isInsideTarget(event) || !hasDraggedFiles(event.dataTransfer)) {
        if (draggedFileRef.current) updateDraggedFile(null);
        return;
      }

      const detectedFile = getDraggedFile(event.dataTransfer);
      if (
        detectedFile &&
        (!draggedFileRef.current ||
          draggedFileRef.current.name !== detectedFile.name ||
          draggedFileRef.current.type !== detectedFile.type)
      ) {
        updateDraggedFile(detectedFile);
      }
      if (!detectedFile && !draggedFileRef.current) return;

      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';

      const actionNode = (event.target as Element | null)?.closest?.(
        '[data-drop-action]',
      );
      const action = actionNode?.getAttribute(
        'data-drop-action',
      ) as HeaderDropAction | null;
      const nextAction =
        action && !actionNode?.hasAttribute('disabled') ? action : null;
      if (nextAction !== activeActionRef.current) {
        activeActionRef.current = nextAction;
        setActiveAction(nextAction);
      }
    };

    const onDragLeave = (event: DragEvent) => {
      if (!draggedFileRef.current) return;
      // Chromium may clamp coordinates to the window edge when a native file
      // leaves the renderer, so coordinates alone can still look inside.
      if (event.relatedTarget === null || !isInsideTarget(event)) {
        updateDraggedFile(null);
      }
    };

    const onDrop = (event: DragEvent) => {
      if (!isInsideTarget(event)) {
        updateDraggedFile(null);
        return;
      }
      const file = draggedFileRef.current || getDraggedFile(event.dataTransfer);
      const hoveredAction = activeActionRef.current;
      const nativeFile = event.dataTransfer?.files?.[0];
      updateDraggedFile(null);
      if (!file || !nativeFile) return;

      event.preventDefault();
      event.stopPropagation();
      const action = hoveredAction || DEFAULT_ACTIONS[file.type];

      const filePath = webUtils.getPathForFile(nativeFile);
      if (!filePath || getHeaderDropFileType(filePath) !== file.type) return;
      ipcRenderer.send(`header-file-action-${windowId}`, { action, filePath });
    };

    window.addEventListener('dragenter', onDragEnter, true);
    window.addEventListener('dragover', onDragOver, true);
    window.addEventListener('dragleave', onDragLeave, true);
    window.addEventListener('drop', onDrop, true);
    return () => {
      window.removeEventListener('dragenter', onDragEnter, true);
      window.removeEventListener('dragover', onDragOver, true);
      window.removeEventListener('dragleave', onDragLeave, true);
      window.removeEventListener('drop', onDrop, true);
    };
  }, [targetRef, updateDraggedFile, windowId]);

  if (!draggedFile) return null;
  const actions = ACTIONS[draggedFile.type];

  return (
    <DropOverlay>
      <FileSummary>
        <FileType>{TYPE_LABELS[draggedFile.type]}</FileType>
        <FileName title={draggedFile.name}>{draggedFile.name}</FileName>
      </FileSummary>
      <ActionList>
        {actions.map((item) => {
          const Icon = item.icon;
          return (
            <ActionButton
              key={item.id}
              type="button"
              data-drop-action={item.id}
              disabled={item.disabled}
              $active={!item.disabled && activeAction === item.id}
              $accent={item.accent}
              title={
                item.disabled
                  ? `${item.label}（暂未开放）`
                  : `拖到此处${item.label}`
              }
            >
              <Icon size={19} weight="bold" />
              <span>{item.label}</span>
            </ActionButton>
          );
        })}
      </ActionList>
    </DropOverlay>
  );
};
