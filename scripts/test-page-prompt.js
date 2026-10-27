const assert = require('assert');
const {spawnSync} = require('child_process');
const path = require('path');
const ts = require('typescript');
const electronRuntime = require('electron');

// Some editor terminals export ELECTRON_RUN_AS_NODE=1. Relaunch the Electron
// binary with a clean environment so this script remains directly runnable.
if (typeof electronRuntime === 'string') {
  const env = {...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawnSync(electronRuntime, [__filename], {
    cwd: path.resolve(__dirname, '..'),
    env,
    stdio: 'inherit',
  });
  if (child.error) throw child.error;
  process.exit(child.status == null ? 1 : child.status);
}

const {app, BrowserWindow, ipcMain} = electronRuntime;

require.extensions['.ts'] = (module, filename) => {
  const source = require('fs').readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

const {showPagePrompt} = require('../src/main/services/page-prompt.ts');
const preloadPath = path.resolve(
  __dirname,
  '../build/page-prompt-preload.bundle.js',
);

const waitForPromptWindow = async (parent) => {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const promptWindow = BrowserWindow.getAllWindows().find(
      (window) => window.id !== parent.id && !window.isDestroyed(),
    );
    if (promptWindow) return promptWindow;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Prompt window did not open');
};

const operatePrompt = async (parent, script) => {
  const promptWindow = await waitForPromptWindow(parent);
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const ready = await promptWindow.webContents
      .executeJavaScript('document.body.dataset.ready === "true"')
      .catch(() => false);
    if (ready) {
      await promptWindow.webContents.executeJavaScript(script);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Prompt window did not become ready');
};

app.whenReady().then(async () => {
  const parent = new BrowserWindow({
    width: 360,
    height: 220,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  ipcMain.on('page-prompt-smoke', (event, message, defaultValue) => {
    void showPagePrompt({
      parent,
      owner: event.sender,
      title: 'Prompt smoke test',
      message,
      defaultValue,
      confirmLabel: 'OK',
      cancelLabel: 'Cancel',
      dark: false,
      preloadPath,
    }).then((value) => {
      if (!event.sender.isDestroyed()) event.returnValue = value;
    });
  });

  try {
    await parent.loadURL('data:text/html,<title>prompt smoke</title>');

    const confirmResult = parent.webContents.executeJavaScript(`
      require('electron').ipcRenderer.sendSync(
        'page-prompt-smoke',
        'Enter a value',
        'seed'
      )
    `);
    await operatePrompt(
      parent,
      `document.getElementById('value').value = 'accepted';
       document.getElementById('form').requestSubmit();`,
    );
    assert.strictEqual(await confirmResult, 'accepted');

    const cancelResult = parent.webContents.executeJavaScript(`
      require('electron').ipcRenderer.sendSync(
        'page-prompt-smoke',
        'Cancel this prompt',
        'seed'
      )
    `);
    await operatePrompt(parent, `document.getElementById('cancel').click();`);
    assert.strictEqual(await cancelResult, null);

    console.log('page prompt runtime smoke test passed');
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
