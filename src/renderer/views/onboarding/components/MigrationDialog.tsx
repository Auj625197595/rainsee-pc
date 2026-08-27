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

const bookmarkError = (value: string) => {
  if (value?.startsWith('BROWSER_NOT_FOUND')) return '未找到该浏览器的数据目录。';
  if (value?.startsWith('PROFILE_NOT_FOUND')) return '未找到可读取的浏览器用户资料。';
  if (value?.startsWith('PARSE_FAILED')) return '书签文件无法读取或已损坏。';
  return '读取书签失败，请关闭浏览器后重试。';
};

const historyError = (value: string) => {
  if (value?.startsWith('BROWSER_NOT_FOUND')) return '未找到该浏览器的历史数据库。';
  if (value?.startsWith('PROFILE_NOT_FOUND')) return '未找到包含历史记录的用户资料。';
  if (value?.startsWith('COPY_FAILED')) return '浏览器数据暂时无法复制，请稍后重试。';
  if (value?.startsWith('PARSE_FAILED')) return '历史数据库无法读取或已损坏。';
  return '读取历史记录失败，请稍后重试。';
};

const formatHistoryRange = (preview: IBrowserHistoryPreview) => {
  if (preview.oldestDate == null || preview.newestDate == null) return '';
  const format = (value: number) => new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
  return preview.oldestDate === preview.newestDate
    ? format(preview.oldestDate)
    : `${format(preview.oldestDate)} 至 ${format(preview.newestDate)}`;
};

export const MigrationDialog = ({mode, onClose, onImported}: Props) => {
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
        if (!extensionScan?.items.length) setError('未选择浏览器数据目录。');
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
            ? '找到的扩展均已安装，无需重复导入。'
            : '所选目录中没有找到可导入的扩展。',
        );
      }
    } catch {
      setError('读取浏览器扩展失败，请选择浏览器数据目录后重试。');
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
        .catch(() => setError('浏览器检测失败，请稍后重试。'))
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
        setError(bookmarkError(result.__error));
        return;
      }
      const counts = countBookmarks(result);
      if (counts.bookmarks === 0 && counts.folders === 0) {
        setError('该浏览器中没有可导入的书签。');
        return;
      }
      setBookmarkData(result);
      setBookmarkSource(browser.name);
      setBookmarkCounts(counts);
    } catch {
      setError('读取书签失败，请稍后重试。');
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
      onImported('bookmarks', `已导入 ${result?.bookmarks || 0} 个书签`);
    } catch {
      setError('导入书签失败，请稍后重试。');
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
        setError(historyError(result.__error));
        return;
      }
      if (!result?.count) {
        setError('该浏览器中没有可导入的历史记录。');
        return;
      }
      setHistoryPreview(result);
      setHistorySource(browser.name);
    } catch {
      setError('读取历史记录失败，请稍后重试。');
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
        setError(historyError(result.__error));
        return;
      }
      const message = result.imported > 0
        ? `已导入 ${result.imported} 条历史记录`
        : '历史记录已存在，无需重复导入';
      onImported('history', message);
    } catch {
      setError('导入历史记录失败，请稍后重试。');
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
        setError(`已导入 ${result.imported.length} 个，${result.failed.length} 个导入失败。`);
        return;
      }
      const message = result?.imported?.length
        ? `已导入 ${result.imported.length} 个扩展`
        : '所选扩展已存在，已过滤重复项';
      onImported('extensions', message);
    } catch {
      setError('导入失败，请确认浏览器扩展目录可读取。');
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
              ? '从其他浏览器导入书签'
              : mode === 'history'
                ? '从其他浏览器导入历史'
                : '从其他浏览器导入扩展'}
          </S.ImportHeading>
          <S.ImportIconButton type="button" title="关闭" disabled={busy} onClick={onClose}>
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
                  找到 {bookmarkCounts.bookmarks} 个书签
                  {bookmarkCounts.folders > 0 ? `，包含 ${bookmarkCounts.folders} 个文件夹` : ''}
                </S.ImportConfirmText>
              </S.ImportConfirm>
            ) : busy && !detected ? (
              <S.ImportEmpty><S.ImportSpinner />正在检测浏览器…</S.ImportEmpty>
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
                      <S.BrowserState>{available ? '选择' : '未检测到'}</S.BrowserState>
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
                  找到 {historyPreview.count} 条历史记录
                  {historyPreview.profileName ? ` · ${historyPreview.profileName}` : ''}
                </S.ImportConfirmText>
                <S.ImportConfirmText>{formatHistoryRange(historyPreview)}</S.ImportConfirmText>
              </S.ImportConfirm>
            ) : busy && !detected ? (
              <S.ImportEmpty><S.ImportSpinner />正在检测浏览器…</S.ImportEmpty>
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
                      <S.BrowserState>{available ? '选择' : '未检测到'}</S.BrowserState>
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
                全选
              </S.SelectAllButton>
              <S.SelectDirectoryButton type="button" disabled={busy} onClick={() => scanExtensions(true)}>
                <FolderOpenIcon size={16} />选择其他目录
              </S.SelectDirectoryButton>
            </S.ImportToolbar>
            <S.ExtensionList>
              {busy && !extensionScan ? (
                <S.ImportEmpty><S.ImportSpinner />正在读取浏览器扩展…</S.ImportEmpty>
              ) : extensionItems.length === 0 ? (
                <S.ImportEmpty><PuzzlePieceIcon size={40} weight="duotone" />{error || '没有可导入的扩展'}</S.ImportEmpty>
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
              ? `已过滤 ${extensionScan.duplicateCount} 个重复扩展`
              : '')}
          </S.ImportStatus>
          <S.ImportActions>
            {mode === 'bookmarks' && bookmarkData && (
              <S.ImportButton type="button" disabled={busy} onClick={() => setBookmarkData(null)}>返回</S.ImportButton>
            )}
            {mode === 'history' && historyPreview && (
              <S.ImportButton type="button" disabled={busy} onClick={() => setHistoryPreview(null)}>返回</S.ImportButton>
            )}
            <S.ImportButton type="button" disabled={busy} onClick={onClose}>取消</S.ImportButton>
            {mode === 'bookmarks' ? (
              <S.ImportButton $primary type="button" disabled={!bookmarkData || busy} onClick={commitBookmarks}>
                {busy && bookmarkData ? '正在导入…' : '确认导入'}
              </S.ImportButton>
            ) : mode === 'history' ? (
              <S.ImportButton $primary type="button" disabled={!historyPreview || busy} onClick={commitHistory}>
                {busy && historyPreview ? '正在导入…' : '确认导入'}
              </S.ImportButton>
            ) : (
              <S.ImportButton $primary type="button" disabled={!selectedKeys.length || busy} onClick={commitExtensions}>
                {busy && extensionScan ? '正在处理…' : `导入 (${selectedKeys.length})`}
              </S.ImportButton>
            )}
          </S.ImportActions>
        </S.ImportFooter>
      </S.ImportDialog>
    </S.ImportOverlay>
  );
};
