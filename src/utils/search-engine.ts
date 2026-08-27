import {ISearchEngine} from '~/interfaces';

// 搜索引擎 URL 识别 —— 纯函数,main / renderer 共享。
//
// renderer 侧 search/utils/suggestions.ts 的 extractSearchQuery 与 main 侧「退出时
// 清理搜索历史」(services/clear-on-exit.ts)复用本文件,避免两份实现漂移。原来两边
// 各有一份 parseEngine,改一处忘另一处会导致搜索历史误删/漏删。

// 从引擎模板 url 中解析出 host 与含 %s 的查询参数名。
// 例:'https://www.baidu.com/s?wd=%s' → { host:'baidu.com', queryKey:'wd' }
export const parseEngine = (
  engineUrl: string,
): {host: string; queryKey: string} | null => {
  try {
    const u = new URL(engineUrl.replace('%s', '__Q__'));
    let queryKey = '';
    u.searchParams.forEach((value, key) => {
      if (value.indexOf('__Q__') !== -1) queryKey = key;
    });
    return {host: u.host.replace(/^www\./, ''), queryKey};
  } catch {
    return null;
  }
};

// 从一条 url 中,按任意已配置搜索引擎规则提取搜索词;非搜索结果页或无搜索词返回 null。
// 调用方按需:要布尔判断用 `!= null`,要搜索词用返回值本身。
export const findSearchQuery = (
  rawUrl: string,
  engines: ISearchEngine[],
): string | null => {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = u.host.replace(/^www\./, '');
  for (const engine of engines) {
    const info = parseEngine(engine.url || '');
    if (!info || !info.queryKey) continue;
    if (host !== info.host) continue;
    const q = u.searchParams.get(info.queryKey);
    if (q && q.trim() !== '') return q.trim();
  }
  return null;
};
