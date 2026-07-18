/* eslint-disable */
const { getConfig, dev } = require('./webpack.config.base');
const { spawn, execSync } = require('child_process');
const CopyPlugin = require('copy-webpack-plugin');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const { NormalModuleReplacementPlugin } = require('webpack');
const { resolve } = require('path');

let terser = require('terser');
/* eslint-enable */

let electronProcess;

const mainConfig = getConfig({
  target: 'electron-main',

  devtool: dev ? 'inline-source-map' : false,

  watch: dev,

  entry: {
    main: './src/main',
  },

  plugins: [
    // @cliqz/adblocker-electron 内部的 preload_path 模块在 webpack 5 下会把
    // require.resolve('@cliqz/adblocker-electron-preload') 编成裸数字模块 id，
    // 生成 path.resolve(<number>) 在 import 期抛 ERR_INVALID_ARG_TYPE。
    // 改用本地 shim：PRELOAD_PATH 指向 CopyPlugin 拷贝的 build/preload.js。
    new NormalModuleReplacementPlugin(
      /[/\\]@cliqz[/\\]adblocker-electron[/\\]dist[/\\][^/\\]*[/\\]preload_path\.js$/,
      resolve(__dirname, 'src/main/adblocker-preload-path.js'),
    ),
    new CopyPlugin({
      patterns: [
        {
          from:
            'node_modules/@cliqz/adblocker-electron-preload/dist/preload.cjs.js',
          to: 'preload.js',
          transform: async (fileContent, path) => {
            return (
              await terser.minify(fileContent.toString())
            ).code.toString();
          },
        },
        // 注:koodoreader 阅读器静态资源(web.koodoreader.com/)在开源版不随仓库分发。
        // 如需 PDF/epub 阅读功能,请从 Koodo Reader 官方获取构建产物放入
        // web.koodoreader.com/ 目录,并恢复下方 CopyPlugin pattern(详见 README)。
      ],
    })
  ],
});

const preloadConfig = getConfig({
  target: 'web',

  devtool: false,

  watch: dev,

  entry: {
    'view-preload': './src/preloads/view-preload',
  },

  plugins: [],
});

if (process.env.ENABLE_EXTENSIONS) {
  preloadConfig.entry['popup-preload'] = './src/preloads/popup-preload';
  // Chrome-extension API preload from the vendored electron-chrome-extensions.
  // Loaded at runtime via modulePath in sessions-service.ts.
  preloadConfig.entry['crx-preload'] =
    './src/vendor/electron-chrome-extensions/preload';
  // preloadConfig.entry['extensions-preload'] =
  //   './src/preloads/extensions-preload';
}

if (process.env.START === '1') {
  mainConfig.plugins.push({
    apply: (compiler) => {
      compiler.hooks.afterEmit.tap('AfterEmitPlugin', () => {
        if (electronProcess) {
          try {
            if (process.platform === 'win32') {
              execSync(`taskkill /pid ${electronProcess.pid} /f /t`);
            } else {
              electronProcess.kill();
            }

            electronProcess = null;
          } catch (e) {}
        }

        // Electron rejects --openssl-legacy-provider in NODE_OPTIONS, so
        // strip it from the env we pass to the spawned Electron process.
        const electronEnv = { ...process.env };
        if (electronEnv.NODE_OPTIONS) {
          electronEnv.NODE_OPTIONS = electronEnv.NODE_OPTIONS.replace(
            /--openssl-legacy-provider/g,
            '',
          ).trim();
          if (!electronEnv.NODE_OPTIONS) delete electronEnv.NODE_OPTIONS;
        }
        // VSCode's extension host sets ELECTRON_RUN_AS_NODE=1, which makes
        // Electron run as a plain Node process so `require('electron')`
        // returns a path string instead of the GUI API. Remove it.
        delete electronEnv.ELECTRON_RUN_AS_NODE;

        electronProcess = spawn('npm', ['start'], {
          shell: true,
          env: electronEnv,
          stdio: 'inherit',
        });
      });
    },
  });
}

module.exports = [mainConfig, preloadConfig];
