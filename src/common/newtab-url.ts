// 新标签页(pcapp.rainsee.cn)URL 参数拼接工具。
// 纯字符串处理,主进程与渲染进程(包括 nodeIntegration: false 的页面)均可引用。

export interface IDeviceParams {
  // 登录 cookie,目前留空,等待后续接入
  ck: string;
  // 设备唯一标识,首次启动时生成并持久化
  devid: string;
  // windows / mac
  prod: string;
  // 系统语言,如 zh-CN
  lang: string;
}

export const NEWTAB_PARAMS_HOST = 'pcapp.rainsee.cn';

// 将设备参数插入到 hash(#/)之前:
// https://pcapp.rainsee.cn/#/ -> https://pcapp.rainsee.cn/?ck=&devid=xxx&prod=windows&lang=zh-CN#/
// 仅对 pcapp.rainsee.cn 生效,扩展接管的新标签页(chrome-extension://)不会被附加参数。
export const appendDeviceParams = (
  url: string,
  params: IDeviceParams | null,
): string => {
  if (!url || !params || !url.includes(NEWTAB_PARAMS_HOST)) return url;

  const hashIndex = url.indexOf('#');
  const base = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex);

  const query = [
    `ck=${encodeURIComponent(params.ck)}`,
    `devid=${encodeURIComponent(params.devid)}`,
    `prod=${encodeURIComponent(params.prod)}`,
    `lang=${encodeURIComponent(params.lang)}`,
  ].join('&');

  return base + (base.includes('?') ? '&' : '?') + query + hash;
};
