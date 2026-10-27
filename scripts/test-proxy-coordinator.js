const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function loadCoordinator() {
  const filename = path.resolve(__dirname, '../src/main/proxy-coordinator.ts');
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} };
  new Function(
    'require',
    'module',
    'exports',
    '__filename',
    '__dirname',
    output,
  )(() => ({}), loaded, loaded.exports, filename, path.dirname(filename));
  return loaded.exports;
}

async function main() {
  const {
    createExtensionProxyImpl,
    getEffectiveProxyCredentials,
    getEffectiveProxyState,
    setProfileProxyBaseline,
  } = loadCoordinator();
  const calls = [];
  const target = {
    async setProxy(config) {
      calls.push(['setProxy', config]);
    },
    async closeAllConnections() {
      calls.push(['closeAllConnections']);
    },
  };
  await setProfileProxyBaseline(target, {
    value: { mode: 'fixed_servers', profile: true },
    config: { mode: 'fixed_servers', proxyRules: 'profile:8080' },
    credentials: { username: 'profile-user', password: 'secret' },
  });
  const api = createExtensionProxyImpl(target);
  await api.set('extension-a', { mode: 'direct' }, { mode: 'direct' });
  assert.strictEqual(
    (await api.get('extension-a')).levelOfControl,
    'controlled_by_this_extension',
  );
  assert.strictEqual(getEffectiveProxyCredentials(target), null);

  await assert.rejects(() =>
    api.set(
      'extension-b',
      { mode: 'fixed_servers', extension: 'b' },
      { mode: 'fixed_servers', proxyRules: 'extension-b:8080' },
    ),
  );
  await api.set('extension-a', { mode: 'system' }, { mode: 'system' });
  assert.strictEqual(
    (await api.get('extension-a')).levelOfControl,
    'controlled_by_this_extension',
  );
  assert.strictEqual(
    (await api.get('extension-b')).levelOfControl,
    'controlled_by_other_extensions',
  );

  await setProfileProxyBaseline(target, {
    force: true,
    value: { mode: 'fixed_servers', profile: true },
    config: { mode: 'fixed_servers', proxyRules: 'forced-profile:8080' },
    credentials: { username: 'forced-user', password: 'forced-secret' },
  });
  assert.strictEqual(
    (await api.get('extension-a')).levelOfControl,
    'not_controllable',
  );
  assert.strictEqual((await getEffectiveProxyState(target)).source, 'profile');
  assert.deepStrictEqual(getEffectiveProxyCredentials(target), {
    username: 'forced-user',
    password: 'forced-secret',
  });
  const beforeForcedExtensionUpdate = calls.length;
  await api.set('extension-a', { mode: 'direct' }, { mode: 'direct' });
  assert.strictEqual(calls.length, beforeForcedExtensionUpdate);

  await setProfileProxyBaseline(target, {
    force: false,
    value: { mode: 'system' },
    config: { mode: 'system' },
    credentials: null,
  });
  assert.strictEqual((await getEffectiveProxyState(target)).source, 'extension');

  const beforeBaselineUpdate = calls.length;
  await setProfileProxyBaseline(target, {
    value: { mode: 'system' },
    config: { mode: 'system' },
    credentials: null,
  });
  assert.strictEqual(calls.length, beforeBaselineUpdate);

  await api.clear('extension-a');
  assert.strictEqual(
    (await api.get('extension-b')).levelOfControl,
    'controllable_by_this_extension',
  );
  await api.set(
    'extension-b',
    { mode: 'fixed_servers', extension: 'b' },
    { mode: 'fixed_servers', proxyRules: 'extension-b:8080' },
  );
  await api.release('extension-b');
  assert.strictEqual((await getEffectiveProxyState(target)).source, 'profile');
  assert.deepStrictEqual(calls[calls.length - 2], [
    'setProxy',
    { mode: 'system' },
  ]);

  console.log('proxy coordinator tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
