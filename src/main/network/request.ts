import * as http from 'http';
import * as https from 'https';
import { ResponseDetails } from '~/common/rpc/network';
import { ChromeUserAgent } from '../user-agent';

export interface RequestURLOptions {
  // 追加/覆盖请求头。默认已带浏览器 UA;调用方可在此传 Referer 等。
  headers?: Record<string, string>;
}

// 下载 URL 返回 {statusCode, data}。默认带 Chrome UA——很多服务器对无 UA 的
// 请求(Node 裸 http 默认不带 User-Agent)直接返回 403/404,导致 favicon /
// 书签图标下载失败。调用方可通过 options.headers 追加 Referer 等。
export const requestURL = (
  url: string,
  options: RequestURLOptions = {},
): Promise<ResponseDetails> =>
  new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'User-Agent': ChromeUserAgent,
      ...options.headers,
    };

    const req = (/^https:\/\//i.test(url) ? https : http).request(
      url,
      { headers },
      (res) => {
        let data = '';
        res.setEncoding('binary');

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            data,
          });
        });

        res.on('error', (e) => {
          reject(e);
        });
      },
    );

    req.on('error', (e) => {
      reject(e);
    });

    req.end();
  });
