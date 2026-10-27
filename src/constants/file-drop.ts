// 本地文件拖拽/打开的类型判定。保持零依赖:页面 preload(webpack target:web)
// 也要引用这里,不能带上 url/settings 等 Node 或主进程模块。

// koodoreader 支持的电子书格式(扩展名小写,无点)。
// router/index.tsx 为每种格式注册了 /<ext> 路由(全部指向 HtmlReader),
// 故路由即扩展名。拖拽/打开这些格式时用 yjllq://web.koodoreader.com/#/<ext>?filePath=<绝对路径> 直开。
export const KOODO_READER_EXTS = [
  'pdf', 'epub', 'txt', 'mobi', 'azw3', 'azw',
  'cbr', 'cbz', 'cbt', 'cb7', 'docx', 'md', 'fb2',
];

// 地址栏拖拽可直接打开的本地文件:koodoreader 格式 + html/mhtml(走 file://)。
export const OPENABLE_FILE_EXTS = [
  ...KOODO_READER_EXTS,
  'html',
  'htm',
  'mhtml',
  'mht',
];

export const IMAGE_FILE_EXTS = [
  'jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'avif', 'tif', 'tiff',
];

export const VIDEO_FILE_EXTS = [
  'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'ts', 'mpeg', 'mpg',
];

export type HeaderDropFileType = 'pdf' | 'image' | 'video' | 'reader' | 'html';

export type HeaderDropAction =
  | 'pdf-read'
  | 'pdf-edit'
  | 'pdf-compress'
  | 'pdf-convert'
  | 'pdf-import-kb'
  | 'image-view'
  | 'image-compress'
  | 'image-search'
  | 'image-ask-ai'
  | 'video-play'
  | 'reader-read'
  | 'html-open';

// 网页子帧(无 preload)经 window.top.postMessage 把文件拖拽转给顶层 preload 时
// 用的消息键。主进程注入的子帧脚本与 preload file-drag-bridge 共用。
export const PAGE_FILE_DRAG_MESSAGE_KEY = '__rainseeFileDrag';

// 文件松手在顶部面板空白处,或松手在网页上且网页未接管时执行的默认动作。
export const DEFAULT_HEADER_DROP_ACTIONS: Record<
  HeaderDropFileType,
  HeaderDropAction
> = {
  pdf: 'pdf-read',
  image: 'image-view',
  video: 'video-play',
  reader: 'reader-read',
  html: 'html-open',
};

// 取扩展名(小写,无点)。无扩展名返回空串。
export const getFileExt = (filePath: string): string => {
  const idx = filePath.lastIndexOf('.');
  if (idx < 0) return '';
  return filePath.slice(idx + 1).toLowerCase();
};

export const getHeaderDropFileType = (filePath: string): HeaderDropFileType | null => {
  const ext = getFileExt(filePath);
  if (ext === 'pdf') return 'pdf';
  if (IMAGE_FILE_EXTS.includes(ext)) return 'image';
  if (VIDEO_FILE_EXTS.includes(ext)) return 'video';
  if (KOODO_READER_EXTS.includes(ext)) return 'reader';
  if (ext === 'html' || ext === 'htm' || ext === 'mhtml' || ext === 'mht') {
    return 'html';
  }
  return null;
};
