<p align="center">
  <a href="#"><img src="static/icons/icon.png" width="180"></a>
</p>

<div align="center">
  <h1>雨见浏览器（开源版）</h1>

一个基于 Electron 与 React 的现代化桌面浏览器。**纯本地优先**：无账号、无云同步、无遥测、不上传任何数据。

`English below / 简体中文`

</div>

## 特性

| 功能 | 说明 |
|---|---|
| 🚄 **多引擎搜索** | 内置百度、搜狗、360、秘塔、夸克等搜索引擎，新标签页一键切换 |
| 🛡️ **广告过滤** | 基于 [EasyList China](https://easylist-downloads.adblockplus.org/easylistchina+easylist.txt) 官方规则，支持自定义订阅 |
| ▶️ **智能播放器** | 视频独立弹出播放，支持 m3u8 下载（内置 bilibili / YouTube 等站点白名单） |
| 🔖 **书签 · 历史 · 下载** | 数据全部保存在本机，可从 Chrome / Firefox 导入 |
| 📖 **EPUB / PDF 阅读** | 内置 [Koodo Reader](https://www.koodoreader.com/) 本地静态站（AGPL） |
| 🌐 **网页翻译** | 免费微软翻译接口；划词翻译；也可配置自定义 OpenAI 兼容引擎 |
| 🌙 **夜间模式** | Dark Reader 引擎注入，网站级明暗跟随系统 |
| 🧩 **Chrome 扩展** | 完整扩展体系，内置精选 Edge 商店快捷安装 |
| 🖱️ **鼠标手势** | 上下左右手势、侧键前进后退、长按链接拖拽 |
| 📸 **截图** | 区域截图标注、长截图、以图搜图 |
| ⚡ **效率工具** | 标签分组/去重、双列副引擎搜索、侧边栏面板、工作区 |

## 与商业版的差异

开源版移除了以下需要服务端支持的能力：

- ❌ 账号登录 / 手机互联 / 云同步（书签 · 密码 · 历史 · 标签）
- ❌ 「雨见 AI」侧栏、AI 搜索结果标注、AI 标签分组
- ❌ 云端搜索引擎列表同步、云端 UA 配置
- ❌ PDF 在线编辑 / 压缩 / 转换、图床上传与短链分享二维码

替代实现：新标签页为纯本地页（搜索框 + 引擎切换 + 书签磁贴）；favicon 使用 DuckDuckGo 公共图标服务；翻译使用微软免费接口；更新走 GitHub Releases。

## 开发

```bash
# 安装依赖
npm install

# 开发模式（主进程 + 渲染层并行监听）
npm run dev

# 构建
npm run build

# 打包 Windows x64 安装包
npm run compile-win32
```

## 目录速览

```
src/main        主进程（窗口/标签/会话/服务）
src/renderer    渲染层（app 壳层 + 各 WebUI 页面）
src/preloads    预加载脚本
static          图标 / 用户脚本 / NSIS 钩子
web.koodoreader.com  内置阅读器静态资源（AGPL）
```

## License

[MIT](./LICENSE) © Auj625197595

本项目 UI 源自 [Wexond](https://github.com/wexond/desktop)，感谢其作者的出色工作。
内置阅读器 [Koodo Reader](https://github.com/koodo-reader/koodo-reader) 采用 AGPL-3.0 协议单独授权。
