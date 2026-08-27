// 本地签名 + 公证打包脚本
// 用法：npm run compile-darwin-signed
// 凭据从 scripts/.mac-sign.env 读取（该文件已 gitignore，不会提交）
const { readFileSync, existsSync } = require('fs');
const { resolve } = require('path');
const { run } = require('./utils');

const ENV_FILE = resolve(__dirname, '.mac-sign.env');

const REQUIRED = [
  'CSC_LINK', // .p12 证书路径
  'CSC_KEY_PASSWORD', // .p12 密码
  'APPLE_ID', // 公证账号
  'APPLE_APP_SPECIFIC_PASSWORD', // 应用专用密码
  'APPLE_TEAM_ID', // 团队 ID
];

// 解析简单的 KEY=VALUE 环境文件（支持引号包裹的值）
function loadEnv(file) {
  if (!existsSync(file)) {
    console.error(`\n✗ 找不到签名配置文件: ${file}`);
    console.error(`  请复制 scripts/mac-sign.env.example 为 .mac-sign.env 并填入凭据。`);
    process.exit(1);
  }
  const content = readFileSync(file, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[m[1]] = value;
  }
}

(async () => {
  try {
    // Node 22.12+ 才默认支持 require(ESM)；app-builder-lib 的 blockmap 用 require()
    // 引 @noble/hashes（ESM），低版本会抛 ERR_REQUIRE_ESM 使打包失败。
    const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
    if (nodeMajor < 22) {
      console.error(`\n✗ 需要 Node 22.12+，当前为 ${process.version}。`);
      console.error('  app-builder-lib 的 blockmap 用 require() 引 @noble/hashes（ESM），低版本 Node 会抛 ERR_REQUIRE_ESM。');
      process.exit(1);
    }

    loadEnv(ENV_FILE);

    const missing = REQUIRED.filter((k) => !process.env[k]);
    if (missing.length) {
      console.error(`\n✗ .mac-sign.env 缺少字段: ${missing.join(', ')}`);
      process.exit(1);
    }

    console.log('\n== 1/2 构建产物 (npm run build) ==');
    run('npm run build');

    console.log('\n== 2/2 签名 + 公证 (electron-builder -m) ==');
    console.log('    证书: ', process.env.CSC_LINK);
    console.log('    Apple ID: ', process.env.APPLE_ID);
    console.log('    Team ID: ', process.env.APPLE_TEAM_ID);
    console.log('    （公证可能需要 5-15 分钟，请耐心等待）\n');
    run('npx electron-builder -m');

    console.log('\n✓ 完成。产物在 dist/ 下。');
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
