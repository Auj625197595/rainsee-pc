// 书签与系统剪贴板互通:读写 Chromium 书签管理器使用的剪贴板格式
// "chromium/x-bookmark-entries"(base::Pickle 序列化的 BookmarkNodeData),
// 使本浏览器书签管理器与 Chrome/Edge 等 Chromium 内核浏览器之间可以直接
// 复制/粘贴书签和文件夹(含整棵子树)。
//
// 格式对照 components/bookmarks/browser/bookmark_node_data.cc:
//   profile_path(FilePath) | [0(新格式标记)] | element_count | elements...
//   legacy element: is_url bool | url string | title string16 | id int64 |
//                   meta_count u32 | (key string, value string)* |
//                   [folder: child_count u32 | children(legacy)...]
//   新格式 element 与 legacy 字段相同,但每个 element/child 以 WriteData
//   包裹为独立 Pickle(int32 长度 + 带 header 的 pickle 字节)。
// 写出始终用 legacy 格式(新老 Chromium 都能读);读入两种都支持。
// Pickle:4 字节 header(payload_size),每个字段 4 字节对齐,小端序。
// Windows 上 FilePath 走 String16,其它平台走 UTF-8 String。

import {clipboard} from 'electron';
import {spawn} from 'child_process';

export const CHROMIUM_BOOKMARK_FORMAT = 'chromium/x-bookmark-entries';

export interface ClipboardBookmarkNode {
  isFolder: boolean;
  title: string;
  url?: string;
  favicon?: string;
  children: ClipboardBookmarkNode[];
}

const MAX_DEPTH = 500;
const MAX_NODES = 200000;
const MAX_STRING_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_URL_LINES = 1000;

const align4 = (n: number) => (n + 3) & ~3;

class PickleWriter {
  private chunks: Buffer[] = [];
  private size = 0;

  private push(buf: Buffer) {
    const padded = align4(buf.length);
    const out = padded === buf.length ? buf : Buffer.alloc(padded);
    if (out !== buf) buf.copy(out);
    this.chunks.push(out);
    this.size += padded;
  }

  public writeUInt32(v: number) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v >>> 0, 0);
    this.push(b);
  }

  public writeInt32(v: number) {
    const b = Buffer.alloc(4);
    b.writeInt32LE(v | 0, 0);
    this.push(b);
  }

  public writeBool(v: boolean) {
    this.writeInt32(v ? 1 : 0);
  }

  public writeInt64(v: number) {
    const b = Buffer.alloc(8);
    b.writeBigInt64LE(BigInt(Math.trunc(v)), 0);
    this.push(b);
  }

  public writeString(s: string) {
    const bytes = Buffer.from(s, 'utf8');
    this.writeInt32(bytes.length);
    this.push(bytes);
  }

  public writeString16(s: string) {
    const bytes = Buffer.from(s, 'utf16le');
    this.writeInt32(bytes.length / 2);
    this.push(bytes);
  }

  public toBuffer(): Buffer {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(this.size, 0);
    return Buffer.concat([header, ...this.chunks]);
  }
}

class PickleReader {
  private offset = 0;

  private constructor(private payload: Buffer) {}

  // 解析带 header 的 pickle 字节;剪贴板 HGLOBAL 可能向上取整,尾部多余字节忽略。
  public static from(data: Buffer): PickleReader | null {
    if (!data || data.length < 4) return null;
    const payloadSize = data.readUInt32LE(0);
    if (payloadSize > data.length - 4) return null;
    return new PickleReader(data.subarray(4, 4 + payloadSize));
  }

  private take(len: number): Buffer {
    if (len < 0 || this.offset + len > this.payload.length) {
      throw new Error('pickle: out of bounds');
    }
    const out = this.payload.subarray(this.offset, this.offset + len);
    this.offset += align4(len);
    if (this.offset > this.payload.length) this.offset = this.payload.length;
    return out;
  }

  public readUInt32(): number {
    return this.take(4).readUInt32LE(0);
  }

  public readInt32(): number {
    return this.take(4).readInt32LE(0);
  }

  public readBool(): boolean {
    return this.readInt32() !== 0;
  }

  public readInt64(): bigint {
    return this.take(8).readBigInt64LE(0);
  }

  public readString(): string {
    const len = this.readInt32();
    if (len < 0 || len > MAX_STRING_BYTES) throw new Error('pickle: bad string');
    return this.take(len).toString('utf8');
  }

  public readString16(): string {
    const len = this.readInt32();
    if (len < 0 || len * 2 > MAX_STRING_BYTES) {
      throw new Error('pickle: bad string16');
    }
    return this.take(len * 2).toString('utf16le');
  }

  public readData(): Buffer {
    const len = this.readInt32();
    return this.take(len);
  }
}

const writeFilePath = (w: PickleWriter, path: string) => {
  if (process.platform === 'win32') w.writeString16(path);
  else w.writeString(path);
};

const readFilePath = (r: PickleReader) =>
  process.platform === 'win32' ? r.readString16() : r.readString();

const writeLegacyElement = (w: PickleWriter, node: ClipboardBookmarkNode) => {
  const isUrl = !node.isFolder;
  w.writeBool(isUrl);
  w.writeString(isUrl ? node.url || '' : '');
  w.writeString16(node.title || '');
  w.writeInt64(0);
  w.writeUInt32(0); // meta_info_map
  if (!isUrl) {
    w.writeUInt32(node.children.length);
    for (const child of node.children) writeLegacyElement(w, child);
  }
};

export function encodeBookmarkPickle(nodes: ClipboardBookmarkNode[]): Buffer {
  const w = new PickleWriter();
  writeFilePath(w, '');
  w.writeUInt32(nodes.length);
  for (const node of nodes) writeLegacyElement(w, node);
  return w.toBuffer();
}

type DecodeBudget = {nodes: number};

// legacy 与新格式共享字段布局;区别只在子节点是内联还是 WriteData 包裹。
const readElement = (
  r: PickleReader,
  depth: number,
  budget: DecodeBudget,
  nested: boolean,
): ClipboardBookmarkNode => {
  if (++budget.nodes > MAX_NODES) throw new Error('pickle: too many nodes');
  const isUrl = r.readBool();
  const url = r.readString();
  const title = r.readString16();
  r.readInt64();
  const metaCount = r.readUInt32();
  for (let i = 0; i < metaCount; i++) {
    r.readString();
    r.readString();
  }
  const node: ClipboardBookmarkNode = {
    isFolder: !isUrl,
    title,
    url: isUrl ? url : undefined,
    children: [],
  };
  if (!isUrl) {
    if (depth >= MAX_DEPTH) throw new Error('pickle: too deep');
    const count = r.readUInt32();
    for (let i = 0; i < count; i++) {
      if (nested) {
        const child = PickleReader.from(r.readData());
        if (!child) throw new Error('pickle: bad child');
        node.children.push(readElement(child, depth + 1, budget, true));
      } else {
        node.children.push(readElement(r, depth + 1, budget, false));
      }
    }
  }
  return node;
};

export function decodeBookmarkPickle(
  data: Buffer,
): ClipboardBookmarkNode[] | null {
  try {
    const r = PickleReader.from(data);
    if (!r) return null;
    readFilePath(r);
    let count = r.readUInt32();
    // 新格式:profile_path 后先写一个 0 作为兼容哨兵,再写真实数量。
    const nested = count === 0;
    if (nested) count = r.readUInt32();
    if (count > MAX_NODES) return null;
    const budget: DecodeBudget = {nodes: 0};
    const nodes: ClipboardBookmarkNode[] = [];
    for (let i = 0; i < count; i++) {
      if (nested) {
        const element = PickleReader.from(r.readData());
        if (!element) return null;
        nodes.push(readElement(element, 0, budget, true));
      } else {
        nodes.push(readElement(r, 0, budget, false));
      }
    }
    return nodes.filter((n) => n.isFolder || !!n.url);
  } catch (error) {
    console.warn('[bookmark-clipboard] decode failed', error);
    return null;
  }
}

// Chrome 同款纯文本:单个书签写 URL;多项/文件夹按行写 URL 或文件夹名。
const toPlainText = (nodes: ClipboardBookmarkNode[]) => {
  const eol = process.platform === 'win32' ? '\r\n' : '\n';
  return nodes
    .map((n) => (n.isFolder ? n.title || '' : n.url || ''))
    .join(eol);
};

// Electron 的 writeBuffer 会清空剪贴板其它格式,无法与文本同时写入。
// Windows 下先同步写入 pickle(立即可粘贴),再由 PowerShell 用 WinForms
// DataObject 一次性写入 pickle + Unicode 文本,使粘贴到文本框也能得到 URL。
// 脚本先校验剪贴板仍是本次写入的 pickle,避免用户期间复制了别的内容被覆盖。
const PS_WRITE_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$lines = [Console]::In.ReadToEnd().Split([char]10)
$bytes = [Convert]::FromBase64String($lines[0].Trim())
$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($lines[1].Trim()))
$fmt = '${CHROMIUM_BOOKMARK_FORMAT}'
$cur = [System.Windows.Forms.Clipboard]::GetData($fmt)
if ($cur -isnot [System.IO.MemoryStream]) { exit 3 }
if ([Convert]::ToBase64String($cur.ToArray()) -ne $lines[0].Trim()) { exit 4 }
$obj = New-Object System.Windows.Forms.DataObject
$obj.SetData($fmt, (New-Object System.IO.MemoryStream(,$bytes)))
$obj.SetData([System.Windows.Forms.DataFormats]::UnicodeText, $text)
[System.Windows.Forms.Clipboard]::SetDataObject($obj, $true, 5, 100)
`;

const encodedPsScript = () =>
  Buffer.from(PS_WRITE_SCRIPT, 'utf16le').toString('base64');

function appendTextOnWindows(pickle: Buffer, text: string) {
  try {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-STA',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        encodedPsScript(),
      ],
      {windowsHide: true, stdio: ['pipe', 'ignore', 'pipe']},
    );
    let stderr = '';
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('error', (error) =>
      console.warn('[bookmark-clipboard] text writer spawn failed', error),
    );
    child.on('exit', (code) => {
      // 3/4 = 剪贴板已被替换,属预期,不记日志。
      if (code && code !== 3 && code !== 4) {
        console.warn('[bookmark-clipboard] text writer exit', code, stderr.trim());
      }
    });
    child.stdin.end(
      `${pickle.toString('base64')}\n${Buffer.from(text, 'utf8').toString('base64')}\n`,
    );
  } catch (error) {
    console.warn('[bookmark-clipboard] text writer failed', error);
  }
}

// 写入系统剪贴板,返回写入的 pickle 字节(用于判断剪贴板是否仍是本次内容)。
export function writeBookmarksToClipboard(
  nodes: ClipboardBookmarkNode[],
): Buffer {
  const pickle = encodeBookmarkPickle(nodes);
  clipboard.writeBuffer(CHROMIUM_BOOKMARK_FORMAT, pickle);
  const text = toPlainText(nodes);
  if (process.platform === 'win32' && text) {
    appendTextOnWindows(pickle, text);
  }
  return pickle;
}

export function readClipboardPickle(): Buffer | null {
  try {
    const buf = clipboard.readBuffer(CHROMIUM_BOOKMARK_FORMAT);
    return buf && buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

// 剪贴板里的 pickle 是否就是 expected(HGLOBAL 尾部可能多出对齐字节)。
export function isClipboardPickle(expected: Buffer | null | undefined): boolean {
  if (!expected) return false;
  const current = readClipboardPickle();
  return (
    !!current &&
    current.length >= expected.length &&
    current.subarray(0, expected.length).equals(expected)
  );
}

const TEXT_URL_PATTERN = /^(https?|ftp|file):\/\//i;

const parseTextUrls = (text: string): ClipboardBookmarkNode[] => {
  const lines = (text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0 || lines.length > MAX_TEXT_URL_LINES) return [];
  const nodes: ClipboardBookmarkNode[] = [];
  for (const line of lines) {
    if (!TEXT_URL_PATTERN.test(line)) return [];
    try {
      const url = new URL(line).href;
      nodes.push({isFolder: false, title: line, url, children: []});
    } catch {
      return [];
    }
  }
  return nodes;
};

// 读取顺序与 Chromium 一致:先书签 pickle,再单个 URL 书签格式;
// 额外兜底纯文本里逐行都是网址的情况(从记事本等复制的网址列表)。
export function readBookmarksFromClipboard(): ClipboardBookmarkNode[] {
  const pickle = readClipboardPickle();
  if (pickle) {
    const nodes = decodeBookmarkPickle(pickle);
    if (nodes && nodes.length > 0) return nodes;
  }

  if (process.platform === 'win32' || process.platform === 'darwin') {
    try {
      const {title, url} = clipboard.readBookmark();
      if (url && TEXT_URL_PATTERN.test(url)) {
        return [{isFolder: false, title: title || url, url, children: []}];
      }
    } catch {
      // readBookmark 不可用时继续文本兜底
    }
  }

  return parseTextUrls(clipboard.readText());
}

export function clipboardHasBookmarks(): boolean {
  return readBookmarksFromClipboard().length > 0;
}

export function countClipboardNodes(nodes: ClipboardBookmarkNode[]) {
  let bookmarks = 0;
  let folders = 0;
  const walk = (list: ClipboardBookmarkNode[]) => {
    for (const node of list) {
      if (node.isFolder) {
        folders += 1;
        walk(node.children);
      } else {
        bookmarks += 1;
      }
    }
  };
  walk(nodes);
  return {bookmarks, folders};
}
