import { protocol } from 'electron';
import { randomUUID } from 'crypto';
import { join, normalize, resolve, relative, isAbsolute } from 'path';
import { createReadStream, existsSync, realpathSync, statSync } from 'fs';
import { parse } from 'url';
import { ERROR_PROTOCOL, WEBUI_PROTOCOL, buildKoodoReaderUrl, filePathFromFileUrl, getFileExt } from '~/constants/files';
import {
  LOCAL_IMAGE_HOST,
  resolveLocalImageToken,
} from '../services/local-image-registry';
import {getPath} from '~/utils';

const THEME_ASSET_HOST = 'theme-assets';

// 打印预览 PDF 只在内存中保存，窗口关闭后立即释放。使用独立协议而非 file://，
// 避免被本项目的本地电子书重定向规则交给 KoodoReader。
export const PRINT_PREVIEW_PROTOCOL = 'yjllq-print-preview';
const PRINT_PREVIEW_HOST = 'document';
const printPreviewDocuments = new Map<string, Buffer>();

export const createPrintPreviewUrl = (data: Buffer): string => {
  const id = randomUUID();
  printPreviewDocuments.set(id, data);
  return `${PRINT_PREVIEW_PROTOCOL}://${PRINT_PREVIEW_HOST}/${id}.pdf`;
};

export const releasePrintPreviewUrl = (url: string) => {
  try {
    const parsed = parse(url);
    if (parsed.hostname !== PRINT_PREVIEW_HOST) return;
    const id = (parsed.pathname || '').replace(/^\//, '').replace(/\.pdf$/i, '');
    printPreviewDocuments.delete(id);
  } catch {
    // 窗口清理不应因 URL 解析异常而中断
  }
};

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
  {
    scheme: PRINT_PREVIEW_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      stream: true,
    },
  },
]);

// file:// 非电子书资源按扩展名直给 MIME。
// 不给 mimeType 时 Chromium 嗅探 Content-Type,在 persist:view 扩展会话下会把
// SVG 等子资源误判为 text/html → <img> naturalWidth=0(见 view-preload 的
// installLocalSvgImageFallback,本处是根因修复)。未命中扩展名回落 undefined,
// 保留旧行为(嗅探),避免对未覆盖类型回归。
const MIME_BY_EXT: Record<string, string> = {
  htm: 'text/html',
  html: 'text/html',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
  xml: 'application/xml',
  txt: 'text/plain',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogg: 'application/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  pdf: 'application/pdf',
};

export const registerProtocol = (session: Electron.Session) => {
  // BrowserWindow 的默认会话和网页标签的隔离会话都会走这里注册。PDF 数据不落地，
  // 仅允许由 createPrintPreviewUrl 创建的随机 URL 读取。
  if (!session.protocol.isProtocolRegistered(PRINT_PREVIEW_PROTOCOL)) {
    session.protocol.registerBufferProtocol(
      PRINT_PREVIEW_PROTOCOL,
      (request, callback) => {
        const parsed = parse(request.url);
        if (parsed.hostname !== PRINT_PREVIEW_HOST) {
          callback({ error: -6 });
          return;
        }

        const id = (parsed.pathname || '').replace(/^\//, '').replace(/\.pdf$/i, '');
        const data = printPreviewDocuments.get(id);
        callback(data ? { data, mimeType: 'application/pdf' } : { error: -6 });
      },
    );
  }

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
          mimeType: MIME_BY_EXT[getFileExt(localPath)],
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

      // Theme resources use a read-only host and stay inside their extension.
      // realpathSync also prevents a symlink/junction from escaping that root.
      if (parsed.hostname === THEME_ASSET_HOST) {
        try {
          const parts = (parsed.pathname || '')
            .split('/')
            .filter(Boolean)
            .map((part) => decodeURIComponent(part));
          const id = parts.shift() || '';
          if (!/^[a-p]{32}$/.test(id) || parts.length === 0) {
            return callback({error: -6});
          }
          const extensionRoot = realpathSync(
            resolve(getPath('extensions'), id),
          );
          const assetPath = realpathSync(resolve(extensionRoot, ...parts));
          const rel = relative(extensionRoot, assetPath);
          if (
            !rel ||
            rel.startsWith('..') ||
            isAbsolute(rel) ||
            !statSync(assetPath).isFile()
          ) {
            return callback({error: -6});
          }
          return callback({path: assetPath});
        } catch {
          return callback({error: -6});
        }
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
