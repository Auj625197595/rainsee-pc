# 雨见浏览器(Rainsee PC)— 开源版

> 桌面端浏览器,轻盈、清爽。本仓库为其**开源版本**。

## ✨ 功能特性

- **标签页**:拖拽排序、撕离成新窗口、跨窗口合并、标签分组、横向滚动
- **地址栏**:Chromium 风格智能搜索与自动补全、外部协议唤起系统应用、PWA 安装提示
- **鼠标手势**:Edge 风格右键手势(方向可自定义映射)
- **扩展支持**:部分 Chrome 扩展(MV2/MV3),基于 vendored `electron-chrome-extensions`
- **广告屏蔽**:基于 [Cliqz adblocker](https://github.com/cliqz-oss/adblocker),含规则订阅 + DNR 双路径
- **网页翻译**:微软翻译引擎(本地 token 缓存,支持划词 / 整页 / 还原)
- **智能视频播放器**:视频地址嗅探 + 内置播放器(DPlayer / hls.js)
- **夜间模式**:基于 Dark Reader,随主题联动
- **书签 / 历史 / 下载 / 密码**管理(本地)
- **PDF / epub 阅读**:集成 [Koodo Reader](https://www.koodoreader.com/)(需自行放入,见下文)
- 暗色 / 明色主题、沉浸模式、看图模式、屏幕截图、网页分享……

## ⚠️ 开源版功能边界

为保证账号安全与服务端代码不外泄,以下**依赖闭源云服务**的功能已从开源版剥离,在本仓库中不可用:

| 功能 | 状态 | 说明 |
|---|:---:|---|
| 账号登录 | ❌ 已移除 | 登录弹窗、扫码登录、userkey |
| 云同步 | ❌ 已移除 | 书签 / 历史 / 密码 / 标签的跨设备同步 |
| 互联(手机扫码) | ❌ 已移除 | 手机在线状态、手机标签页悬停面板 |
| AI 面板 / 知识库 | ❌ 已移除 | 侧边 AI 助手、右键问 AI |
| 网站订阅 | ❌ 已移除 | RSS 订阅面板 |
| 自动更新检查 | ⚠️ 需后端 | 默认指向占位地址 |
| 广告规则 / 搜索引擎云端拉取 | ⚠️ 需后端 | 同上 |
| 新标签页个性化(pcapp) | ⚠️ 需后端 | 开源版默认新标签页非该域 |

服务端代码(账号体系、云同步、AI、订阅等后端接口)**不开源**。客户端针对这些功能的调用入口已**剥离**,联网拉取类接口(自动更新、规则同步等)的服务端地址已替换为**占位符**,浏览器主体功能不受影响。

如需恢复联网服务,请参照 [SERVER.md](SERVER.md) 自建后端,并在 [`src/constants/hosts.ts`](src/constants/hosts.ts) 填入你的服务地址。


## 🚀 快速开始

### 环境要求

- [Node.js](https://nodejs.org/)(推荐 LTS 版本)
- [yarn](https://classic.yarnpkg.com/) 或 npm

### 安装与运行

```bash
# 安装依赖
yarn install
# 若 yarn 因 lockfile 解析报错(个别文件系统偶发),可改用:
# npm install

# 开发模式(热重载)
yarn dev

# 生产构建(唯一可信的编译门:tsc / eslint 不作为门禁)
yarn build

# 运行
yarn start

# 打包当前平台安装包
yarn compile-win32   # Windows
yarn compile-darwin  # macOS
yarn compile-linux   # Linux
```

> 本仓库不附带 `node_modules`,首次使用需自行 `install`。

## 📖 PDF / epub 阅读器

PDF 与 epub 阅读功能依赖 [Koodo Reader](https://www.koodoreader.com/)(Apache-2.0)的 Web 构建产物。出于仓库体积考虑,本仓库**不含** `web.koodoreader.com/` 目录。

如需阅读功能:
1. 从 Koodo Reader 官方获取其 Web 版构建产物。
2. 解压到仓库根目录的 `web.koodoreader.com/`。
3. 在 `webpack.config.js` 中按注释提示恢复对应 `CopyPlugin` pattern。

## 📂 项目结构

```
src/
├── main/                主进程
│   ├── application.ts   应用入口
│   ├── view-manager.ts  标签视图管理(创建/销毁/布局/手势)
│   ├── sessions-service.ts  扩展加载与会话
│   ├── services/        adblock / 翻译 / 更新 / 存储 / 图标 等
│   ├── menus/           右键菜单与快捷键/手势分发
│   ├── windows/         窗口管理
│   └── network/         网络请求层
├── renderer/            渲染进程(UI)
│   └── views/           各 webui 页(设置 / 书签 / 历史 / 新标签页……)
├── preloads/            预加载脚本(view-preload 等)
├── vendor/              vendored 代码(electron-chrome-extensions 等)
├── common/              主进程与渲染进程共享
└── constants/           常量(含 hosts.ts 服务端地址配置)
```

## 🔒 安全说明

- 客户端代码中**不含**任何账号密钥、签名密钥或加密密钥——这些仅存在于不开源的服务端。
- 客户端只保存用户登录后下发的 token / cookie(存储在本机用户数据目录)。
- 开源前已剥离所有指向闭源后端的账号 / 云同步逻辑,剥离边界清晰(见上表)。

## 📜 许可证

本项目基于 [**GPL-3.0**](LICENSE) 许可证开源。任何分发或衍生作品须以兼容许可证开源。

本项目 Fork 自 [wexond](https://github.com/wexond/wexond)(同样为 GPL-3.0),感谢 wexond 团队提供的浏览器框架基础。wexond 原始代码遵循其原始许可证。

### 第三方组件

- [Koodo Reader](https://www.koodoreader.com/) — Apache-2.0(运行时依赖,需自行获取)
- [Cliqz adblocker](https://github.com/cliqz-oss/adblocker) — MPL-2.0
- [electron-chrome-extensions](https://github.com/onbjerg/electron-chrome-extensions) — MIT
- 其余依赖见各自 `package.json` / 许可证

## 🤝 贡献

欢迎提 Issue 与 Pull Request。提交 PR 即表示你同意所提交代码以 GPL-3.0 许可证并入本项目。
