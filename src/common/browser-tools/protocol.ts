// 雨见AI 浏览器工具协议(MCP 风格:tools/list + tools/call)。
// 这是跨端契约:不依赖 electron/node,安卓/iOS 端照此结构实现同名工具即可让
// 同一份 AI 前端/后端逻辑复用。详见 md/ai-browser-tools.md。

export const BROWSER_TOOLS_PROTOCOL = 'rainsee-browser-tools/1';

// read:只读,直接执行;write:可逆或低风险写操作,直接执行;
// dangerous:不可逆/影响面大,宿主必须自行弹原生确认(页面侧确认不算安全边界)。
export type BrowserToolRisk = 'read' | 'write' | 'dangerous';

export interface JsonSchema {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: Array<string | number>;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  maxItems?: number;
  additionalProperties?: boolean;
}

export interface BrowserToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  risk: BrowserToolRisk;
  // false = 仅供 AI 页面 UI 直接调用(如"应用"按钮),不下发给模型。
  exposeToModel?: boolean;
}

export type BrowserToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export interface BrowserToolResult {
  content: BrowserToolContent[];
  isError?: boolean;
  // 机器可读的结构化结果(可选),AI 页面 UI 用,如 previewId。
  structured?: Record<string, unknown>;
}

export type BrowserToolErrorCode =
  | 'unknown_tool'
  | 'invalid_arguments'
  | 'user_denied'
  | 'not_available'
  | 'timeout'
  | 'failed';

export class BrowserToolError extends Error {
  public constructor(public code: BrowserToolErrorCode, message: string) {
    super(message);
  }
}

export interface BrowserToolsListResponse {
  protocol: string;
  platform: string;
  tools: BrowserToolDefinition[];
}

export const textResult = (
  value: unknown,
  structured?: Record<string, unknown>,
): BrowserToolResult => ({
  content: [
    {
      type: 'text',
      text: typeof value === 'string' ? value : JSON.stringify(value),
    },
  ],
  ...(structured ? { structured } : {}),
});

export const errorResult = (
  code: BrowserToolErrorCode,
  message: string,
): BrowserToolResult => ({
  content: [{ type: 'text', text: `[${code}] ${message}` }],
  isError: true,
  structured: { errorCode: code },
});
