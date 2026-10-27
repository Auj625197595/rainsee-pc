import {ipcRenderer} from 'electron';

interface PagePromptInit {
  message: string;
  defaultValue: string;
  confirmLabel: string;
  cancelLabel: string;
  dark: boolean;
}

const argumentPrefix = '--rainsee-page-prompt-id=';
const requestId = process.argv
  .find((argument) => argument.startsWith(argumentPrefix))
  ?.slice(argumentPrefix.length);
const resultChannel = requestId ? `page-prompt-result-${requestId}` : '';

window.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('form') as HTMLFormElement | null;
  const message = document.getElementById('message');
  const input = document.getElementById('value') as HTMLInputElement | null;
  const confirm = document.getElementById('confirm') as HTMLButtonElement | null;
  const cancel = document.getElementById('cancel') as HTMLButtonElement | null;
  if (!form || !message || !input || !confirm || !cancel || !resultChannel) {
    return;
  }

  let submitted = false;
  const submit = (value: string | null) => {
    if (submitted) return;
    submitted = true;
    ipcRenderer.send(resultChannel, value);
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit(input.value);
  });
  cancel.addEventListener('click', () => submit(null));
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') submit(null);
  });

  ipcRenderer.once('page-prompt-init', (_event, raw: PagePromptInit) => {
    const data = raw || ({} as PagePromptInit);
    document.documentElement.dataset.theme = data.dark ? 'dark' : 'light';
    message.textContent = String(data.message || '');
    input.value = String(data.defaultValue || '');
    confirm.textContent = String(data.confirmLabel || 'OK');
    cancel.textContent = String(data.cancelLabel || 'Cancel');
    document.body.dataset.ready = 'true';
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
});

