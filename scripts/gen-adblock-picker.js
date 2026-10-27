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

const out = `// 此文件由 scripts/gen-adblock-picker.js 从 dom_picker.js 自动生成，请勿手改主体逻辑。
// 来源: browserv4/moduleMain/src/main/assets/adblock/dom_picker.js
// 改动: 1) i18n 占位符替换为中文常量; 2) JSInterface 由标签 preload
// 在用户启动拾取器时临时安装,不向网页暴露通用 Electron IPC。
//
// picker 主体通过 window.JSInterface 回传,取消或提交后 preload 会撤销该接口。
/* eslint-disable */

const PICKER_BODY = \`${escaped}\`;

/**
 * 生成可注入网页的元素拾取器代码。
 * @param windowId 保留现有调用签名;IPC 目标由 preload 的窗口快照决定
 */
export const getAdblockPickerCode = (_windowId: number): string => {
  const starter = \`
    (function () {
      try {
        if (window.__YJAdblockPicker && typeof window.__YJAdblockPicker.start === "function") {
          window.__YJAdblockPicker.start({ currentHost: window.location.host });
        }
      } catch (e) {}
    })();
  \`;
  return PICKER_BODY + starter;
};
`;

fs.writeFileSync(OUT, out, 'utf8');
console.log('written', OUT, 'bodyLen=', body.length, 'escapedLen=', escaped.length);
