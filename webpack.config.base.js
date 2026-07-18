/* eslint-disable */
const { resolve, join } = require('path');
const { writeFileSync, readFileSync, existsSync } = require('fs');
const { merge } = require('webpack-merge');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const createStyledComponentsTransformer = require('typescript-plugin-styled-components')
  .default;
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const TsconfigPathsPlugin = require('tsconfig-paths-webpack-plugin');
/* eslint-enable */

const INCLUDE = resolve(__dirname, 'src');
const packageInfo = require('./package.json');

const BUILD_FLAGS = {
  ENABLE_EXTENSIONS: true,
  ENABLE_TEST_EXTENSIONS:true,
  ENABLE_AUTOFILL: true,
  VERSION_CODE: packageInfo.version
};

process.env = {
  ...process.env,
  ...BUILD_FLAGS,
};

const dev = process.env.DEV === '1';

process.env.NODE_ENV = dev ? 'development' : 'production';

const styledComponentsTransformer = createStyledComponentsTransformer({
  minify: !dev,
  displayName: dev,
});

const config = {
  mode: dev ? 'development' : 'production',

  devtool: dev ? 'eval-source-map' : false,

  output: {
    path: resolve(__dirname, 'build'),
    filename: '[name].bundle.js',
  },

  module: {
    rules: [
      {
        test: /\.(png|gif|jpg|woff2|ttf|svg)$/,
        include: INCLUDE,
        use: [
          {
            loader: 'file-loader',
            options: {
              esModule: false,
              outputPath: 'res',
            },
          },
        ],
      },
      {
        test: /\.tsx|ts$/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              experimentalWatchApi: dev,
              transpileOnly: true, // |dev| to throw CI when a ts error occurs
              getCustomTransformers: () => ({
                before: [styledComponentsTransformer],
              }),
            },
          },
        ],

        include: INCLUDE,
      },
    ],
  },

  node: {
    __dirname: false,
    __filename: false,
  },

  resolve: {
    modules: ['node_modules'],
    extensions: ['.js', '.jsx', '.tsx', '.ts', '.json'],
    alias: {
      '~': INCLUDE,
      // Force the ESM build of phosphor-icons; its package.json "exports"
      // resolves bare imports to a CJS file that breaks under webpack's
      // ESM context ("exports is not defined"). The `$` matches the bare
      // specifier only, leaving deep imports untouched.
      '@phosphor-icons/react$': resolve(
        __dirname,
        'node_modules/@phosphor-icons/react/dist/index.es.js',
      ),
    },
    plugins: [new TsconfigPathsPlugin()],
  },

  plugins: [
    new webpack.EnvironmentPlugin(['NODE_ENV', ...Object.keys(BUILD_FLAGS)]),
  ],

  externals: {
    keytar: `require('keytar')`,
    electron: 'require("electron")',
    fs: 'require("fs")',
    os: 'require("os")',
    path: 'require("path")',
  },

  optimization: {
    minimizer: !dev
      ? [
          new TerserPlugin({
            // koodoreader 的 pdf.mjs 等资源由 CopyPlugin 直接拷贝,
            // 含 ES2022 static class blocks 等新语法,旧版 Terser 解析不了。
            // 这些是纯静态资源不该被压缩,排除掉避免构建失败。
            exclude: /web\.koodoreader\.com/,
            extractComments: true,
            terserOptions: {
              ecma: 2022,
              output: {
                comments: false,
              },
            },
            parallel: true,
          }),
        ]
      : [],
  },
};

if (dev) {
  config.module.rules[1].use.splice(0, 0, {
    loader: 'babel-loader',
    options: { plugins: ['react-refresh/babel'] },
  });
}

function getConfig(...cfg) {
  return merge(config, ...cfg);
}

const getHtml = (name) => {
  // newtab 单独模板:head 预连接 pcapp.rainsee.cn,缩短内嵌 iframe 的握手白屏。
  // 其余 webui 页(settings/history/bookmarks 等)继续共用 app.html,不受污染。
  const templateMap = {
    app: 'static/pages/main-app.html',
    newtab: 'static/pages/newtab.html',
  };
  return new HtmlWebpackPlugin({
    title: 'Wexond',
    template: templateMap[name] || 'static/pages/app.html',
    filename: `${name}.html`,
    chunks: [name],
  });
};

const applyEntries = (config, entries) => {
  for (const entry of entries) {
    config.entry[entry] = [
      `./src/renderer/pre-entry`,
      `./src/renderer/views/${entry}`,
    ];
    config.plugins.push(getHtml(entry));
  }
};

const getBaseConfig = (name) => {
  const config = {
    plugins: [],

    output: {},

    entry: {},

    optimization: {
      runtimeChunk: {
        name: `runtime.${name}`,
      },
      splitChunks: {
        chunks: 'all',
        maxInitialRequests: Infinity,
      },
    },
  };

  return config;
};

module.exports = { getConfig, dev, getHtml, applyEntries, getBaseConfig };
