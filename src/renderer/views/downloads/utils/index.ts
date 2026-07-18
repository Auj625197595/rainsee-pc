import prettyBytes = require('pretty-bytes');

export type FileCategory =
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'doc'
  | 'app'
  | 'file';

export const formatBytes = (n?: number): string => prettyBytes(n || 0);

// 下载进度百分比(0 - 100)。
export const getProgress = (received?: number, total?: number): number => {
  if (!total || total <= 0) return 0;
  const value = ((received || 0) / total) * 100;
  return Math.max(0, Math.min(100, value));
};

const EXT_MAP: Record<string, FileCategory> = {
  // 图片
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  bmp: 'image',
  svg: 'image',
  ico: 'image',
  // 视频
  mp4: 'video',
  mkv: 'video',
  avi: 'video',
  mov: 'video',
  webm: 'video',
  flv: 'video',
  wmv: 'video',
  // 音频
  mp3: 'audio',
  wav: 'audio',
  flac: 'audio',
  aac: 'audio',
  ogg: 'audio',
  m4a: 'audio',
  // 压缩包
  zip: 'archive',
  rar: 'archive',
  '7z': 'archive',
  tar: 'archive',
  gz: 'archive',
  bz2: 'archive',
  // 文档
  pdf: 'doc',
  doc: 'doc',
  docx: 'doc',
  xls: 'doc',
  xlsx: 'doc',
  ppt: 'doc',
  pptx: 'doc',
  txt: 'doc',
  csv: 'doc',
  md: 'doc',
  // 应用 / 安装包
  exe: 'app',
  msi: 'app',
  dmg: 'app',
  apk: 'app',
  deb: 'app',
  rpm: 'app',
  crx: 'app',
};

export const getFileCategory = (fileName?: string): FileCategory => {
  if (!fileName) return 'file';
  const dot = fileName.lastIndexOf('.');
  if (dot === -1) return 'file';
  const ext = fileName.slice(dot + 1).toLowerCase();
  return EXT_MAP[ext] || 'file';
};
