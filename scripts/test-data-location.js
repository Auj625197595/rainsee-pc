const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ts = require('typescript');

const sourceFile = path.resolve(__dirname, '../src/main/bootstrap-paths.ts');
const source = fs.readFileSync(sourceFile, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2019,
  },
  fileName: sourceFile,
}).outputText;

const profileUtilsFile = path.resolve(__dirname, '../src/common/profiles.ts');
const profileUtilsSource = fs.readFileSync(profileUtilsFile, 'utf8');
const profileUtilsCompiled = ts.transpileModule(profileUtilsSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2019,
  },
  fileName: profileUtilsFile,
}).outputText;
const profileUtilsModule = { exports: {} };
new Function('module', 'exports', profileUtilsCompiled)(
  profileUtilsModule,
  profileUtilsModule.exports,
);

const runBootstrap = ({
  appData,
  defaultUserData,
  cwd,
  fsModule = fs,
  argv = [],
}) => {
  let userData = defaultUserData;
  let sessionData = defaultUserData;
  const app = {
    name: 'rainsee-pc',
    getPath(name) {
      if (name === 'appData') return appData;
      if (name === 'userData') return userData;
      if (name === 'sessionData') return sessionData;
      if (name === 'temp') return path.join(appData, 'Temp');
      throw new Error(`unexpected app path: ${name}`);
    },
    setPath(name, value) {
      assert.ok(name === 'userData' || name === 'sessionData');
      if (name === 'userData') userData = value;
      else sessionData = value;
    },
  };
  const fakeProcess = {
    ...process,
    env: { ...process.env, NODE_ENV: 'production' },
    cwd: () => cwd,
    pid: process.pid,
    argv,
  };
  const mod = { exports: {} };
  const localRequire = (id) => {
    if (id === 'electron') return { app };
    if (id === 'fs') return fsModule;
    if (id === '~/common/profiles') return profileUtilsModule.exports;
    return require(id);
  };
  const evaluate = new Function(
    'require',
    'module',
    'exports',
    'process',
    '__dirname',
    compiled,
  );
  evaluate(
    localRequire,
    mod,
    mod.exports,
    fakeProcess,
    path.dirname(sourceFile),
  );
  return {
    app,
    exports: mod.exports,
    userData: () => userData,
    sessionData: () => sessionData,
  };
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rainsee-data-location-'));
try {
  const appData = path.join(root, 'AppData');
  const systemUserData = path.join(appData, '雨见浏览器');
  const target = path.join(root, 'CustomData');
  const installDir = path.join(root, 'Program Files', '雨见浏览器');
  fs.mkdirSync(path.join(systemUserData, 'storage'), { recursive: true });
  fs.mkdirSync(installDir, { recursive: true });
  fs.writeFileSync(
    path.join(systemUserData, 'settings.json'),
    '{"theme":"dark"}',
    'utf8',
  );
  fs.writeFileSync(
    path.join(systemUserData, 'storage', 'bookmarks.db'),
    'bookmark-data',
    'utf8',
  );
  fs.writeFileSync(
    path.join(systemUserData, 'data-location.json'),
    JSON.stringify({
      current: systemUserData,
      pending: { from: systemUserData, to: target },
    }),
    'utf8',
  );

  const firstStart = runBootstrap({
    appData,
    defaultUserData: systemUserData,
    cwd: installDir,
  });
  assert.strictEqual(firstStart.exports.DEFAULT_USER_DATA, systemUserData);
  assert.strictEqual(firstStart.userData(), target);
  assert.strictEqual(firstStart.sessionData(), target);
  assert.strictEqual(firstStart.exports.pendingMigration, null);
  assert.strictEqual(firstStart.exports.startupMigrationFailure, null);
  assert.strictEqual(
    fs.readFileSync(path.join(target, 'settings.json'), 'utf8'),
    '{"theme":"dark"}',
  );
  assert.strictEqual(
    fs.readFileSync(path.join(target, 'storage', 'bookmarks.db'), 'utf8'),
    'bookmark-data',
  );
  assert.ok(!fs.existsSync(path.join(target, 'data-location.json')));
  assert.deepStrictEqual(
    JSON.parse(
      fs.readFileSync(path.join(systemUserData, 'data-location.json'), 'utf8'),
    ),
    { current: target, pending: null },
  );

  // 再次启动仍从固定 AppData 指针找到自定义目录,不回落到默认目录。
  const secondStart = runBootstrap({
    appData,
    defaultUserData: systemUserData,
    cwd: installDir,
  });
  assert.strictEqual(secondStart.userData(), target);
  assert.strictEqual(secondStart.sessionData(), target);

  // 多进程同时探测时，另一个进程可能先清理探针。只要写入成功，当前进程
  // 的清理失败就不能把正常可写的自定义目录误判为不可用。
  const probeCleanupFailingFs = {
    ...fs,
    unlinkSync(file, ...args) {
      if (path.basename(String(file)).startsWith('.write-probe-')) {
        const error = new Error('probe already removed by another process');
        error.code = 'ENOENT';
        throw error;
      }
      return fs.unlinkSync(file, ...args);
    },
  };
  const concurrentProbeStart = runBootstrap({
    appData,
    defaultUserData: systemUserData,
    cwd: installDir,
    fsModule: probeCleanupFailingFs,
  });
  assert.strictEqual(concurrentProbeStart.userData(), target);

  // 自定义盘瞬时不可写时必须保留固定 AppData 下的指针；下一次盘符恢复后
  // 应自动回到原目录，不能因为一次探测失败永久落到空的默认目录。
  const transientAppData = path.join(root, 'TransientAppData');
  const transientUserData = path.join(transientAppData, '雨见浏览器');
  const transientTarget = path.join(root, 'TransientTarget');
  fs.mkdirSync(transientUserData, { recursive: true });
  fs.mkdirSync(transientTarget, { recursive: true });
  fs.writeFileSync(
    path.join(transientUserData, 'data-location.json'),
    JSON.stringify({ current: transientTarget, pending: null }),
    'utf8',
  );
  const transientWriteFailingFs = {
    ...fs,
    writeFileSync(file, ...args) {
      if (
        path.dirname(String(file)) === transientTarget &&
        path.basename(String(file)).startsWith('.write-probe-')
      ) {
        const error = new Error('drive temporarily unavailable');
        error.code = 'EBUSY';
        throw error;
      }
      return fs.writeFileSync(file, ...args);
    },
  };
  const unavailableStart = runBootstrap({
    appData: transientAppData,
    defaultUserData: transientUserData,
    cwd: installDir,
    fsModule: transientWriteFailingFs,
  });
  assert.strictEqual(unavailableStart.userData(), transientUserData);
  assert.strictEqual(unavailableStart.sessionData(), transientUserData);
  assert.deepStrictEqual(
    JSON.parse(
      fs.readFileSync(
        path.join(transientUserData, 'data-location.json'),
        'utf8',
      ),
    ),
    { current: transientTarget, pending: null },
  );
  const recoveredStart = runBootstrap({
    appData: transientAppData,
    defaultUserData: transientUserData,
    cwd: installDir,
  });
  assert.strictEqual(recoveredStart.userData(), transientTarget);

  // 自定义目录与固定 AppData 的 settings.json 双向镜像：E 盘副本较新时修复
  // AppData 副本；反向较新时也应恢复自定义目录副本。
  const customSettings = path.join(target, 'settings.json');
  const mirrorSettings = path.join(systemUserData, 'settings.json');
  fs.writeFileSync(customSettings, '{"persistSessionCookies":true}', 'utf8');
  fs.utimesSync(customSettings, new Date(Date.now() + 2000), new Date(Date.now() + 2000));
  runBootstrap({appData, defaultUserData: systemUserData, cwd: installDir});
  assert.strictEqual(
    fs.readFileSync(mirrorSettings, 'utf8'),
    '{"persistSessionCookies":true}',
  );

  fs.writeFileSync(mirrorSettings, '{"clearOnExit":{"cache":true}}', 'utf8');
  fs.utimesSync(mirrorSettings, new Date(Date.now() + 4000), new Date(Date.now() + 4000));
  runBootstrap({appData, defaultUserData: systemUserData, cwd: installDir});
  assert.strictEqual(
    fs.readFileSync(customSettings, 'utf8'),
    '{"clearOnExit":{"cache":true}}',
  );

  // NSIS 覆盖安装会删除并重建整个安装目录。指针和自定义数据都在安装目录外时,
  // 新版本首次启动仍必须定位到原自定义目录。
  fs.rmSync(installDir, { recursive: true, force: true });
  fs.mkdirSync(installDir, { recursive: true });
  fs.writeFileSync(path.join(installDir, 'new-version.exe'), 'updated', 'utf8');
  const upgradedStart = runBootstrap({
    appData,
    defaultUserData: systemUserData,
    cwd: installDir,
  });
  assert.strictEqual(upgradedStart.userData(), target);
  assert.strictEqual(
    fs.readFileSync(path.join(target, 'storage', 'bookmarks.db'), 'utf8'),
    'bookmark-data',
  );

  // 从自定义目录恢复默认时，也通过 pending 在启动早期完整迁移数据。
  fs.writeFileSync(path.join(target, 'reset-marker.txt'), 'reset-data', 'utf8');
  fs.writeFileSync(
    path.join(systemUserData, 'data-location.json'),
    JSON.stringify({
      current: target,
      pending: { from: target, to: systemUserData },
    }),
    'utf8',
  );
  const resetStart = runBootstrap({
    appData,
    defaultUserData: systemUserData,
    cwd: installDir,
  });
  assert.strictEqual(resetStart.userData(), systemUserData);
  assert.strictEqual(
    fs.readFileSync(path.join(systemUserData, 'reset-marker.txt'), 'utf8'),
    'reset-data',
  );
  assert.deepStrictEqual(
    JSON.parse(
      fs.readFileSync(path.join(systemUserData, 'data-location.json'), 'utf8'),
    ),
    { current: systemUserData, pending: null },
  );

  // 后续 profile 用例继续验证自定义主目录。
  fs.writeFileSync(
    path.join(systemUserData, 'data-location.json'),
    JSON.stringify({ current: target, pending: null }),
    'utf8',
  );

  // 任一文件复制失败时回滚指针与目标半成品,旧目录必须保持可用。
  const rollbackAppData = path.join(root, 'RollbackAppData');
  const rollbackUserData = path.join(rollbackAppData, '雨见浏览器');
  const rollbackTarget = path.join(root, 'RollbackTarget');
  fs.mkdirSync(path.join(rollbackUserData, 'storage'), { recursive: true });
  fs.writeFileSync(
    path.join(rollbackUserData, 'settings.json'),
    'keep-me',
    'utf8',
  );
  fs.writeFileSync(
    path.join(rollbackUserData, 'storage', 'history.db'),
    'history',
    'utf8',
  );
  fs.writeFileSync(
    path.join(rollbackUserData, 'data-location.json'),
    JSON.stringify({
      current: rollbackUserData,
      pending: { from: rollbackUserData, to: rollbackTarget },
    }),
    'utf8',
  );
  const failingCopyFs = {
    ...fs,
    copyFileSync(sourcePath, destinationPath) {
      if (String(sourcePath).endsWith('history.db'))
        throw new Error('copy failed');
      return fs.copyFileSync(sourcePath, destinationPath);
    },
  };
  const rollbackStart = runBootstrap({
    appData: rollbackAppData,
    defaultUserData: rollbackUserData,
    cwd: installDir,
    fsModule: failingCopyFs,
  });
  assert.strictEqual(rollbackStart.userData(), rollbackUserData);
  assert.strictEqual(rollbackStart.exports.pendingMigration, null);
  assert.strictEqual(
    rollbackStart.exports.startupMigrationFailure.error,
    'copy failed',
  );
  assert.ok(!fs.existsSync(rollbackTarget));
  assert.strictEqual(
    fs.readFileSync(path.join(rollbackUserData, 'settings.json'), 'utf8'),
    'keep-me',
  );
  assert.deepStrictEqual(
    JSON.parse(
      fs.readFileSync(
        path.join(rollbackUserData, 'data-location.json'),
        'utf8',
      ),
    ),
    { current: rollbackUserData, pending: null },
  );

  // 指针写失败必须抛出,调用方不能把目录修改误报为成功。
  const deniedAppData = path.join(root, 'DeniedAppData');
  const deniedUserData = path.join(deniedAppData, '雨见浏览器');
  const throwingFs = {
    ...fs,
    writeFileSync(file, ...args) {
      if (String(file).endsWith('.tmp')) {
        const error = new Error('access denied');
        error.code = 'EACCES';
        throw error;
      }
      return fs.writeFileSync(file, ...args);
    },
  };
  const deniedStart = runBootstrap({
    appData: deniedAppData,
    defaultUserData: deniedUserData,
    cwd: installDir,
    fsModule: throwingFs,
  });
  assert.throws(
    () => deniedStart.exports.writeDataLocationPointer({ current: target }),
    /access denied/,
  );

  // 小号在全局 current 下解析自己的 userData/sessionData,且不继承主账号目录。
  const profileName = '工作号';
  const profileDir = path.join(target, 'profiles', profileName);
  fs.mkdirSync(profileDir, { recursive: true });
  const profileStart = runBootstrap({
    appData,
    defaultUserData: systemUserData,
    cwd: installDir,
    argv: ['electron', `--rainsee-profile=${encodeURIComponent(profileName)}`],
  });
  assert.strictEqual(profileStart.exports.activeProfileName, profileName);
  assert.strictEqual(profileStart.exports.BASE_USER_DATA, target);
  assert.strictEqual(profileStart.userData(), profileDir);
  assert.strictEqual(profileStart.sessionData(), profileDir);

  // 有待迁移计划时小号不能启动,也不得消费或改写 pending。
  const pendingAppData = path.join(root, 'PendingProfileAppData');
  const pendingMain = path.join(root, 'PendingProfileMain');
  const pendingTarget = path.join(root, 'PendingProfileTarget');
  const pendingPointerDir = path.join(pendingAppData, '雨见浏览器');
  fs.mkdirSync(path.join(pendingMain, 'profiles', profileName), {
    recursive: true,
  });
  fs.mkdirSync(pendingPointerDir, { recursive: true });
  const pendingPointer = {
    current: pendingMain,
    pending: { from: pendingMain, to: pendingTarget },
  };
  fs.writeFileSync(
    path.join(pendingPointerDir, 'data-location.json'),
    JSON.stringify(pendingPointer),
    'utf8',
  );
  const rejectedProfileStart = runBootstrap({
    appData: pendingAppData,
    defaultUserData: pendingPointerDir,
    cwd: installDir,
    argv: ['electron', `--rainsee-profile=${encodeURIComponent(profileName)}`],
  });
  assert.match(rejectedProfileStart.exports.profileStartupError, /迁移/);
  assert.strictEqual(rejectedProfileStart.exports.activeProfileName, null);
  assert.deepStrictEqual(
    JSON.parse(
      fs.readFileSync(
        path.join(pendingPointerDir, 'data-location.json'),
        'utf8',
      ),
    ),
    pendingPointer,
  );

  console.log('data location regression tests passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
