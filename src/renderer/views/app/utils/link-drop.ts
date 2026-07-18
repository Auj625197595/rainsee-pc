import { isURL } from '~/utils';

type DragLike = {
  dataTransfer?: DataTransfer | null;
};

const escapeHTML = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const isLinkDragEvent = (e: DragLike): boolean => {
  const types = e.dataTransfer ? Array.from(e.dataTransfer.types || []) : [];
  return types.includes('text/uri-list') || types.includes('text/plain');
};

export const getDraggedLinkURL = (
  dataTransfer: DataTransfer | null | undefined,
): string => {
  if (!dataTransfer) return '';

  let url = '';
  const uri = dataTransfer.getData('text/uri-list');

  if (uri) {
    url =
      uri
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith('#')) || '';
  }

  if (!url) {
    url = (dataTransfer.getData('text/plain') || '').trim();
  }

  return url && isURL(url) ? url : '';
};

export const setDraggedLinkData = (
  dataTransfer: DataTransfer | null | undefined,
  payload: { url?: string; title?: string },
) => {
  const url = (payload.url || '').trim();
  if (!dataTransfer || !url || !isURL(url)) return;

  try {
    dataTransfer.effectAllowed = 'copy';
    dataTransfer.setData('text/uri-list', url);
    dataTransfer.setData('text/plain', url);
    if (payload.title) {
      dataTransfer.setData(
        'text/html',
        `<a href="${escapeHTML(url)}">${escapeHTML(payload.title)}</a>`,
      );
    }
  } catch {
    // 某些嵌入页/平台可能限制 dataTransfer 写入，静默降级。
  }
};
