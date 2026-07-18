# CRX 框架回归测试夹具

两个最小化扩展（MV2 持久 background page + MV3 service worker），各含 **popup / content script / background**，覆盖「三者互相通讯」的全部消息路径 + 易回归的核心 API。popup 就是一键监测面板：点工具栏图标自动全跑，逐项绿✓/红✗ + 耗时。改了扩展框架代码后跑一遍，哪条变红即定位回归。

只用标准 `chrome.*` API，不针对本框架任何私有实现，因此也能作为「本框架 vs 真 Chrome」的兼容性对照。

## 开启（仅开发环境）

需要同时设两个环境变量（与既有的 `ENABLE_EXTENSIONS` 一起）：

```sh
# PowerShell
$env:ENABLE_EXTENSIONS=1
$env:ENABLE_TEST_EXTENSIONS=1
npm run dev   # 或你的开发启动命令

# 或在 .env 里加
ENABLE_EXTENSIONS=1
ENABLE_TEST_EXTENSIONS=1
```

不设 `ENABLE_TEST_EXTENSIONS` 时夹具完全不出现，不影响日常开发测试别的扩展。

启动后主日志可见：
```
[test-ext] staged mv2 -> kpgichkniiomphjhjjcejhmihgfangji
[test-ext] staged mv3 -> kfcppegeaaabodllognppjnigjlldeef
loadExtension: done kpgichkniiomphjhjjcejhmihgfangji (CRX Framework Test, mv=2)
loadExtension: done kfcppegeaaabodllognppjnigjlldeef (CRX Framework Test, mv=3)
```

工具栏出现两个图标（青色方块，「CRX Test (MV2)」「CRX Test (MV3)」）。

## 用法

1. 导航到一个普通 http(s) 网页（如 `https://www.baidu.com`）——内容脚本才会注入，content 相关测试才跑得通。
2. 点 MV2（或 MV3）工具栏图标 → popup 自动全跑（也可点单项 / 再点 Run all）。
3. 预期 15/15 全绿。两边并排开即可对比 MV2 vs MV3。
4. 回归用法：改 `messaging.ts`/`renderer/index.ts`/SHIM 后重 build 重启，跑两边 Run all，变红的项即对应路径回归。

页面 DevTools 控制台可见 `[crx-test] content injected <id>`；后台控制台/主日志可见 `[crx-test bg]` 与各项 `[crx-test] result <id> PASS|FAIL`。

## 测试矩阵

### Group A — 消息互通讯（三者，回归高发区）
| ID | 路径 |
|----|------|
| A1 | content → bg `runtime.sendMessage`（一次性） |
| A2 | content → bg `runtime.connect`（长连 Port） |
| A3 | bg → content `tabs.sendMessage` |
| A4 | bg → content `tabs.connect` |
| A5 | popup → bg `sendMessage`（同步 sendResponse） |
| A6 | popup → bg `sendMessage`（`return true` + 异步 sendResponse） |
| A7 | popup → bg `sendMessage`（Promise 返回） |
| A8 | popup → bg `connect`（Port 往返） |
| A9 | bg → popup 推送（bg `runtime.sendMessage` 广播，popup onMessage 命中） |

### Group B — 核心 API
| ID | API |
|----|-----|
| B1 | `storage.local` set/get + `onChanged` |
| B2 | `storage.sync` set→get（验证 sync 被重映射到 local） |
| B3 | `alarms.create` + `onAlarm`（bg 上下文，验证 SW 唤醒） |
| B4 | `i18n.getMessage`（占位符 + `@@extension_id`） |
| B5 | `runtime.getURL` |
| B6 | `tabs.query` 当前活跃 tab |

### 显式不测（框架已知不实现/桩，避免误报）
- `runtime.onConnectExternal` / `onMessageExternal`（跨扩展消息，未实现）
- `storage.sync` 真跨 profile 同步（已重映射到 local）
- `privacy.*`、`extension.getViews()`、`downloads.setShelfEnabled` 等 no-op 桩

## 结构

```
extensiontest/
  src/                 # 单一源（MV 无关）：background/content/popup/locales/icon
  mv2/manifest.json    # manifest_version:2 + browser_action + persistent bg + 固定 key
  mv3/manifest.json    # manifest_version:3 + action + service_worker + 固定 key
```

MV2 与 MV3 的 background/content/popup 逻辑完全相同（只有 manifest 不同）。开发安装钩子（`src/main/sessions-service.ts` 的 `syncDevTestExtensions`）在 `dev && ENABLE_TEST_EXTENSIONS` 时把 `src/*` + 对应 manifest 组合进 `data/extensions/<id>/`，随后走与普通扩展完全一致的加载路径（含 SHIM 注入）。所以**改逻辑只改 `src/`，两个扩展自动同步**。

扩展 ID 由 manifest 的固定 `key` 经 `getCrxIdByKey`（`src/utils/crx.ts`）派生，跨启动稳定：
- MV2: `kpgichkniiomphjhjjcejhmihgfangji`
- MV3: `kfcppegeaaabodllognppjnigjlldeef`

（如需换 ID：`node scripts/gen-test-extension-keys.js` 重新生成 key，贴回两个 manifest。会得到新 ID。）
