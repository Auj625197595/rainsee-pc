import { ipcRenderer } from 'electron';

const electronRenderer = {
  ipcRenderer,
};

(window as any).require = (id: string) => {
  if (id === 'electron') {
    return electronRenderer;
  }

  return undefined;
};
(window as any).electron = electronRenderer;

const updateBounds = () => {
  ipcRenderer.sendToHost(
    'webview-size',
    document.body.offsetWidth || document.body.scrollWidth,
    document.body.offsetHeight || document.body.scrollHeight,
  );
};

window.addEventListener('load', () => {
  updateBounds();

  // @ts-ignore
  const resizeObserver = new ResizeObserver(() => {
    updateBounds();
  });

  resizeObserver.observe(document.body);
});

const close = () => {
  ipcRenderer.sendToHost('webview-blur');
};

window.addEventListener('blur', close);

window.close = close;
