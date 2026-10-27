import {
  rendererCapabilities,
  ImageUploadConfig,
  ImageUploadResult,
} from './sandbox-bridge';

// 图片上传拦截(网页世界侧)。
//
// 文件选择框关闭后 Chromium 依次派发 input → change。preload 先于页面脚本执行,
// 这里在 window 捕获阶段最先拿到事件并 stopImmediatePropagation,页面监听器一个
// 都收不到;把图片交给主进程弹窗处理,拿回结果后改写 input.files 再补派发事件。
// 很多上传库用脱离文档的 <input> 调 click() 选文件,事件不冒泡到 window,故同时
// 在 click()/showPicker() 时给元素本身挂捕获监听(目标阶段捕获先于冒泡执行)。

const PROCESSABLE = /^image\/(jpeg|png|webp|bmp)$/i;
const MAX_BYTES = 60 * 1024 * 1024;

let config: ImageUploadConfig = rendererCapabilities.imageUpload.getConfig() || {
  enabled: true,
  bypassSites: [],
};
rendererCapabilities.imageUpload.onConfigChanged((next) => {
  if (next) config = next;
});

// 我们自己补派发的事件,监听器见到直接放行。
const ownEvents = new WeakSet<Event>();
// 正在处理中的 input:期间到达的 input/change 全部吞掉。
const busy = new WeakSet<HTMLInputElement>();
const armed = new WeakSet<HTMLInputElement>();

const isFileInput = (el: unknown): el is HTMLInputElement =>
  el instanceof HTMLInputElement && el.type === 'file';

const isBypassed = () => {
  if (!config || config.enabled === false) return true;
  const host = location.hostname;
  return (config.bypassSites || []).some(
    (site) => host === site || host.endsWith(`.${site}`),
  );
};

const redispatch = (input: HTMLInputElement) => {
  for (const type of ['input', 'change']) {
    const ev = new Event(type, { bubbles: true });
    ownEvents.add(ev);
    input.dispatchEvent(ev);
  }
};

const handleSelection = async (input: HTMLInputElement, original: File[]) => {
  const indices: number[] = [];
  const files: { name: string; type: string; bytes: Uint8Array; lastModified: number }[] = [];
  for (let i = 0; i < original.length; i++) {
    const f = original[i];
    if (!PROCESSABLE.test(f.type) || f.size > MAX_BYTES) continue;
    indices.push(i);
    files.push({
      name: f.name,
      type: f.type,
      bytes: new Uint8Array(await f.arrayBuffer()),
      lastModified: f.lastModified,
    });
  }

  let result: ImageUploadResult;
  try {
    result = await rendererCapabilities.imageUpload.intercept({
      files,
      accept: input.accept || '',
      multiple: input.multiple,
      host: location.hostname,
    });
  } catch (err) {
    console.warn('[image-upload] intercept failed', err);
    result = { action: 'original' };
  }

  if (result?.action === 'cancel') {
    // 等同于用户在选择框里点了取消:清空且不通知页面。
    try {
      input.value = '';
    } catch {
      // ignore
    }
    return;
  }

  if (result?.action === 'upload' && Array.isArray(result.files)) {
    const next = original.slice();
    result.files.forEach((f, k) => {
      const idx = indices[k];
      if (idx == null || !f || !f.bytes) return;
      next[idx] = new File([f.bytes], f.name, {
        type: f.type,
        lastModified: f.lastModified || Date.now(),
      });
    });
    try {
      const dt = new DataTransfer();
      next.forEach((f) => dt.items.add(f));
      input.files = dt.files;
    } catch (err) {
      console.warn('[image-upload] write back failed', err);
    }
  }
  redispatch(input);
};

const onFileEvent = (event: Event) => {
  if (ownEvents.has(event)) return;
  const input = event.target;
  if (!isFileInput(input)) return;

  if (busy.has(input)) {
    // 处理中:同一次选择的后续 input/change 一并吞掉,结束后统一补派发。
    event.stopImmediatePropagation();
    return;
  }
  if (isBypassed()) return;
  const original = Array.from(input.files || []);
  if (!original.some((f) => PROCESSABLE.test(f.type) && f.size <= MAX_BYTES)) {
    return;
  }

  event.stopImmediatePropagation();
  busy.add(input);
  // 留一拍让紧随其后的 change 也被吞掉,再开始处理。
  setTimeout(() => {
    handleSelection(input, original)
      .catch((err) => console.warn('[image-upload]', err))
      .finally(() => busy.delete(input));
  }, 0);
};

const arm = (input: HTMLInputElement) => {
  if (armed.has(input)) return;
  armed.add(input);
  input.addEventListener('input', onFileEvent, true);
  input.addEventListener('change', onFileEvent, true);
};

try {
  window.addEventListener('input', onFileEvent, true);
  window.addEventListener('change', onFileEvent, true);

  const proto = HTMLInputElement.prototype;
  const nativeClick = proto.click;
  proto.click = function click(this: HTMLInputElement) {
    if (this.type === 'file') arm(this);
    return nativeClick.call(this);
  };
  const nativeShowPicker = (proto as any).showPicker;
  if (typeof nativeShowPicker === 'function') {
    (proto as any).showPicker = function showPicker(this: HTMLInputElement) {
      if (this.type === 'file') arm(this);
      return nativeShowPicker.call(this);
    };
  }
} catch (err) {
  console.warn('[image-upload] install failed', err);
}
