import { DEFAULT_SETTINGS } from './settings';
import { fileURLToPath } from 'url';
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

export {
  KOODO_READER_EXTS,
  OPENABLE_FILE_EXTS,
  IMAGE_FILE_EXTS,
  VIDEO_FILE_EXTS,
  DEFAULT_HEADER_DROP_ACTIONS,
  getHeaderDropFileType,
  getFileExt,
} from './file-drop';
export type { HeaderDropAction, HeaderDropFileType } from './file-drop';
import { KOODO_READER_EXTS, getFileExt } from './file-drop';

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

// 反向:file:/// URL → 当前平台的本地路径。fileURLToPath 会正确处理
// macOS/Linux 的绝对 POSIX 路径以及 Windows 的盘符/反斜杠，不能手工替换
// URL pathname，否则 macOS 会丢失开头的 `/` 并把路径变成无效的相对路径。
export const filePathFromFileUrl = (url: string): string => fileURLToPath(url);

export const FILES = {
  'settings.json': DEFAULT_SETTINGS,
  'window-data.json': {},
};
