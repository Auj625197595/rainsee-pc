import prettyBytes = require('pretty-bytes');
import { normalizeDownloadSpeed } from '~/common/download-speed';

export { getFileCategory } from '~/renderer/components/FileTypeIcon';
export type { FileCategory } from '~/renderer/components/FileTypeIcon';

export const formatBytes = (n?: number): string => prettyBytes(n || 0);

export const formatSpeed = (n?: number): string =>
  `${prettyBytes(normalizeDownloadSpeed(n))}/s`;

// 下载进度百分比(0 - 100)。
export const getProgress = (received?: number, total?: number): number => {
  if (!total || total <= 0) return 0;
  const value = ((received || 0) / total) * 100;
  return Math.max(0, Math.min(100, value));
};
