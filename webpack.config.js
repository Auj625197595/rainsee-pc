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

  output: {
    // Main-process lazy chunks share build/ with renderer chunks. Keep them in
    // a dedicated namespace so concurrent compilers cannot overwrite them.
    chunkFilename: 'main-chunks/[name].[contenthash:8].js',
  },

  optimization: {
    // package.json marks source files side-effect-free for renderer shaking.
    // The main process has intentional registration imports, so keep every
    // imported module while still allowing import() to form lazy chunks.
    sideEffects: false,
    usedExports: false,
  },

  watch: dev,

  entry: {
    main: './src/main',
    'database-worker': './src/main/services/database-worker',
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
            'node_modules/@cliqz/adblocker-electron-preload/dist/index.cjs',
          to: 'preload.js',
          transform: async (fileContent, path) => {
            return (
              await terser.minify(fileContent.toString())
            ).code.toString();
          },
        },
        {
          // Tiny native entry: secondary file/URL launches acquire the lock
          // and exit without parsing the full main.bundle.js.
          from: resolve(__dirname, 'src/main/main-launcher.js'),
          to: resolve(__dirname, 'build', 'main-launcher.js'),
        },
        {
          // Shared stable lock resolver used by the unbundled launcher.
          from: resolve(__dirname, 'src/main/instance-lock.js'),
          to: resolve(__dirname, 'build', 'instance-lock.js'),
        },
        {
          // koodoreader 阅读器静态资源:protocol.ts 在 yjllq://web.koodoreader.com/
          // 下按 __dirname/web.koodoreader.com/* 取文件。打包时 electron-builder
          // 也会通过 extraFiles 拷一份,这里保证本地 `npm start` 同样可用。
          // glob 显式匹配目录下全部文件,避免 to 被当成单一文件名而互相覆盖。
          from: resolve(__dirname, 'web.koodoreader.com').replace(/\\/g, '/') + '/**/*',
          to: resolve(__dirname, 'build', 'web.koodoreader.com', '[path][name][ext]'),
          context: resolve(__dirname, 'web.koodoreader.com'),
        },
        {
          // flags-service 与 main.bundle.js 从同一 build 目录读取数据。
          // electron-builder 只收集 build/**/*，因此安装包也会包含该文件。
          from: resolve(__dirname, 'flasg.md'),
          to: resolve(__dirname, 'build', 'flasg.md'),
        },
      ],
    })
  ],
});

// The shared tsconfig lowers import() to Promise.resolve().then(require),
// which keeps deferred services in main.bundle.js. Preserve ESM only for the
// main compiler so webpack can split those services without changing renderer
// tree-shaking or its side-effect behavior.
mainConfig.module = {
  ...mainConfig.module,
  rules: mainConfig.module.rules.map((rule) => ({
    ...rule,
    use: (rule.use || []).map((use) =>
      use && use.loader === 'ts-loader'
        ? {
            ...use,
            options: {
              ...use.options,
              compilerOptions: {
                ...(use.options.compilerOptions || {}),
                module: 'esnext',
              },
            },
          }
        : use,
    ),
  })),
};

const preloadConfig = getConfig({
  target: 'web',

  devtool: false,

  watch: dev,

  entry: {
    'view-preload': './src/preloads/view-preload',
    // 独立 PWA 窗口的轻量应用栏（右上角更多菜单）。
    'app-mode-preload': './src/preloads/app-mode-preload',
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
