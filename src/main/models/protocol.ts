import { protocol } from 'electron';
import { join, normalize } from 'path';
import { createReadStream, existsSync } from 'fs';
import { parse } from 'url';
import { ERROR_PROTOCOL, WEBUI_PROTOCOL, buildKoodoReaderUrl, filePathFromFileUrl } from '~/constants/files';
import {
  LOCAL_IMAGE_HOST,
  resolveLocalImageToken,
} from '../services/local-image-registry';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'yjllq',
    privileges: {
      bypassCSP: true,
      secure: true,
      standard: true,
      supportFetchAPI: true,
      allowServiceWorkers: true,
      corsEnabled: true,
      // 让 V8 为 yjllq:// 加载的脚本生成/复用字节码缓存。不加此项时,
      // newtab/settings 等 webui 页的 bundle(如 100.bundle.js ~218KB)每次加载
      // (含热启动)都全量编译,无缓存复用 —— 这是"开新标签也慢"的一大原因。
      // 与下方 chrome-extension 协议保持一致。改后须完全重启 app 生效。
      codeCache: true,
    },
  },
  {
    // The error page is loaded as a top-level document via loadURL. Without
    // `standard: true` Chromium can't navigate to yjllq-error://network-error/...
    // and the load fails with ERR_FAILED (-2), which retriggers did-fail-load
    // and (before the view.ts guard) recursed into an ever-growing URL. Packaged
    // builds hit this reliably, so the scheme must be registered as standard.
    scheme: ERROR_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      bypassCSP: true,
    },
  },
  {
    scheme: 'chrome-extension',
    privileges: {
      bypassCSP: true,
      secure: true,
      standard: true,
      supportFetchAPI: true,
      allowServiceWorkers: true,
      corsEnabled: true,
      stream: true,
      codeCache: true
    },
  },
]);

export const registerProtocol = (session: Electron.Session) => {
  session.protocol.registerFileProtocol(
    ERROR_PROTOCOL,
    (request, callback: any) => {
      const parsed = parse(request.url);

      if (parsed.hostname === 'network-error') {
        return callback({
          path: join(__dirname, '../static/pages/', `network-error.html`),
        });
      }
    },
  );

  // 拦截 file:// 协议的电子书文件,重定向到 koodoreader
  session.protocol.interceptStreamProtocol('file', (request, callback) => {
    const url = request.url;
    if (url.startsWith('file:///')) {
      const path = filePathFromFileUrl(url);
      const koodoUrl = buildKoodoReaderUrl(path);
      if (koodoUrl) {
        console.log('[file-nav] file:// intercepted, redirecting to koodoreader:', koodoUrl);
        // 通过 JavaScript 重定向(协议层无法直接返回跨协议 URL)
        const redirectScript = `
          <script>
            window.location.href = '${koodoUrl}';
          </script>
          <body>Redirecting to koodoreader...</body>
        `;
        callback({
          mimeType: 'text/html',
          data: Buffer.from(redirectScript)
        });
        return;
      }

      // 非电子书文件继续按本地文件读取，避免 html/htm 等文件被拦截成 ERR_FAILED。
      const localPath = normalize(path);
      if (existsSync(localPath)) {
        callback({
          data: createReadStream(localPath),
        });
        return;
      }
    }

    callback({ error: -6 });
  });

  // yjllq:// 协议处理器无条件注册。
  // 说明:dev 模式下 app 自身的 webui 页面(settings/newtab 等)走
  // http://localhost:4444 dev server,不经 yjllq;但 koodoreader 阅读器
  // 在任何模式都以 yjllq://web.koodoreader.com/ 加载本地静态资源,故不能
  // 再用 NODE_ENV 守卫把整个处理器剥离(原先 dev 构建会编译成 if(false){},
  // 导致拖拽 PDF 打开 koodoreader 时 loadURL 直接 ERR_FAILED、页面空白)。
  session.protocol.registerFileProtocol(
    WEBUI_PROTOCOL,
    (request, callback: any) => {
      const parsed = parse(request.url);

      if (parsed.hostname === LOCAL_IMAGE_HOST) {
        const token = (parsed.pathname || '').replace(/^\//, '');
        const localImagePath = resolveLocalImageToken(token);
        if (localImagePath && existsSync(localImagePath)) {
          return callback({path: localImagePath});
        }
        return callback({error: -6});
      }

      // koodoreader 阅读器:相对资源解析回 yjllq://web.koodoreader.com/...,
      // 根路径(含 hash 路由 #/pdf)返回其入口 index.html,其余按 path 取文件。
      if (parsed.hostname === 'web.koodoreader.com') {
        const rel = !parsed.pathname || parsed.pathname === '/'
          ? 'index.html'
          : parsed.pathname;
        const filePath = join(__dirname, 'web.koodoreader.com', rel);
        console.log('[koodo] req:', request.url, '-> file:', filePath, 'exists:', existsSync(filePath));
        return callback({ path: filePath });
      }

      // 用 pathname 而非 path:后者含 query string(?section=privacy 等),
      // 会拼进文件路径导致 <dir>/?section=privacy 找不到文件。
      if (parsed.pathname === '/') {
        return callback({
          path: join(__dirname, `${parsed.hostname}.html`),
        });
      }

      callback({ path: join(__dirname, parsed.pathname) });
    },
  );
};
