import type {LoadURLOptions, PostBody} from 'electron';

/**
 * 将 setWindowOpenHandler 回调里的 details.postBody 转成 webContents.loadURL
 * 所需的 options。
 *
 * 背景:网页中 <form method="post" target="_blank"> 提交(以及 window.open 后表单
 * 提交)时,Electron 在 setWindowOpenHandler 的 details.postBody 里带上请求体。
 * HandlerDetails.postBody 文档明示 "Only defined when the window is being created
 * by a form that set target=_blank"。若新标签只 loadURL(details.url) 而丢弃 postBody,
 * 服务端收不到 POST body,表单参数全部丢失。
 *
 * PostBody.data 的元素类型(UploadRawData / UploadFile)与 loadURL 的 postData 一致,
 * 可直接复用;这里对 raw 字节做深拷贝——回调返回后 Electron 的 details 对象可能被
 * 回收,跨 microtask / 异步任务引用原 Buffer 会读到空数据。
 *
 * Content-Type 必须显式经 extraHeaders 设置(multipart 的 boundary 已包含在
 * contentType 内),否则服务端不会按表单解析 POST body。
 */
export function postBodyToLoadOptions(
  postBody?: PostBody | null,
): LoadURLOptions | undefined {
  if (!postBody || !Array.isArray(postBody.data) || postBody.data.length === 0) {
    return undefined;
  }
  const postData = postBody.data.map((part) =>
    part.type === 'rawData'
      ? {type: 'rawData' as const, bytes: Buffer.from(part.bytes)}
      : part,
  );
  const options: LoadURLOptions = {postData};
  if (postBody.contentType) {
    options.extraHeaders = `Content-Type: ${postBody.contentType}`;
  }
  return options;
}
