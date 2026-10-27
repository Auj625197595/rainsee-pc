const { spawnSync } = require('child_process');
const path = require('path');
const electronRuntime = require('electron');

// Some editor terminals export ELECTRON_RUN_AS_NODE=1. Relaunch the Electron
// binary with a clean environment so this script remains directly runnable.
if (typeof electronRuntime === 'string') {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawnSync(electronRuntime, [__filename], {
    cwd: path.resolve(__dirname, '..'),
    env,
    stdio: 'inherit',
  });
  if (child.error) throw child.error;
  process.exit(child.status == null ? 1 : child.status);
}

const { app, session } = electronRuntime;

async function main() {
  await app.whenReady();
  const target = session.fromPartition(`extension-proxy-test-${Date.now()}`, {
    cache: false,
  });
  const pacSource = [
    'function FindProxyForURL(url, host) {',
    "  if (host === 'proxy-target.example.test') return 'PROXY 127.0.0.1:7777';",
    "  return 'DIRECT';",
    '}',
  ].join('\n');
  const pacScript =
    'data:application/x-ns-proxy-autoconfig;base64,' +
    Buffer.from(pacSource, 'utf8').toString('base64');

  await target.setProxy({ mode: 'pac_script', pacScript });
  const proxied = await target.resolveProxy(
    'https://proxy-target.example.test/video',
  );
  const direct = await target.resolveProxy(
    'https://direct-target.example.test/',
  );
  if (!proxied.includes('PROXY 127.0.0.1:7777')) {
    throw new Error(`inline PAC was not applied: ${proxied}`);
  }
  if (direct !== 'DIRECT') {
    throw new Error(`inline PAC direct branch was not applied: ${direct}`);
  }
  console.log('extension proxy Electron integration test passed');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => app.quit());
