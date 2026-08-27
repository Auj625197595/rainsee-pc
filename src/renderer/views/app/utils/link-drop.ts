import { isURL } from '~/utils';

type DragLike = {
  dataTransfer?: DataTransfer | null;
};

export type DraggedLinkData = {
  url: string;
  title: string;
};

const escapeHTML = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const isLinkDragEvent = (e: DragLike): boolean => {
  const types = e.dataTransfer ? Array.from(e.dataTransfer.types || []) : [];
  return (
    types.includes('text/uri-list') ||
    types.includes('text/x-moz-url') ||
    types.includes('text/html') ||
    types.includes('text/plain')
  );
};

export const getDraggedLinkData = (
  dataTransfer: DataTransfer | null | undefined,
): DraggedLinkData | null => {
  if (!dataTransfer) return null;

  let url = '';
  let title = '';
  const mozURL = dataTransfer.getData('text/x-moz-url');

  if (mozURL) {
    const [mozLink, mozTitle] = mozURL.split(/\r?\n/);
    if (mozLink && isURL(mozLink.trim())) {
      url = mozLink.trim();
      title = (mozTitle || '').trim();
    }
  }

  const uri = dataTransfer.getData('text/uri-list');

  if (!url && uri) {
    url =
      uri
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith('#')) || '';
  }

  if (!url) {
    url = (dataTransfer.getData('text/plain') || '').trim();
  }

  const html = dataTransfer.getData('text/html');
  if (html) {
    try {
      const anchor = new DOMParser()
        .parseFromString(html, 'text/html')
        .querySelector('a');
      if (!url) url = (anchor?.getAttribute('href') || '').trim();
      if (!title) title = (anchor?.textContent || '').trim();
    } catch {
      // 拖拽来源提供了无效 HTML 时使用 URL 作为标题。
    }
  }

  if (!url || !isURL(url)) return null;

  return { url, title: title || url };
};

export const getDraggedLinkURL = (
  dataTransfer: DataTransfer | null | undefined,
): string => getDraggedLinkData(dataTransfer)?.url || '';

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
