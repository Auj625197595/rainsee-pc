// Webpack shim for @cliqz/adblocker-electron 的 preload_path 模块。
//
// 库原本这样算 PRELOAD_PATH：
//   exports.PRELOAD_PATH = path.resolve(require.resolve('@cliqz/adblocker-electron-preload'));
// 在 webpack 5 下，被 bundle 进来的 @cliqz/adblocker-electron-preload 会让
// require.resolve(...) 被替换成「裸数字模块 id」，于是变成 path.resolve(95648)，
// import 时即抛 ERR_INVALID_ARG_TYPE: paths[0] must be string, received number。
// 由于 adblock.ts 在启动期就 import { ElectronBlocker }，主进程一启动就崩。
//
// webpack.config.js 的 CopyPlugin 已经把预加载脚本拷到 build/preload.js，
// 且 electron-main bundle 保留了真实 __dirname（base 配置 node.__dirname=false），
// 所以这里直接拼 __dirname/preload.js：开发态指向 build/preload.js，
// 打包态指向 app.asar/build/preload.js，正是 setPreloads 需要的真实文件路径。
"use strict";

const { join } = require('path');

exports.PRELOAD_PATH = join(__dirname, 'preload.js');
