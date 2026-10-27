const assert = require('assert')
const { spawnSync } = require('child_process')
const path = require('path')
const electronRuntime = require('electron')

// Some editor terminals export ELECTRON_RUN_AS_NODE=1. Relaunch the Electron
// binary with a clean environment so this script remains directly runnable.
if (typeof electronRuntime === 'string') {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawnSync(electronRuntime, [__filename], {
    cwd: path.resolve(__dirname, '..'),
    env,
    stdio: 'inherit',
  })
  if (child.error) throw child.error
  process.exit(child.status == null ? 1 : child.status)
}

const { app, BrowserWindow, ipcMain, session } = electronRuntime

const PRELOAD_ID = 'crx-document-start-timing-test'

async function main() {
  await app.whenReady()

  ipcMain.on('crx-get-document-start-scripts', (event) => {
    event.returnValue = {
      isolated: [
        {
          worldId: 998,
          code: `throw new Error('expected isolated document_start failure')`,
        },
        {
          worldId: 999,
          code: `
            document.documentElement.hasAttribute('data-crx-document-start');
            document.documentElement.setAttribute('data-crx-document-start', 'isolated');
          `,
        },
      ],
      main: [
        `throw new Error('expected main document_start failure')`,
        `
          document.documentElement.hasAttribute('data-crx-main-start');
          document.documentElement.setAttribute('data-crx-main-start', 'main');
        `,
      ],
    }
  })

  const testSession = session.fromPartition(`crx-document-start-${process.pid}`)
  const preloadPath = path.join(__dirname, '..', 'build', 'crx-preload.bundle.js')
  testSession.registerPreloadScript({
    id: PRELOAD_ID,
    type: 'frame',
    filePath: preloadPath,
  })

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      session: testSession,
      // Exercise the production overlap: extension tabs receive this classic
      // preload while the session frame preload can also land.
      preload: preloadPath,
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  try {
    const html = `<!doctype html><html><head><script>
      window.pageObserved = {
        isolated: document.documentElement.getAttribute('data-crx-document-start'),
        main: document.documentElement.getAttribute('data-crx-main-start')
      };
    </script></head><body></body></html>`
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const observed = await win.webContents.executeJavaScript('window.pageObserved')
    assert.deepStrictEqual(observed, { isolated: 'isolated', main: 'main' })

    win.webContents.send('crx-execute-isolated-script', {
      extensionId: 'listener-dedup-fixture',
      worldId: 999,
      code: `document.documentElement.setAttribute(
        'data-crx-listener-count',
        String(Number(document.documentElement.getAttribute('data-crx-listener-count') || 0) + 1)
      )`,
    })
    let listenerCount = null
    for (let attempt = 0; attempt < 20 && listenerCount === null; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      listenerCount = await win.webContents.executeJavaScript(
        `document.documentElement.getAttribute('data-crx-listener-count')`,
      )
    }
    assert.strictEqual(listenerCount, '1')
    console.log('extension document_start timing test passed')
  } finally {
    win.destroy()
    testSession.unregisterPreloadScript(PRELOAD_ID)
    ipcMain.removeAllListeners('crx-get-document-start-scripts')
    app.quit()
  }
}

main().catch((error) => {
  console.error(error)
  app.exit(1)
})
