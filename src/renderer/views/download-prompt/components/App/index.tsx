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
import { useI18n } from '~/renderer/components/I18n';

export const App = observer(() => {
  const t = useI18n();
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
      setError(response?.message || t('dlpFailed'));
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
          <Title>{t('dlpTitle')}</Title>
          <Source title={store.data.source}>
            {t('dlpFrom', { source: store.data.source })}
          </Source>
          <UrlInput
            aria-label={t('dlpLinkAria')}
            title={store.data.url}
            value={store.data.url}
            readOnly
            spellCheck={false}
            onFocus={(event) => event.currentTarget.select()}
          />
        </Header>

        <Field>
          <FieldLabel htmlFor="download-file-name">{t('dlpFilename')}</FieldLabel>
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
          <FieldLabel>{t('dlpLocation')}</FieldLabel>
          <PathButton
            type="button"
            title={directory}
            aria-label={t('dlpChooseLocationAria')}
            onClick={selectDirectory}
          >
            <PathText>{directory}</PathText>
            <FolderOpen size={17} />
          </PathButton>
        </Field>

        <Field>
          <FieldLabel htmlFor="download-method">{t('dlpMethod')}</FieldLabel>
          <SelectControl>
            <Select
              id="download-method"
              value={downloaderType}
              onChange={(event) => setDownloaderType(event.target.value)}
            >
              <option value="browser">{t('dlpMethodBrowser')}</option>
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
                  ? t('dlpAutoOpenUnsupported')
                  : undefined
              }
            >
              <input
                type="checkbox"
                checked={openWhenDone}
                disabled={busy || externalDownloader}
                onChange={(event) => setOpenWhenDone(event.target.checked)}
              />
              {t('dlpOpenWhenDone')}
            </OpenOption>
          )}
          <CancelButton
            type="button"
            disabled={busy}
            onClick={() => submit('cancel')}
          >
            {t('cancel')}
          </CancelButton>
          <PrimaryButton
            type="button"
            disabled={busy}
            onClick={() =>
              submit(openWhenDone && !externalDownloader ? 'open' : 'save')
            }
          >
            {busy ? t('dlpBusy') : t('save')}
          </PrimaryButton>
        </Actions>
      </StyledApp>
    </ThemeProvider>
  );
});
