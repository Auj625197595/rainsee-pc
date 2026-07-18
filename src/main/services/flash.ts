import type {WebContents} from 'electron';

// 只使用能明确表明页面正在加载 Flash 内容的结构化信号。页面正文、标题或普通链接中
// 出现 "Flash" / ".swf" 不算命中，避免说明文档和下载页面触发自动安装。
const FLASH_DETECTION_CODE = `(() => {
  try {
    const flashMime = (value) =>
      /^(?:application\\/x-shockwave-flash|application\\/futuresplash)(?:\\s*;|$)/i.test(
        String(value || '').trim(),
      );
    const swfUrl = (value) => {
      const raw = String(value || '').trim();
      if (!raw) return false;
      if (/^data:application\\/(?:x-shockwave-flash|futuresplash)[;,]/i.test(raw)) {
        return true;
      }
      try {
        const parsed = new URL(raw, document.baseURI);
        return /\\.swf$/i.test(parsed.pathname);
      } catch (_) {
        return /\\.swf(?:[?#]|$)/i.test(raw);
      }
    };

    if (swfUrl(location.href)) return true;

    const players = document.querySelectorAll('object, embed');
    for (let i = 0; i < players.length; i++) {
      const player = players[i];
      if (flashMime(player.getAttribute('type'))) return true;
      if (swfUrl(player.getAttribute('data')) || swfUrl(player.getAttribute('src'))) {
        return true;
      }
      const classId = String(player.getAttribute('classid') || '')
        .replace(/\\s+/g, '')
        .toLowerCase();
      if (classId.indexOf('d27cdb6e-ae6d-11cf-96b8-444553540000') !== -1) {
        return true;
      }
      const codebase = player.getAttribute('codebase');
      if (codebase && /swflash\\.cab(?:[?#]|$)/i.test(codebase)) return true;
    }

    const params = document.querySelectorAll('param[name]');
    for (let i = 0; i < params.length; i++) {
      const name = String(params[i].getAttribute('name') || '').trim().toLowerCase();
      if ((name === 'movie' || name === 'src') && swfUrl(params[i].getAttribute('value'))) {
        return true;
      }
    }

    // 有些旧站会先检测浏览器插件，检测失败后根本不创建 object/embed。常见的
    // Flash 嵌入 API 调用是足够强的证据，只匹配实际调用，不因加载 swfobject.js 误报。
    const scripts = document.scripts || [];
    const flashEmbedCall = /(?:swfobject\\s*\\.\\s*embedSWF|new\\s+SWFObject|AC_FL_RunContent)\\s*\\(/i;
    for (let i = 0; i < scripts.length; i++) {
      if (flashEmbedCall.test(scripts[i].textContent || '')) return true;
    }

    // DOM 节点可能已被兼容性脚本替换，但浏览器仍会留下实际请求过的资源记录。
    if (typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function') {
      const resources = performance.getEntriesByType('resource');
      for (let i = 0; i < resources.length; i++) {
        if (swfUrl(resources[i] && resources[i].name)) return true;
      }
    }
  } catch (_) {}
  return false;
})()`;

const isWebPage = (url: string) => /^https?:\/\//i.test(url || '');

export const detectFlashRequirement = async (
  webContents: WebContents,
): Promise<boolean> => {
  if (!webContents || webContents.isDestroyed()) return false;

  const pageUrl = webContents.getURL();
  if (!isWebPage(pageUrl)) return false;
  try {
    if (/\.swf$/i.test(new URL(pageUrl).pathname)) return true;
  } catch (_) {}

  const mainFrame: any = webContents.mainFrame;
  const frames: any[] = mainFrame?.framesInSubtree || (mainFrame ? [mainFrame] : []);
  const results = await Promise.all(
    frames.map((frame) =>
      frame
        .executeJavaScript(FLASH_DETECTION_CODE, true)
        .then((value: unknown) => value === true)
        .catch(() => false),
    ),
  );
  return results.some(Boolean);
};
