/* eslint-disable */
// 一次性代码生成器：把 dom_picker.js 移植为 src/main/services/adblock-picker.ts
// 用法: node scripts/gen-adblock-picker.js <源dom_picker.js路径>
const fs = require('fs');
const path = require('path');

const SRC =
  process.argv[2] ||
  'D:/code/browserv4/browser142/moduleMain/src/main/assets/adblock/dom_picker.js';
const OUT = path.resolve(__dirname, '../src/main/services/adblock-picker.ts');

const src = fs.readFileSync(SRC, 'utf8');

const i18n = {
  __YJ_PICKER_I18N_DRAG_HANDLE__: '拖动面板',
  __YJ_PICKER_I18N_PARENT__: '上一层',
  __YJ_PICKER_I18N_CHILD__: '下一层',
  __YJ_PICKER_I18N_BACK__: '返回',
  __YJ_PICKER_I18N_PREVIEW_HIDE__: '预览隐藏',
  __YJ_PICKER_I18N_PREVIEW_CANCEL__: '取消预览',
  __YJ_PICKER_I18N_SAVE_RULE__: '隐藏元素',
  __YJ_PICKER_I18N_BLOCK_RESOURCE__: '拦截资源',
  __YJ_PICKER_I18N_CANCEL__: '取消',
  __YJ_PICKER_I18N_MATCHES__: '匹配 %1$s 个',
  __YJ_PICKER_I18N_SIZE__: '尺寸 %1$s×%2$s',
  __YJ_PICKER_I18N_CHILD_HISTORY__: '已展开 %1$s 层',
  __YJ_PICKER_I18N_UNABLE_BUILD_RULE__: '无法生成规则',
  __YJ_PICKER_I18N_ELEMENT__: '元素',
};

let body = src;
for (const [token, val] of Object.entries(i18n)) {
  body = body.split(token).join(JSON.stringify(val));
}
const leftover = body.match(/__YJ_PICKER_I18N_[A-Z_]+__/g);
if (leftover) {
  console.error('LEFTOVER TOKENS:', leftover);
  process.exit(1);
}

// 转义以便嵌入反引号模板字符串：先反斜杠，再反引号，再 ${
const escaped = body
  .replace(/\\/g, '\\\\')
  .replace(/`/g, '\\`')
  .replace(/\$\{/g, '\\${');

const D = '$'; // 用于在输出里写出 ${...}

const out = `// 此文件由 scripts/gen-adblock-picker.js 从 dom_picker.js 自动生成，请勿手改主体逻辑。
// 来源: browserv4/moduleMain/src/main/assets/adblock/dom_picker.js
// 改动: 1) i18n 占位符替换为中文常量; 2) 顶部注入 JSInterface -> Electron ipcRenderer 桥。
//
// 注入到标签页 webContents(contextIsolation:false, preload 暴露 window.electron.ipcRenderer)。
// picker 主体通过 window.JSInterface 回传, 由下方 shim 转成 ipc 消息发给所属窗口。
/* eslint-disable */

const PICKER_BODY = \`${escaped}\`;

/**
 * 生成可注入网页的元素拾取器代码。
 * @param windowId 所属浏览器窗口 id, 回传 ipc 时拼到频道名
 */
export const getAdblockPickerCode = (windowId: number): string => {
  const WINDOW_ID = JSON.stringify(windowId);
  const shim = \`
    (function () {
      try {
        var ipc = window.electron && window.electron.ipcRenderer;
        window.JSInterface = window.JSInterface || {};
        window.JSInterface.onAdblockPickerEnter = function () {
          try { ipc && ipc.send("adblock-picker-state-" + ${D}{WINDOW_ID}, "enter"); } catch (e) {}
        };
        window.JSInterface.onAdblockPickerCancel = function () {
          try { ipc && ipc.send("adblock-picker-state-" + ${D}{WINDOW_ID}, "cancel"); } catch (e) {}
        };
        window.JSInterface.onAdblockPickerSubmit = function (ruleText) {
          try { ipc && ipc.send("adblock-picker-state-" + ${D}{WINDOW_ID}, "submit", ruleText || ""); } catch (e) {}
        };
        window.JSInterface.saveGeneratedAdblockRule = function (ruleText) {
          try { ipc && ipc.send("save-adblock-rule-" + ${D}{WINDOW_ID}, ruleText || ""); } catch (e) {}
        };
      } catch (e) {}
    })();
  \`;
  const starter = \`
    (function () {
      try {
        if (window.__YJAdblockPicker && typeof window.__YJAdblockPicker.start === "function") {
          window.__YJAdblockPicker.start({ currentHost: window.location.host });
        }
      } catch (e) {}
    })();
  \`;
  return shim + PICKER_BODY + starter;
};
`;

fs.writeFileSync(OUT, out, 'utf8');
console.log('written', OUT, 'bodyLen=', body.length, 'escapedLen=', escaped.length);
