import * as React from 'react';
import {
  BrowsersIcon,
  CheckIcon,
  ClockCounterClockwiseIcon,
  FolderOpenIcon,
  PuzzlePieceIcon,
  XIcon,
} from '@phosphor-icons/react';

import {ipcRenderer} from '~/common/renderer-ipc';
import type {Translator} from '~/common/i18n';
import {useI18n} from '~/renderer/components/I18n';
import {
  IBrowserHistoryImportResult,
  IBrowserHistoryPreview,
  IBrowserExtensionImportItem,
  IBrowserExtensionImportScan,
  IBrowserExtensionImportResult,
} from '~/interfaces';
import * as S from './styles';

export type MigrationMode = 'bookmarks' | 'history' | 'extensions';

interface Props {
  mode: MigrationMode;
  onClose: () => void;
  onImported: (mode: MigrationMode, message: string) => void;
}

type BrowserId = 'chrome' | 'edge' | 'firefox';

const BROWSERS: Array<{id: BrowserId; name: string; color: string}> = [
  {id: 'chrome', name: 'Google Chrome', color: '#4285f4'},
  {id: 'edge', name: 'Microsoft Edge', color: '#0aa370'},
  {id: 'firefox', name: 'Mozilla Firefox', color: '#ff7139'},
];

const countBookmarks = (items: any[]) => {
  let bookmarks = 0;
  let folders = 0;
  const walk = (nodes: any[]) => {
    if (!Array.isArray(nodes)) return;
    nodes.forEach((node) => {
      if (node?.type === 'folder') {
        folders += 1;
        walk(node.children);
      } else if (node?.type === 'bookmark') {
        bookmarks += 1;
      }
    });
  };
  walk(items);
  return {bookmarks, folders};
};

const bookmarkError = (value: string, t: Translator) => {
  if (value?.startsWith('BROWSER_NOT_FOUND')) return t('mdErrBrowserNotFound');
  if (value?.startsWith('PROFILE_NOT_FOUND')) return t('mdErrProfileNotFound');
  if (value?.startsWith('PARSE_FAILED')) return t('mdErrParseFailed');
  return t('mdErrBookmarkGeneric');
};

const historyError = (value: string, t: Translator) => {
  if (value?.startsWith('BROWSER_NOT_FOUND')) return t('mdErrHistoryNotFound');
  if (value?.startsWith('PROFILE_NOT_FOUND')) return t('mdErrHistoryProfileNotFound');
  if (value?.startsWith('COPY_FAILED')) return t('mdErrCopyFailed');
  if (value?.startsWith('PARSE_FAILED')) return t('mdErrHistoryParseFailed');
  return t('mdErrHistoryGeneric');
};

const formatHistoryRange = (preview: IBrowserHistoryPreview, t: Translator) => {
  if (preview.oldestDate == null || preview.newestDate == null) return '';
  const format = (value: number) => new Intl.DateTimeFormat(document.documentElement.lang, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
  return preview.oldestDate === preview.newestDate
    ? format(preview.oldestDate)
    : t('mdDateRange', {
        from: format(preview.oldestDate),
        to: format(preview.newestDate),
      });
};

export const MigrationDialog = ({mode, onClose, onImported}: Props) => {
  const t = useI18n();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [detected, setDetected] = React.useState<Record<BrowserId, boolean> | null>(null);
  const [bookmarkData, setBookmarkData] = React.useState<any[] | null>(null);
  const [bookmarkSource, setBookmarkSource] = React.useState('');
  const [bookmarkCounts, setBookmarkCounts] = React.useState({bookmarks: 0, folders: 0});
  const [historyPreview, setHistoryPreview] = React.useState<IBrowserHistoryPreview | null>(null);
  const [historySource, setHistorySource] = React.useState('');
  const [extensionScan, setExtensionScan] = React.useState<IBrowserExtensionImportScan | null>(null);
  const [selectedKeys, setSelectedKeys] = React.useState<string[]>([]);

  const scanExtensions = React.useCallback(async (selectDirectory: boolean) => {
    setBusy(true);
    setError('');
    try {
      const result: IBrowserExtensionImportScan = await ipcRenderer.invoke(
        'extensions-scan-browser-import',
        selectDirectory,
      );
      if (result?.canceled) {
        if (!extensionScan?.items.length) setError(t('mdErrNoDir'));
        return;
      }
      if (!selectDirectory && result && !result.detected) {
        setBusy(false);
        await scanExtensions(true);
        return;
      }
      setExtensionScan(result);
      setSelectedKeys((result?.items || []).map((item) => item.key));
      if (!result?.items?.length) {
        setError(
          result?.duplicateCount
            ? t('mdErrAllInstalled')
            : t('mdErrNoneFound'),
        );
      }
    } catch {
      setError(t('mdErrReadFailed'));
    } finally {
      setBusy(false);
    }
  }, [extensionScan]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);

    if (mode === 'bookmarks' || mode === 'history') {
      setBusy(true);
      ipcRenderer.invoke(mode === 'history' ? 'browser-history-detect' : 'browser-import-detect')
        .then((result) => setDetected(result))
        .catch(() => setError(t('mdErrDetectFailed')))
        .finally(() => setBusy(false));
    } else {
      scanExtensions(false);
    }

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode]);

  const readBookmarks = async (browser: typeof BROWSERS[number]) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await ipcRenderer.invoke('browser-import-read', browser.id);
      if (result?.__error) {
        setError(bookmarkError(result.__error, t));
        return;
      }
      const counts = countBookmarks(result);
      if (counts.bookmarks === 0 && counts.folders === 0) {
        setError(t('mdErrNoBookmarks'));
        return;
      }
      setBookmarkData(result);
      setBookmarkSource(browser.name);
      setBookmarkCounts(counts);
    } catch {
      setError(t('mdErrBookmarkGeneric'));
    } finally {
      setBusy(false);
    }
  };

  const commitBookmarks = async () => {
    if (!bookmarkData || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await ipcRenderer.invoke('browser-import-commit', bookmarkData);
      onImported('bookmarks', t('mdBookmarkImported', { count: result?.bookmarks || 0 }));
    } catch {
      setError(t('mdErrBookmarkImport'));
    } finally {
      setBusy(false);
    }
  };

  const previewHistory = async (browser: typeof BROWSERS[number]) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await ipcRenderer.invoke('browser-history-preview', browser.id);
      if (result?.__error) {
        setError(historyError(result.__error, t));
        return;
      }
      if (!result?.count) {
        setError(t('mdErrNoHistory'));
        return;
      }
      setHistoryPreview(result);
      setHistorySource(browser.name);
    } catch {
      setError(t('mdErrHistoryGeneric'));
    } finally {
      setBusy(false);
    }
  };

  const commitHistory = async () => {
    if (!historyPreview || busy) return;
    setBusy(true);
    setError('');
    try {
      const result: IBrowserHistoryImportResult & {__error?: string} =
        await ipcRenderer.invoke('browser-history-import', historyPreview.browserId);
      if (result?.__error) {
        setError(historyError(result.__error, t));
        return;
      }
      const message = result.imported > 0
        ? t('mdHistoryImported', { count: result.imported })
        : t('mdHistoryExists');
      onImported('history', message);
    } catch {
      setError(t('mdErrHistoryImport'));
    } finally {
      setBusy(false);
    }
  };

  const commitExtensions = async () => {
    if (selectedKeys.length === 0 || busy) return;
    setBusy(true);
    setError('');
    try {
      const result: IBrowserExtensionImportResult = await ipcRenderer.invoke(
        'extensions-import-from-browser',
        [...selectedKeys],
      );
      if (result?.failed?.length) {
        const failed = new Set(result.failed.map((item) => item.key));
        setExtensionScan((current) => current ? {
          ...current,
          items: current.items.filter((item) => failed.has(item.key)),
        } : current);
        setSelectedKeys([...failed]);
        setError(t('mdExtPartial', { imported: result.imported.length, failed: result.failed.length }));
        return;
      }
      const message = result?.imported?.length
        ? t('mdExtImported', { count: result.imported.length })
        : t('mdExtDuplicates');
      onImported('extensions', message);
    } catch {
      setError(t('mdErrExtImport'));
    } finally {
      setBusy(false);
    }
  };

  const extensionItems: IBrowserExtensionImportItem[] = extensionScan?.items || [];
  const allSelected = extensionItems.length > 0 && selectedKeys.length === extensionItems.length;

  return (
    <S.ImportOverlay onMouseDown={() => !busy && onClose()}>
      <S.ImportDialog onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <S.ImportHeader>
          <S.ImportHeading>
            {mode === 'bookmarks' ? (
              <BrowsersIcon size={22} />
            ) : mode === 'history' ? (
              <ClockCounterClockwiseIcon size={22} />
            ) : (
              <PuzzlePieceIcon size={22} />
            )}
            {mode === 'bookmarks'
              ? t('mdImportBookmarksTitle')
              : mode === 'history'
                ? t('mdImportHistoryTitle')
                : t('mdImportExtensionsTitle')}
          </S.ImportHeading>
          <S.ImportIconButton type="button" title={t('close')} disabled={busy} onClick={onClose}>
            <XIcon size={18} />
          </S.ImportIconButton>
        </S.ImportHeader>

        {mode === 'bookmarks' ? (
          <S.ImportBody>
            {bookmarkData ? (
              <S.ImportConfirm>
                <BrowsersIcon size={46} weight="duotone" />
                <S.ImportConfirmTitle>{bookmarkSource}</S.ImportConfirmTitle>
                <S.ImportConfirmText>
                  {t('mdFoundBookmarks', { count: bookmarkCounts.bookmarks })}
                  {bookmarkCounts.folders > 0 ? t('mdWithFolders', { count: bookmarkCounts.folders }) : ''}
                </S.ImportConfirmText>
              </S.ImportConfirm>
            ) : busy && !detected ? (
              <S.ImportEmpty><S.ImportSpinner />{t('mdDetectingBrowsers')}</S.ImportEmpty>
            ) : (
              <S.BrowserList>
                {BROWSERS.map((browser) => {
                  const available = !!detected?.[browser.id];
                  return (
                    <S.BrowserOption
                      key={browser.id}
                      type="button"
                      disabled={!available || busy}
                      onClick={() => readBookmarks(browser)}
                    >
                      <S.BrowserDot $color={browser.color} />
                      <span>{browser.name}</span>
                      <S.BrowserState>{available ? t('mdChoose') : t('mdNotDetected')}</S.BrowserState>
                    </S.BrowserOption>
                  );
                })}
              </S.BrowserList>
            )}
          </S.ImportBody>
        ) : mode === 'history' ? (
          <S.ImportBody>
            {historyPreview ? (
              <S.ImportConfirm>
                <ClockCounterClockwiseIcon size={46} weight="duotone" />
                <S.ImportConfirmTitle>{historySource}</S.ImportConfirmTitle>
                <S.ImportConfirmText>
                  {t('mdFoundHistory', { count: historyPreview.count })}
                  {historyPreview.profileName ? ` · ${historyPreview.profileName}` : ''}
                </S.ImportConfirmText>
                <S.ImportConfirmText>{formatHistoryRange(historyPreview, t)}</S.ImportConfirmText>
              </S.ImportConfirm>
            ) : busy && !detected ? (
              <S.ImportEmpty><S.ImportSpinner />{t('mdDetectingBrowsers')}</S.ImportEmpty>
            ) : (
              <S.BrowserList>
                {BROWSERS.map((browser) => {
                  const available = !!detected?.[browser.id];
                  return (
                    <S.BrowserOption
                      key={browser.id}
                      type="button"
                      disabled={!available || busy}
                      onClick={() => previewHistory(browser)}
                    >
                      <S.BrowserDot $color={browser.color} />
                      <span>{browser.name}</span>
                      <S.BrowserState>{available ? t('mdChoose') : t('mdNotDetected')}</S.BrowserState>
                    </S.BrowserOption>
                  );
                })}
              </S.BrowserList>
            )}
          </S.ImportBody>
        ) : (
          <>
            <S.ImportToolbar>
              <S.SelectAllButton
                type="button"
                disabled={!extensionItems.length || busy}
                onClick={() => setSelectedKeys(allSelected ? [] : extensionItems.map((item) => item.key))}
              >
                <S.ImportCheckbox $checked={allSelected}>{allSelected && <CheckIcon size={12} weight="bold" />}</S.ImportCheckbox>
                {t('extSelectAll')}
              </S.SelectAllButton>
              <S.SelectDirectoryButton type="button" disabled={busy} onClick={() => scanExtensions(true)}>
                <FolderOpenIcon size={16} />{t('extChooseOtherDir')}
              </S.SelectDirectoryButton>
            </S.ImportToolbar>
            <S.ExtensionList>
              {busy && !extensionScan ? (
                <S.ImportEmpty><S.ImportSpinner />{t('mdReadingExtensions')}</S.ImportEmpty>
              ) : extensionItems.length === 0 ? (
                <S.ImportEmpty><PuzzlePieceIcon size={40} weight="duotone" />{error || t('mdNothingToImport')}</S.ImportEmpty>
              ) : extensionItems.map((item) => {
                const checked = selectedKeys.includes(item.key);
                return (
                  <S.ExtensionRow
                    key={item.key}
                    type="button"
                    $checked={checked}
                    onClick={() => setSelectedKeys(checked
                      ? selectedKeys.filter((key) => key !== item.key)
                      : [...selectedKeys, item.key])}
                  >
                    <S.ImportCheckbox $checked={checked}>{checked && <CheckIcon size={12} weight="bold" />}</S.ImportCheckbox>
                    <S.ExtensionIcon>
                      {item.icon ? <img src={item.icon} alt="" /> : <PuzzlePieceIcon size={21} />}
                    </S.ExtensionIcon>
                    <S.ExtensionInfo>
                      <S.ExtensionName>{item.name}</S.ExtensionName>
                      <S.ExtensionMeta>{item.browserName} · {item.profileName} · v{item.version}</S.ExtensionMeta>
                    </S.ExtensionInfo>
                  </S.ExtensionRow>
                );
              })}
            </S.ExtensionList>
          </>
        )}

        <S.ImportFooter>
          <S.ImportStatus $error={!!error}>
            {error || (mode === 'extensions' && extensionScan?.duplicateCount
              ? t('mdDuplicatesFiltered', { count: extensionScan.duplicateCount })
              : '')}
          </S.ImportStatus>
          <S.ImportActions>
            {mode === 'bookmarks' && bookmarkData && (
              <S.ImportButton type="button" disabled={busy} onClick={() => setBookmarkData(null)}>{t('mdBack')}</S.ImportButton>
            )}
            {mode === 'history' && historyPreview && (
              <S.ImportButton type="button" disabled={busy} onClick={() => setHistoryPreview(null)}>{t('mdBack')}</S.ImportButton>
            )}
            <S.ImportButton type="button" disabled={busy} onClick={onClose}>{t('cancel')}</S.ImportButton>
            {mode === 'bookmarks' ? (
              <S.ImportButton $primary type="button" disabled={!bookmarkData || busy} onClick={commitBookmarks}>
                {busy && bookmarkData ? t('mdImporting') : t('mdConfirmImport')}
              </S.ImportButton>
            ) : mode === 'history' ? (
              <S.ImportButton $primary type="button" disabled={!historyPreview || busy} onClick={commitHistory}>
                {busy && historyPreview ? t('mdImporting') : t('mdConfirmImport')}
              </S.ImportButton>
            ) : (
              <S.ImportButton $primary type="button" disabled={!selectedKeys.length || busy} onClick={commitExtensions}>
                {busy && extensionScan ? t('mdProcessing') : t('mdImportN', { count: selectedKeys.length })}
              </S.ImportButton>
            )}
          </S.ImportActions>
        </S.ImportFooter>
      </S.ImportDialog>
    </S.ImportOverlay>
  );
};
