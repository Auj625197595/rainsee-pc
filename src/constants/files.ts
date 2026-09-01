import { DEFAULT_SETTINGS } from './settings';
export {
  ERROR_PROTOCOL,
  NETWORK_ERROR_HOST,
  WEBUI_BASE_URL,
  WEBUI_PROTOCOL,
  WEBUI_URL_SUFFIX,
} from './protocols';
import {
  WEBUI_BASE_URL,
  WEBUI_PROTOCOL,
} from './protocols';

export const DIRECTORIES = ['adblock', 'extensions', 'storage'];

// koodoreader 支持的电子书格式(扩展名小写,无点)。
// router/index.tsx 为每种格式注册了 /<ext> 路由(全部指向 HtmlReader),
// 故路由即扩展名。拖拽/打开这些格式时用 yjllq://web.koodoreader.com/#/<ext>?filePath=<绝对路径> 直开。
export const KOODO_READER_EXTS = [
  'pdf', 'epub', 'txt', 'mobi', 'azw3', 'azw',
  'cbr', 'cbz', 'cbt', 'cb7', 'docx', 'md', 'fb2',
];

// 地址栏拖拽可直接打开的本地文件:koodoreader 格式 + html(走 file://)。
export const OPENABLE_FILE_EXTS = [...KOODO_READER_EXTS, 'html', 'htm'];

export const IMAGE_FILE_EXTS = [
  'jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'avif', 'tif', 'tiff',
];

export const VIDEO_FILE_EXTS = [
  'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'ts', 'mpeg', 'mpg',
];

export type HeaderDropFileType = 'pdf' | 'image' | 'video' | 'reader' | 'html';

export const getHeaderDropFileType = (filePath: string): HeaderDropFileType | null => {
  const ext = getFileExt(filePath);
  if (ext === 'pdf') return 'pdf';
  if (IMAGE_FILE_EXTS.includes(ext)) return 'image';
  if (VIDEO_FILE_EXTS.includes(ext)) return 'video';
  if (KOODO_READER_EXTS.includes(ext)) return 'reader';
  if (ext === 'html' || ext === 'htm') return 'html';
  return null;
};

// 取扩展名(小写,无点)。无扩展名返回空串。
export const getFileExt = (filePath: string): string => {
  const idx = filePath.lastIndexOf('.');
  if (idx < 0) return '';
  return filePath.slice(idx + 1).toLowerCase();
};

export const isKoodoReaderFile = (filePath: string): boolean =>
  KOODO_READER_EXTS.includes(getFileExt(filePath));

// 构造 koodoreader 直开 URL。不支持的扩展名返回 null。
// filePath 用正斜杠(file:// 与 URL 编码要求),编码后拼到 #/<ext>?filePath=。
export const buildKoodoReaderUrl = (filePath: string): string | null => {
  const ext = getFileExt(filePath);
  if (!KOODO_READER_EXTS.includes(ext)) return null;
  const encoded = encodeURIComponent(filePath.replace(/\\/g, '/'));
  return `${WEBUI_PROTOCOL}://web.koodoreader.com/#/${ext}?filePath=${encoded}`;
};

// 反向:file:/// URL → 本地路径(Windows 反斜杠)。URL 解析会剥离查询参数和锚点。
export const filePathFromFileUrl = (url: string): string =>
  decodeURIComponent(new URL(url).pathname.replace(/^\//, '')).replace(/\//g, '\\');

export const FILES = {
  'settings.json': DEFAULT_SETTINGS,
  'window-data.json': {},
};
