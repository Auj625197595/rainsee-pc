// Lightweight favicon URL builder for renderer entry points and default
// settings. Keep the full address-bar URL parser out of small popup bundles.
export const getLightweightIconUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname) return '';
    // 公共图标服务:DuckDuckGo favicon 服务
    return `https://icons.duckduckgo.com/ip3/${parsed.hostname}.ico`;
  } catch {
    return '';
  }
};
