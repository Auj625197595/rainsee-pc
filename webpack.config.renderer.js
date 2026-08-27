/* eslint-disable */
const {
  getConfig,
  applyEntries,
  getBaseConfig,
  dev,
} = require('./webpack.config.base');
const { join } = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const ReactRefreshWebpackPlugin = require('@pmmmwh/react-refresh-webpack-plugin');
const webpack = require('webpack');
/* eslint-enable */

const PORT = 4444;

const appConfig = getConfig(getBaseConfig('app'), {
  target: 'web',

  devServer: {
    contentBase: join(__dirname, 'build'),
    port: PORT,
    hot: true,
    inline: true,
    disableHostCheck: true,
  },

  plugins: dev
    ? [
        new webpack.HotModuleReplacementPlugin(),
        new ReactRefreshWebpackPlugin(),
      ]
    : [],
});

if (dev) {
  // Fast Refresh belongs to renderer React code only. Injecting this loader in
  // the shared config also instruments Electron main/preload modules, where
  // the refresh runtime globals do not exist.
  appConfig.module = {
    ...appConfig.module,
    rules: appConfig.module.rules.map((rule) => ({
      ...rule,
      use: (rule.use || []).some((use) => use && use.loader === 'ts-loader')
        ? [
            {
              loader: 'babel-loader',
              options: { plugins: ['react-refresh/babel'] },
            },
            ...rule.use,
          ]
        : rule.use,
    })),
  };
}

const extPopupConfig = getConfig({
  target: 'web',

  entry: {},
  output: {},
});

applyEntries(appConfig, [
  ...(process.env.ENABLE_AUTOFILL ? ['form-fill', 'credentials'] : []),
  'app',
  'permissions',
  'bluetooth',
  'auth',
  'find',
  'menu',
  'search',
  'share',
  'screenshot',
  'preview',
  'tabgroup',
  'tabgroup-preview',
  'sidebar-panel',
  'downloads-dialog',
  'download-prompt',
  'extensions-list',
  'add-bookmark',
  'show-block',
  'show-video',
  'update',
  'zoom',
  'search-engines',
  'site-info',
  'clear-browsing-data',
  'translate',
  'install-app',
  'bookmark-overflow',
  'history-bookmarks-popup',
  'settings',
  'history',
  'flags',
  'memory',
  'newtab',
  'image-viewer',
  'bookmarks',
  'downloads',
  'extensions',
  'onboarding',
]);

if (process.env.ENABLE_EXTENSIONS) {
  extPopupConfig.entry['extension-popup'] = [
    `./src/renderer/views/extension-popup`,
  ];
  extPopupConfig.plugins.push(
    new HtmlWebpackPlugin({
      title: 'Wexond',
      template: 'static/pages/extension-popup.html',
      filename: `extension-popup.html`,
      chunks: [`vendor.app`, 'extension-popup'],
    }),
  );

  module.exports = [appConfig, extPopupConfig];
} else {
  module.exports = appConfig;
}
