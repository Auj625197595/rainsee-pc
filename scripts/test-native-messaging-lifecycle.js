const assert = require('assert');
const fs = require('fs');
const path = require('path');
const typescript = require('typescript');

const filename = path.resolve(
  __dirname,
  '../src/vendor/electron-chrome-extensions/browser/api/lib/native-messaging-host.ts',
);
const output = typescript.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: {
    module: typescript.ModuleKind.CommonJS,
    target: typescript.ScriptTarget.ES2019,
  },
}).outputText;

let resolveRegistryLookup;
const registryLookup = new Promise((resolve) => {
  resolveRegistryLookup = resolve;
});
let spawnCalls = 0;
const requireMock = (request) => {
  if (request === 'node:child_process') {
    return {
      spawn: () => {
        spawnCalls++;
        throw new Error('destroyed native host must not spawn a process');
      },
    };
  }
  if (request === 'node:fs') {
    return {
      promises: {
        readFile: async () =>
          Buffer.from(
            JSON.stringify({
              name: 'org.freedownloadmanager.fdm5.cnh',
              description: 'Free Download Manager',
              path: 'C:\\Program Files\\Free Download Manager\\wenativehost.exe',
              type: 'stdio',
              allowed_origins: [
                'chrome-extension://ahmpjcflkgiildlgicmcieglgoilbfdp/',
              ],
            }),
          ),
        stat: async () => ({ isFile: () => true }),
      },
    };
  }
  if (request === 'electron') {
    return { app: { getPath: () => 'C:\\rainsee-test' } };
  }
  if (request === 'debug') {
    return { __esModule: true, default: () => () => undefined };
  }
  if (request === './winreg') {
    return { readRegistryKey: () => registryLookup };
  }
  if (request === '../../router') {
    return {};
  }
  return require(request);
};

const loaded = { exports: {} };
new Function('require', 'module', 'exports', output)(
  requireMock,
  loaded,
  loaded.exports,
);

const { NativeMessagingHost } = loaded.exports;

const rendererFilename = path.resolve(
  __dirname,
  '../src/vendor/electron-chrome-extensions/renderer/index.ts',
);
const rendererSource = fs.readFileSync(rendererFilename, 'utf8');
const rendererAst = typescript.createSourceFile(
  rendererFilename,
  rendererSource,
  typescript.ScriptTarget.Latest,
  true,
  typescript.ScriptKind.TS,
);
let serializerInitializer;
const findSerializer = (node) => {
  if (
    typescript.isVariableDeclaration(node) &&
    typescript.isIdentifier(node.name) &&
    node.name.text === 'serializeNativeMessage'
  ) {
    serializerInitializer = node.initializer;
    return;
  }
  typescript.forEachChild(node, findSerializer);
};
findSerializer(rendererAst);
assert(serializerInitializer, 'main-world Native Messaging serializer should exist');

const serializerModule = { exports: undefined };
const serializerOutput = typescript.transpileModule(
  `module.exports = ${serializerInitializer.getText(rendererAst)}`,
  {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2019,
    },
  },
).outputText;
new Function('module', 'exports', serializerOutput)(
  serializerModule,
  serializerModule.exports,
);
const serializeNativeMessage = serializerModule.exports;
const nativeTask = {
  id: '2',
  type: 'fdm_json_task',
  json: JSON.stringify({ type: 'optionsClick' }),
  setJson() {},
};
assert.deepStrictEqual(serializeNativeMessage(nativeTask), {
  id: '2',
  type: 'fdm_json_task',
  json: JSON.stringify({ type: 'optionsClick' }),
});
assert(
  /this\._send\(serializeNativeMessage\(message\)\)/.test(rendererSource),
  'NativePort.postMessage should serialize before crossing contextBridge',
);
assert(
  /crx-native-msg-\$\{connectionId\}`,[\s\r\n]*crxSerializeMessage\(message\)/.test(
    rendererSource,
  ),
  'preload native Port send should sanitize before IPC',
);
assert(
  (() => {
    let methods;
    const visit = (node) => {
      if (
        typescript.isVariableDeclaration(node) &&
        typescript.isIdentifier(node.name) &&
        node.name.text === 'runtimeMethods' &&
        typescript.isArrayLiteralExpression(node.initializer)
      ) {
        methods = node.initializer.elements
          .filter(typescript.isStringLiteral)
          .map((element) => element.text);
      }
      typescript.forEachChild(node, visit);
    };
    visit(rendererAst);
    return (
      Array.isArray(methods) &&
      methods.includes('connectNative') &&
      methods.includes('sendNativeMessage') &&
      rendererSource.includes("'__crxRuntimePatched'")
    );
  })(),
  'non-configurable popup runtime must receive hosted methods and a readiness marker',
);
assert(
  (() => {
    let found = false;
    const visit = (node) => {
      if (
        typescript.isCallExpression(node) &&
        typescript.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'catch'
      ) {
        const sourceCall = node.expression.expression;
        if (
          typescript.isCallExpression(sourceCall) &&
          typescript.isIdentifier(sourceCall.expression) &&
          sourceCall.expression.text === 'invokeExtensionRaw' &&
          sourceCall.arguments[1]?.getText(rendererAst) === "'runtime.connectNative'"
        ) {
          found = true;
        }
      }
      typescript.forEachChild(node, visit);
    };
    visit(rendererAst);
    return found;
  })(),
  'connectNative IPC failures must disconnect the returned port',
);
let taskStarts = 0;
let taskEnds = 0;
let listenerAdds = 0;
let listenerRemoves = 0;
let disconnects = 0;
const sender = {
  ipc: {
    on: () => listenerAdds++,
    off: () => listenerRemoves++,
  },
  send: () => disconnects++,
  startTask: () => {
    taskStarts++;
    return { end: () => taskEnds++ };
  },
};

const host = new NativeMessagingHost(
  'ahmpjcflkgiildlgicmcieglgoilbfdp',
  sender,
  'test-connection',
  'org.freedownloadmanager.fdm5.cnh',
);

assert.strictEqual(taskStarts, 1, 'native Port should keep its service worker alive');
assert.strictEqual(listenerAdds, 1, 'native Port should listen for extension messages');

host.destroy();
host.destroy();

assert.strictEqual(taskEnds, 1, 'service worker task should be released exactly once');
assert.strictEqual(listenerRemoves, 1, 'native Port listener should be removed exactly once');
assert.strictEqual(disconnects, 1, 'native Port should emit one disconnect');

resolveRegistryLookup('C:\\native-host-manifest.json');
setImmediate(async () => {
  assert.strictEqual(spawnCalls, 0, 'a destroyed Port must not launch its native process');

  const oneShotHost = Object.create(NativeMessagingHost.prototype);
  oneShotHost.destroyed = false;
  oneShotHost.connected = false;
  oneShotHost.keepAlive = false;
  oneShotHost.connectionId = 'one-shot-test';
  oneShotHost.receiveBuffer = Buffer.alloc(0);
  const response = oneShotHost.sendAndReceive({ type: 'handshake' });
  const rejected = assert.rejects(
    response,
    /native host test failure/,
    'a pending one-shot response must reject when the host is destroyed',
  );
  oneShotHost.destroy(new Error('native host test failure'));
  await rejected;

  console.log('native messaging lifecycle regression tests passed');
});
