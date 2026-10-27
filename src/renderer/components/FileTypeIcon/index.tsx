import * as React from 'react';

// 下载弹窗与下载页共用的文件类型识别 + 图标(内联 SVG,跟随 currentColor)。

export type FileCategory =
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'pdf'
  | 'doc'
  | 'sheet'
  | 'slides'
  | 'code'
  | 'app'
  | 'file';

const EXT_GROUPS: Record<Exclude<FileCategory, 'file'>, string[]> = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif', 'heic', 'tif', 'tiff'],
  video: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'm4v', 'ts', 'm3u8', 'rmvb'],
  audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'opus', 'wma', 'ape'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'iso', 'zst'],
  pdf: ['pdf'],
  doc: ['doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'epub', 'wps'],
  sheet: ['xls', 'xlsx', 'csv', 'ods', 'et'],
  slides: ['ppt', 'pptx', 'odp', 'key', 'dps'],
  code: ['js', 'ts', 'json', 'html', 'css', 'xml', 'py', 'java', 'c', 'cpp', 'go', 'rs', 'sh', 'bat', 'ps1', 'yml', 'yaml'],
  app: ['exe', 'msi', 'dmg', 'apk', 'deb', 'rpm', 'crx', 'appx', 'msix', 'pkg'],
};

const EXT_MAP: Record<string, FileCategory> = {};
for (const [category, exts] of Object.entries(EXT_GROUPS)) {
  for (const ext of exts) EXT_MAP[ext] = category as FileCategory;
}

export const getFileExt = (fileName?: string): string => {
  if (!fileName) return '';
  const dot = fileName.lastIndexOf('.');
  if (dot === -1 || dot === fileName.length - 1) return '';
  return fileName.slice(dot + 1).toLowerCase();
};

export const getFileCategory = (fileName?: string): FileCategory =>
  EXT_MAP[getFileExt(fileName)] || 'file';

// 每类的前景/浅底色,浅色与深色主题各一套。
export const FILE_TYPE_COLORS: Record<
  FileCategory,
  { fg: string; bg: string; darkFg: string; darkBg: string }
> = {
  image: { fg: '#1f9d6b', bg: '#e6f7ef', darkFg: '#6fd6a8', darkBg: 'rgba(52,195,143,0.16)' },
  video: { fg: '#7b4fe0', bg: '#f0eaff', darkFg: '#b79cff', darkBg: 'rgba(123,79,224,0.2)' },
  audio: { fg: '#d64598', bg: '#fdeaf4', darkFg: '#f29ac9', darkBg: 'rgba(214,69,152,0.18)' },
  archive: { fg: '#c98410', bg: '#fff3dc', darkFg: '#f3c26a', darkBg: 'rgba(240,178,77,0.18)' },
  pdf: { fg: '#d93f3f', bg: '#ffe9e9', darkFg: '#ff9393', darkBg: 'rgba(217,63,63,0.18)' },
  doc: { fg: '#2f6fe4', bg: '#e8f0ff', darkFg: '#93b6ff', darkBg: 'rgba(47,111,228,0.2)' },
  sheet: { fg: '#18905a', bg: '#e4f6ec', darkFg: '#72d3a0', darkBg: 'rgba(24,144,90,0.2)' },
  slides: { fg: '#e0642a', bg: '#ffede4', darkFg: '#ffab82', darkBg: 'rgba(224,100,42,0.18)' },
  code: { fg: '#3d6b8f', bg: '#e8f0f6', darkFg: '#9cc3e0', darkBg: 'rgba(61,107,143,0.24)' },
  app: { fg: '#3452ff', bg: '#eef2ff', darkFg: '#9db0ff', darkBg: 'rgba(52,82,255,0.18)' },
  file: { fg: '#6f7c96', bg: '#eff2f7', darkFg: 'rgba(255,255,255,0.7)', darkBg: 'rgba(255,255,255,0.08)' },
};

const Svg = ({ children, size }: { children: React.ReactNode; size: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const PAGE = (
  <>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </>
);

const GLYPHS: Record<FileCategory, React.ReactNode> = {
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </>
  ),
  video: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M10 9l5 3-5 3z" />
    </>
  ),
  audio: (
    <>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </>
  ),
  archive: (
    <>
      <path d="M21 8v13H3V8" />
      <path d="M1 3h22v5H1z" />
      <path d="M10 12h4" />
    </>
  ),
  pdf: (
    <>
      {PAGE}
      <path d="M8 13h2.5a1.5 1.5 0 0 1 0 3H8v-3zM8 16v2" />
      <path d="M14 13v5M14 13h2.5M14 15.5h2" />
    </>
  ),
  doc: (
    <>
      {PAGE}
      <path d="M8 13h8" />
      <path d="M8 17h5" />
    </>
  ),
  sheet: (
    <>
      {PAGE}
      <path d="M8 12h8v6H8z" />
      <path d="M12 12v6M8 15h8" />
    </>
  ),
  slides: (
    <>
      {PAGE}
      <rect x="8" y="12" width="8" height="5" rx="0.5" />
    </>
  ),
  code: (
    <>
      <path d="M8 8l-4 4 4 4" />
      <path d="M16 8l4 4-4 4" />
      <path d="M13.5 5l-3 14" />
    </>
  ),
  app: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
    </>
  ),
  file: PAGE,
};

export const FileTypeIcon = ({
  category,
  size = 20,
}: {
  category: FileCategory;
  size?: number;
}) => <Svg size={size}>{GLYPHS[category]}</Svg>;
