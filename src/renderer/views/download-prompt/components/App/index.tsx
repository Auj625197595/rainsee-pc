import * as React from 'react';
import { clipboard } from 'electron';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';
import {
  CaretDown,
  Check,
  CopySimple,
  DownloadSimple,
  FolderOpen,
} from '@phosphor-icons/react';
import { UIStyle } from '~/renderer/mixins/default-styles';
import { IDownloadPromptResult } from '~/interfaces';
import {
  FILE_TYPE_COLORS,
  FileTypeIcon,
  getFileCategory,
} from '~/renderer/components/FileTypeIcon';
import { formatBytes } from '~/renderer/views/downloads/utils';
import store from '../../store';
import {
  Actions,
  badgeColors,
  CancelButton,
  ChangeButton,
  Divider,
  ErrorText,
  Field,
  FieldLabel,
  FileBadge,
  FileInput,
  Header,
  HeaderText,
  IconButton,
  Meta,
  MetaDot,
  OpenOption,
  PathControl,
  PathText,
  PrimaryButton,
  Select,
  SelectControl,
  Size,
  Source,
  StyledApp,
  Title,
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
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!store.visible) return;
    setFileName(store.data.fileName);
    setDirectory(store.data.directory);
    setDownloaderType('browser');
    setOpenWhenDone(false);
    setError('');
    setBusy(false);
    setCopied(false);
    requestAnimationFrame(() => {
      const input = fileNameRef.current;
      if (!input) return;
      input.focus();
      // 与 Chrome 另存为一致:只选中扩展名之前的部分,方便直接改名。
      const dot = input.value.lastIndexOf('.');
      input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
    });
  }, [store.visible, store.data]);

  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const selectDirectory = async () => {
    const selected = await store.selectDirectory();
    if (selected) {
      setDirectory(selected);
      setError('');
    }
  };

  const copyLink = () => {
    clipboard.writeText(store.data.url);
    setCopied(true);
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

  const confirm = () =>
    submit(openWhenDone && !externalDownloader ? 'open' : 'save');

  const externalDownloader = downloaderType !== 'browser';
  const theme = { ...store.theme, dark: store.theme['dialog.lightForeground'] };
  const category = getFileCategory(fileName || store.data.fileName);
  const size = store.data.size || 0;

  return (
    <ThemeProvider theme={theme}>
      <StyledApp
        visible={store.visible}
        onKeyDown={(event) => {
          if (event.key === 'Escape') submit('cancel');
        }}
      >
        <UIStyle />
        <Header>
          <FileBadge style={badgeColors(FILE_TYPE_COLORS[category], theme)}>
            <FileTypeIcon category={category} size={22} />
          </FileBadge>
          <HeaderText>
            <Title>{t('dlpTitle')}</Title>
            <Meta>
              <Source title={store.data.url}>
                {t('dlpFrom', { source: store.data.source })}
              </Source>
              {size > 0 && (
                <>
                  <MetaDot>·</MetaDot>
                  <Size>{formatBytes(size)}</Size>
                </>
              )}
            </Meta>
          </HeaderText>
          <IconButton
            type="button"
            title={copied ? t('dlpLinkCopied') : store.data.url}
            aria-label={t('dlpCopyLink')}
            onClick={copyLink}
          >
            {copied ? (
              <Check size={16} weight="bold" />
            ) : (
              <CopySimple size={16} />
            )}
          </IconButton>
        </Header>

        <Divider />

        <Field>
          <FieldLabel htmlFor="download-file-name">
            {t('dlpFilename')}
          </FieldLabel>
          <FileInput
            ref={fileNameRef}
            id="download-file-name"
            value={fileName}
            spellCheck={false}
            onChange={(event) => {
              setFileName(event.target.value);
              setError('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') confirm();
            }}
          />
        </Field>

        <Field>
          <FieldLabel id="download-location-label">
            {t('dlpLocation')}
          </FieldLabel>
          <PathControl title={directory} onClick={selectDirectory}>
            <FolderOpen size={16} />
            <PathText aria-labelledby="download-location-label">
              {directory}
            </PathText>
            <ChangeButton
              type="button"
              aria-label={t('dlpChooseLocationAria')}
              onClick={(event) => {
                event.stopPropagation();
                selectDirectory();
              }}
            >
              {t('dlpChange')}
            </ChangeButton>
          </PathControl>
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
                externalDownloader ? t('dlpAutoOpenUnsupported') : undefined
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
          <PrimaryButton type="button" disabled={busy} onClick={confirm}>
            <DownloadSimple size={15} weight="bold" />
            {busy ? t('dlpBusy') : t('dlpDownload')}
          </PrimaryButton>
        </Actions>
      </StyledApp>
    </ThemeProvider>
  );
});
