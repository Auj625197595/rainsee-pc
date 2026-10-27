// 判定提交的地址是否与当前页一致:点击地址栏/搜索弹窗后未改网址直接回车的场景。
// 命中时即使开了「新标签搜索」也只在当前页重新加载,不重复开一个相同页面。
// 末尾斜杠与 host 大小写差异不算变更;pathname/query/hash 变化视为已变更。
export const isSamePageUrl = (next: string, current: string): boolean => {
  const a = (next || '').trim();
  const b = (current || '').trim();
  if (!a || !b) return false;

  const normalize = (value: string) => {
    try {
      const parsed = new URL(value);
      return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}${parsed.hash}`;
    } catch {
      // 非 URL 形态(内部协议被裁剪等):按字符串宽松比对,仅忽略末尾斜杠。
      return value.replace(/\/+$/, '');
    }
  };

  return normalize(a) === normalize(b);
};
