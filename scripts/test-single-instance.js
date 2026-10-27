const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const vm = require('vm');

const launcherPath = path.join(__dirname, '..', 'src', 'main', 'main-launcher.js');
const launcherSource = fs.readFileSync(launcherPath, 'utf8');
const {resolveInstanceLock} = require('../src/main/instance-lock');

const singleInstanceSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'main', 'single-instance.ts'),
  'utf8',
);
const singleInstanceOutput = ts.transpileModule(singleInstanceSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2019,
  },
}).outputText;
const singleInstanceModule = {exports: {}};
vm.runInNewContext(
  `(function(module, exports) {${singleInstanceOutput}\n})(module, module.exports);`,
  {module: singleInstanceModule},
);
const {findSecondInstanceWindow} = singleInstanceModule.exports;

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const runLauncher = ({
  acquired = true,
  appName = '雨见浏览器',
  argv = ['electron.exe', 'app'],
  isPackaged = true,
  pointer,
  existing = [],
} = {}) => {
  const paths = {
    userData: 'C:\\Users\\test\\AppData\\Roaming\\rainsee',
    sessionData: 'C:\\Users\\test\\AppData\\Roaming\\rainsee-session',
    appData: 'C:\\Users\\test\\AppData\\Roaming',
  };
  const listeners = new Map();
  const setPathCalls = [];
  let lockPath = null;
  let lockCount = 0;
  let quitCount = 0;
  let exitCount = 0;
  let bundleLoads = 0;

  const app = {
    name: appName,
    isPackaged,
    getPath: (name) => paths[name],
    setPath: (name, value) => {
      paths[name] = value;
      setPathCalls.push([name, value]);
    },
    requestSingleInstanceLock: () => {
      lockCount += 1;
      lockPath = paths.userData;
      return acquired;
    },
    quit: () => {
      quitCount += 1;
    },
    exit: (code) => {
      assert(code === 0, 'secondary launch must exit successfully');
      exitCount += 1;
    },
    on: (event, listener) => listeners.set(event, listener),
  };
  const cwd = 'C:\\rainsee';
  const systemName = appName === '雨见浏览器-nightly'
    ? '雨见浏览器 Nightly'
    : '雨见浏览器';
  const pointerPath = path.join(paths.appData, systemName, 'data-location.json');
  const existingPaths = new Set(existing.map((item) => path.resolve(item)));
  const sandbox = {
    process: {argv, cwd: () => cwd, uptime: () => 0.1},
    require: (request) => {
      if (request === 'electron') return {app};
      if (request === 'path') return path;
      if (request === './instance-lock.js') {
        return {
          resolveInstanceLock: (options) =>
            resolveInstanceLock({
              ...options,
              argv,
              cwd,
              pathExists: (target) => existingPaths.has(path.resolve(target)),
              probeWritable: () => true,
            }),
        };
      }
      if (request === 'fs') {
        return {
          existsSync: (target) => existingPaths.has(path.resolve(target)),
          readFileSync: (target) => {
            if (path.resolve(target) !== path.resolve(pointerPath) || pointer === undefined) {
              throw new Error(`unexpected read: ${target}`);
            }
            return JSON.stringify(pointer);
          },
        };
      }
      if (request === './main.bundle.js') {
        bundleLoads += 1;
        return {};
      }
      throw new Error(`unexpected require: ${request}`);
    },
  };
  sandbox.global = sandbox;
  vm.runInNewContext(launcherSource, sandbox, {filename: launcherPath});

  return {
    app,
    globals: sandbox,
    emit: (argvValue) => listeners.get('second-instance')?.({}, argvValue),
    setPathCalls,
    lockPath: () => lockPath,
    lockCount: () => lockCount,
    quitCount: () => quitCount,
    exitCount: () => exitCount,
    bundleLoads: () => bundleLoads,
  };
};

{
  const result = runLauncher({acquired: false});
  assert(result.lockCount() === 1, 'secondary launch must request the lock once');
  assert(result.exitCount() === 1, 'secondary launch must exit immediately');
  assert(result.quitCount() === 0, 'secondary launch must skip graceful quit');
  assert(result.bundleLoads() === 0, 'secondary launch must not parse main.bundle.js');
}

{
  const normal = {incognito: false, win: {isDestroyed: () => false}};
  const incognito = {incognito: true, win: {isDestroyed: () => false}};
  const workspace = {
    incognito: false,
    workspaceId: 'workspace-test',
    win: {isDestroyed: () => false},
  };
  const destroyedNormal = {incognito: false, win: {isDestroyed: () => true}};

  assert(
    findSecondInstanceWindow({
      incognito: false,
      current: incognito,
      lastFocused: destroyedNormal,
      list: [incognito, normal],
    }) === normal,
    'normal launch must skip incognito and destroyed windows',
  );
  assert(
    findSecondInstanceWindow({
      incognito: false,
      current: incognito,
      lastFocused: incognito,
      list: [incognito],
    }) === undefined,
    'normal launch with only incognito windows must request a new window',
  );
  assert(
    findSecondInstanceWindow({
      incognito: true,
      current: normal,
      lastFocused: incognito,
      list: [normal, incognito],
    }) === incognito,
    'incognito launch must reuse an incognito window',
  );
  assert(
    findSecondInstanceWindow({
      incognito: false,
      current: workspace,
      lastFocused: workspace,
      list: [workspace, normal],
    }) === normal,
    'normal launch must skip a focused workspace and reuse the main window',
  );
  assert(
    findSecondInstanceWindow({
      incognito: false,
      current: workspace,
      lastFocused: workspace,
      list: [workspace],
    }) === undefined,
    'normal launch with only workspaces must request a new main window',
  );
}

{
  const result = runLauncher();
  assert(result.bundleLoads() === 1, 'primary launch must load main.bundle.js');
  assert(result.app.name === '雨见浏览器', 'launcher must preserve app.name');
  result.emit(['first']);
  result.emit(['second']);
  assert(
    result.globals.__rainseeSecondInstanceQueue.map((item) => item[0]).join(',') ===
      'first,second',
    'early argv requests must remain ordered',
  );
  const received = [];
  result.globals.__rainseeSecondInstanceHandler = (argv) => received.push(argv[0]);
  result.emit(['third']);
  assert(received.join(',') === 'third', 'late argv request must reach installed handler');
}

{
  const customData = 'D:\\RainseeData';
  const baseline = runLauncher();
  const result = runLauncher({pointer: {current: customData}});
  assert(
    result.lockPath() === baseline.lockPath(),
    'custom data path must not change the stable installed lock',
  );
}

{
  const migrationSource = 'D:\\RainseeData';
  const migrationTarget = 'E:\\MovedRainseeData';
  const result = runLauncher({
    pointer: {pending: {from: migrationSource, to: migrationTarget}},
    existing: [migrationSource],
  });
  assert(
    result.lockPath() === runLauncher().lockPath(),
    'pending migration must keep the stable installed lock',
  );
}

{
  const result = runLauncher({
    isPackaged: false,
    pointer: {current: 'D:\\InstalledRainseeData'},
  });
  assert(
    result.lockPath() !== runLauncher().lockPath(),
    'development launch must use an installation-isolated lock',
  );
}

{
  const customData = 'D:\\RainseeData';
  const result = runLauncher({
    pointer: {current: customData},
    argv: ['electron.exe', 'app', '--rainsee-profile=work'],
  });
  assert(
    result.lockPath() !== runLauncher({pointer: {current: customData}}).lockPath(),
    'profile must use an isolated stable lock namespace',
  );
}

{
  const result = runLauncher({
    argv: ['electron.exe', 'app', '--rainsee-profile=..'],
  });
  assert(result.lockCount() === 0, 'invalid profile must bypass the normal lock');
  assert(result.bundleLoads() === 1, 'invalid profile must load the existing error flow');
}

{
  const result = runLauncher({appName: '雨见浏览器-nightly'});
  assert(
    result.app.name === '雨见浏览器-nightly',
    'nightly name must remain available to bootstrap-paths',
  );
}

{
  const defaultUserData = 'C:\\Users\\test\\AppData\\Roaming\\rainsee';
  const app = {
    name: '雨见浏览器',
    isPackaged: true,
    getPath: (name) =>
      name === 'appData'
        ? 'C:\\Users\\test\\AppData\\Roaming'
        : defaultUserData,
  };
  const fallback = resolveInstanceLock({
    app,
    argv: ['electron.exe', 'app'],
    cwd: 'C:\\rainsee',
    pathExists: () => false,
    probeWritable: () => false,
  });
  assert(fallback.usedFallback, 'unwritable stable lock directory must be reported');
  assert(
    fallback.lockPath === defaultUserData,
    'unwritable stable lock directory must fall back to Electron userData',
  );
}

console.log('single-instance launcher tests passed');
