export const parseYjllqGoUrl = (rawUrl: string): string | null => {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'yjllq:') return null;

    // 兼容标准格式 yjllq://gourl/#<url> 和旧格式 yjllq:gourl#<url>。
    const action = (parsed.hostname || parsed.pathname).replace(/^\/+|\/+$/g, '');
    if (action.toLowerCase() !== 'gourl') return null;

    const target = parsed.hash.slice(1);
    const targetUrl = new URL(target);
    if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
      return null;
    }
    return targetUrl.toString();
  } catch {
    return null;
  }
};
