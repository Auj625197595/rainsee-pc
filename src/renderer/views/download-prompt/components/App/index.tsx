import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';
import { CaretDown, FolderOpen } from '@phosphor-icons/react';
import { UIStyle } from '~/renderer/mixins/default-styles';
import { IDownloadPromptResult } from '~/interfaces';
import store from '../../store';
import {
  Actions,
  CancelButton,
  ErrorText,
  Field,
  FieldLabel,
  FileInput,
  Header,
  OpenOption,
  PathButton,
  PathText,
  PrimaryButton,
  Select,
  SelectControl,
  Source,
  StyledApp,
  Title,
  UrlInput,
} from './style';

export const App = observer(() => {
  const fileNameRef = React.useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = React.useState('');
  const [directory, setDirectory] = React.useState('');
  const [downloaderType, setDownloaderType] = React.useState('browser');
  const [openWhenDone, setOpenWhenDone] = React.useState(false);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!store.visible) return;
    setFileName(store.data.fileName);
    setDirectory(store.data.directory);
    setDownloaderType('browser');
    setOpenWhenDone(false);
    setError('');
    setBusy(false);
    requestAnimationFrame(() => {
      fileNameRef.current?.focus();
      fileNameRef.current?.select();
    });
  }, [store.visible, store.data]);

  const selectDirectory = async () => {
    const selected = await store.selectDirectory();
    if (selected) {
      setDirectory(selected);
      setError('');
    }
  };

  const submit = async (action: IDownloadPromptResult['action']) => {
    if (busy) return;
    setBusy(true);
    setError('');
    const response = await store.submit({
      action,
      fileName,
      directory,
      downloaderType,
    });
    if (!response?.ok) {
      setError(response?.message || '无法开始下载');
      setBusy(false);
    }
  };

  const externalDownloader = downloaderType !== 'browser';

  return (
    <ThemeProvider
      theme={{
        ...store.theme,
        dark: store.theme['dialog.lightForeground'],
      }}
    >
      <StyledApp
        visible={store.visible}
        onKeyDown={(event) => {
          if (event.key === 'Escape') submit('cancel');
        }}
      >
        <UIStyle />
        <Header>
          <Title>下载文件</Title>
          <Source title={store.data.source}>来自 {store.data.source}</Source>
          <UrlInput
            aria-label="下载链接"
            title={store.data.url}
            value={store.data.url}
            readOnly
            spellCheck={false}
            onFocus={(event) => event.currentTarget.select()}
          />
        </Header>

        <Field>
          <FieldLabel htmlFor="download-file-name">文件名</FieldLabel>
          <FileInput
            ref={fileNameRef}
            id="download-file-name"
            value={fileName}
            autoFocus
            spellCheck={false}
            onChange={(event) => {
              setFileName(event.target.value);
              setError('');
            }}
          />
        </Field>

        <Field>
          <FieldLabel>存储位置</FieldLabel>
          <PathButton
            type="button"
            title={directory}
            aria-label="选择存储位置"
            onClick={selectDirectory}
          >
            <PathText>{directory}</PathText>
            <FolderOpen size={17} />
          </PathButton>
        </Field>

        <Field>
          <FieldLabel htmlFor="download-method">下载方式</FieldLabel>
          <SelectControl>
            <Select
              id="download-method"
              value={downloaderType}
              onChange={(event) => setDownloaderType(event.target.value)}
            >
              <option value="browser">浏览器</option>
              {store.data.downloaders.map((downloader) => (
                <option key={downloader.type} value={downloader.type}>
                  {downloader.name}
                </option>
              ))}
            </Select>
            <CaretDown size={14} weight="bold" />
          </SelectControl>
        </Field>

        <Actions>
          {error ? (
            <ErrorText title={error} role="alert">
              {error}
            </ErrorText>
          ) : (
            <OpenOption
              title={
                externalDownloader
                  ? '外部下载器不支持下载后自动打开'
                  : undefined
              }
            >
              <input
                type="checkbox"
                checked={openWhenDone}
                disabled={busy || externalDownloader}
                onChange={(event) => setOpenWhenDone(event.target.checked)}
              />
              下载后打开
            </OpenOption>
          )}
          <CancelButton
            type="button"
            disabled={busy}
            onClick={() => submit('cancel')}
          >
            取消
          </CancelButton>
          <PrimaryButton
            type="button"
            disabled={busy}
            onClick={() =>
              submit(openWhenDone && !externalDownloader ? 'open' : 'save')
            }
          >
            {busy ? '处理中...' : '保存'}
          </PrimaryButton>
        </Actions>
      </StyledApp>
    </ThemeProvider>
  );
});
