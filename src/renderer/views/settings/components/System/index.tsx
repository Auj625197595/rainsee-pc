import * as React from 'react';
import styled, { css } from 'styled-components';
import { observer } from 'mobx-react-lite';
import {
  Archive,
  ArrowClockwise,
  Cpu,
  FolderSimple,
  Gauge,
  Lightning,
} from '@phosphor-icons/react';

import { ipcRenderer } from '~/common/renderer-ipc';
import { ITheme } from '~/interfaces';
import { Switch } from '~/renderer/components/Switch';
import {
  Title,
  Row,
  Control,
  SecondaryText,
  SettingGroup,
  SettingGroupBlock,
  SettingGroupLabel,
  SettingIcon,
} from '../App/style';
import { NormalButton } from '../App';
import store from '../../store';
import { onSwitchChange, getSettingsTranslator } from '../../utils';
import { getPalette } from '../../utils/palette';
import type { MessageKey } from '~/common/i18n';
import { ProfileNetwork } from './ProfileNetwork';

// 数据存储位置 / 迁移状态。
interface IPending {
  from: string;
  to: string;
}
interface IGetResult {
  current: string;
  defaultPath: string;
  isDefault: boolean;
  pending: IPending | null;
  canChange: boolean;
  profileName: string | null;
}
type ChangeResult =
  | { status: 'cancelled' }
  | { status: 'error'; message: string }
  | {
      status: 'ok';
      pending: IPending;
      existingNote?: string | null;
      spaceWarn?: string | null;
    };

// 非 clickable 行:整行点击无意义(只有按钮可点)。
const PlainRow = styled(Row)`
  cursor: default;
`;

// Row 左侧的标题+说明列(标题下挂一行次级文案)。
const RowInfo = styled.div`
  display: flex;
  flex-flow: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
`;

// 硬件加速切换后的"需重启生效"提示,仅在当前值与进入设置页时不同时展示。
const RestartHint = styled.span`
  margin-top: 4px;
  font-size: 12.5px;
  font-weight: 600;
  color: #d97706;
`;

const PathText = styled.div`
  margin-top: 3px;
  font-size: 12.5px;
  font-family: 'SF Mono', 'Roboto Mono', Consolas, monospace;
  word-break: break-all;
  line-height: 1.5;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const Arrow = styled.span`
  margin: 0 8px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

const WarnBanner = styled.div`
  margin-top: 10px;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 12.5px;
  line-height: 1.5;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textSub};
      background-color: ${p.primarySoft};
      box-shadow: inset 0 0 0 1px ${p.primary}33;
    `;
  }}
`;

const BtnGap = styled.div`
  width: 8px;
`;

const BackupModalLayer = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(24, 27, 42, 0.34);
  backdrop-filter: blur(2px);
`;

const BackupModal = styled.section`
  width: min(520px, 100%);
  border-radius: 14px;
  overflow: hidden;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background: ${p.surface};
      border: 1px solid ${p.line};
      box-shadow: 0 24px 64px -30px rgba(20, 27, 45, 0.58);
    `;
  }}
`;

const BackupModalHead = styled.div`
  padding: 20px 22px 15px;

  ${({ theme }: { theme?: ITheme }) => css`
    border-bottom: 1px solid ${getPalette(theme).line};
  `}
`;

const BackupModalTitle = styled.h3`
  margin: 0;
  font-size: 17px;
  font-weight: 700;
`;

const BackupModalSub = styled.p`
  margin: 5px 0 0;
  font-size: 12.5px;
  line-height: 1.55;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const BackupModalBody = styled.div`
  padding: 18px 22px 8px;
`;

const BackupModeTabs = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 4px;
  border-radius: 8px;

  ${({ theme }: { theme?: ITheme }) => css`
    background: ${getPalette(theme).bg};
  `}
`;

const BackupModeTab = styled.button<{ $active: boolean }>`
  height: 38px;
  border: 0;
  border-radius: 6px;
  font: inherit;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;

  ${({ $active, theme }: { $active: boolean; theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${$active ? p.primary : p.textSub};
      background: ${$active ? p.surface : 'transparent'};
      box-shadow: ${$active ? `0 1px 3px ${p.primary}1f` : 'none'};
    `;
  }}
`;

const BackupModeHint = styled.p`
  min-height: 38px;
  margin: 12px 1px 13px;
  font-size: 12.5px;
  line-height: 1.5;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const BackupOptions = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
`;

const BackupOption = styled.label`
  min-height: 42px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 11px;
  border-radius: 7px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;

  input {
    width: 16px;
    height: 16px;
    margin: 0;
    accent-color: ${({ theme }: { theme?: ITheme }) =>
      getPalette(theme).primary};
  }

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
    background: ${getPalette(theme).bg};
    border: 1px solid ${getPalette(theme).line};
  `}
`;

const BackupRecent = styled.section`
  margin-top: 18px;
`;

const BackupRecentHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
`;

const BackupRecentTitle = styled.h4`
  margin: 0;
  font-size: 13px;
  font-weight: 700;
`;

const BackupRecentHint = styled.span`
  font-size: 12px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

const BackupRecentList = styled.div`
  display: grid;
  gap: 6px;
`;

const BackupRecentRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 9px 10px;
  border-radius: 7px;
  border: 1px solid ${({ theme }: { theme?: ITheme }) => getPalette(theme).line};
  background: ${({ theme }: { theme?: ITheme }) => getPalette(theme).bg};
`;

const BackupRecentInfo = styled.div`
  min-width: 0;
  flex: 1;
`;

const BackupRecentName = styled.div`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  font-weight: 600;
`;

const BackupRecentMeta = styled.div`
  margin-top: 3px;
  font-size: 11.5px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const BackupOpenButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  color: ${({ theme }: { theme?: ITheme }) => getPalette(theme).textSub};
  background: transparent;
  cursor: pointer;

  &:hover {
    color: ${({ theme }: { theme?: ITheme }) => getPalette(theme).primary};
    background: ${({ theme }: { theme?: ITheme }) => getPalette(theme).surface};
  }
`;

const BackupModalFooter = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 22px 20px;
`;

type BackupItem = 'bookmarks' | 'history' | 'passwords' | 'extensions';
type BackupMode = 'full' | 'selected';

interface BackupHistoryEntry {
  path: string;
  name: string;
  mode: BackupMode;
  createdAt: string;
  size: number;
}

const BACKUP_OPTIONS: Array<{ key: BackupItem; labelKey: MessageKey }> = [
  { key: 'bookmarks', labelKey: 'abSuggestBookmarks' },
  { key: 'history', labelKey: 'pvItemHistory' },
  { key: 'passwords', labelKey: 'sysPasswords' },
  { key: 'extensions', labelKey: 'sysExtensions' },
];

const DataBackup = ({ onNotice }: { onNotice: (message: string) => void }) => {
  const t = getSettingsTranslator();
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<BackupMode>('full');
  const [items, setItems] = React.useState<BackupItem[]>([
    'bookmarks',
    'history',
    'passwords',
    'extensions',
  ]);
  const [busy, setBusy] = React.useState(false);
  const [recentBackups, setRecentBackups] = React.useState<
    BackupHistoryEntry[]
  >([]);
  const [recentLoading, setRecentLoading] = React.useState(false);

  const loadRecentBackups = async () => {
    setRecentLoading(true);
    try {
      const result = (await ipcRenderer.invoke('data-backup-list')) as unknown;
      setRecentBackups(
        Array.isArray(result) ? (result as BackupHistoryEntry[]) : [],
      );
    } catch {
      setRecentBackups([]);
    } finally {
      setRecentLoading(false);
    }
  };

  React.useEffect(() => {
    if (open) void loadRecentBackups();
  }, [open]);

  const openBackupDirectory = async (filePath: string) => {
    const result = (await ipcRenderer.invoke(
      'data-backup-open-dir',
      filePath,
    )) as {
      status?: string;
      message?: string;
    };
    if (result?.status === 'error')
      onNotice(result.message || t('sysOpenDirFailed'));
  };

  const toggleItem = (item: BackupItem) => {
    setItems((current) =>
      current.includes(item)
        ? current.filter((value) => value !== item)
        : [...current, item],
    );
  };

  const createBackup = async () => {
    if (busy || (mode === 'selected' && !items.length)) return;
    setBusy(true);
    try {
      const result = (await ipcRenderer.invoke(
        'data-backup-create',
        mode,
        items,
      )) as {
        status: 'ok' | 'cancelled' | 'error';
        path?: string;
        message?: string;
        skippedFiles?: string[];
      };
      if (result.status === 'ok') {
        void loadRecentBackups();
        setOpen(false);
        const skippedCount = result.skippedFiles?.length || 0;
        onNotice(
          skippedCount
            ? t('sysBackupDoneSkipped', {
                path: result.path,
                count: skippedCount,
              })
            : t('sysBackupDone', { path: result.path }),
        );
      } else if (result.status === 'error') {
        onNotice(result.message || t('sysBackupFailed'));
      }
    } catch {
      onNotice(t('sysBackupFailed'));
    } finally {
      setBusy(false);
    }
  };

  const restoreBackup = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const selected = (await ipcRenderer.invoke(
        'data-backup-select-restore',
      )) as {
        status: 'ok' | 'cancelled' | 'error';
        path?: string;
        message?: string;
      };
      if (selected.status === 'error') {
        onNotice(selected.message || t('sysRestoreReadFailed'));
        return;
      }
      if (selected.status !== 'ok' || !selected.path) return;

      const restored = (await ipcRenderer.invoke(
        'data-backup-restore',
        selected.path,
      )) as { status: 'ok' | 'cancelled' | 'error'; message?: string };
      if (restored.status === 'ok') {
        setOpen(false);
        onNotice(t('sysRestoreReady'));
        window.setTimeout(() => ipcRenderer.send('data-backup-relaunch'), 700);
      } else if (restored.status === 'error') {
        onNotice(restored.message || t('sysRestoreFailed'));
      }
    } catch {
      onNotice(t('sysRestoreFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PlainRow>
        <SettingIcon tone="cyan">
          <Archive size={19} weight="fill" />
        </SettingIcon>
        <RowInfo>
          <Title>{t('searchDataBackup')}</Title>
          <SecondaryText>{t('sysBackupRowDesc')}</SecondaryText>
        </RowInfo>
        <Control>
          <NormalButton variant="soft" onClick={() => setOpen(true)}>
            {t('sysManageBackups')}
          </NormalButton>
        </Control>
      </PlainRow>

      {open && (
        <BackupModalLayer
          role="presentation"
          onMouseDown={(event) => {
            if (!busy && event.target === event.currentTarget) setOpen(false);
          }}
        >
          <BackupModal
            role="dialog"
            aria-modal="true"
            aria-label={t('searchDataBackup')}
          >
            <BackupModalHead>
              <BackupModalTitle>{t('searchDataBackup')}</BackupModalTitle>
              <BackupModalSub>{t('sysBackupModalSub')}</BackupModalSub>
            </BackupModalHead>
            <BackupModalBody>
              <BackupModeTabs
                role="tablist"
                aria-label={t('sysBackupModeAria')}
              >
                <BackupModeTab
                  type="button"
                  $active={mode === 'full'}
                  onClick={() => setMode('full')}
                >
                  {t('sysBackupFull')}
                </BackupModeTab>
                <BackupModeTab
                  type="button"
                  $active={mode === 'selected'}
                  onClick={() => setMode('selected')}
                >
                  {t('sysBackupSelected')}
                </BackupModeTab>
              </BackupModeTabs>
              <BackupModeHint>
                {mode === 'full'
                  ? t('sysFullHint')
                  : t('sysSelectedHint')}
              </BackupModeHint>
              {mode === 'selected' && (
                <BackupOptions>
                  {BACKUP_OPTIONS.map((option) => (
                    <BackupOption key={option.key}>
                      <input
                        type="checkbox"
                        checked={items.includes(option.key)}
                        onChange={() => toggleItem(option.key)}
                      />
                      {t(option.labelKey)}
                    </BackupOption>
                  ))}
                </BackupOptions>
              )}
              <BackupRecent>
                <BackupRecentHead>
                  <BackupRecentTitle>{t('sysRecentBackups')}</BackupRecentTitle>
                  <BackupRecentHint>{t('sysMaxFive')}</BackupRecentHint>
                </BackupRecentHead>
                <BackupRecentList>
                  {recentLoading ? (
                    <BackupRecentMeta>{t('sysReadingBackups')}</BackupRecentMeta>
                  ) : recentBackups.length ? (
                    recentBackups.map((backup) => (
                      <BackupRecentRow key={backup.path}>
                        <BackupRecentInfo>
                          <BackupRecentName title={backup.path}>
                            {backup.name}
                          </BackupRecentName>
                          <BackupRecentMeta>
                            {backup.mode === 'full'
                              ? t('sysBackupFull')
                              : t('sysBackupSelected')}{' '}
                            · {new Date(backup.createdAt).toLocaleString()}
                          </BackupRecentMeta>
                        </BackupRecentInfo>
                        <BackupOpenButton
                          type="button"
                          title={t('sysOpenDirTitle')}
                          aria-label={t('sysOpenDirNamed', {
                            name: backup.name,
                          })}
                          onClick={() => void openBackupDirectory(backup.path)}
                        >
                          <FolderSimple size={17} weight="bold" />
                        </BackupOpenButton>
                      </BackupRecentRow>
                    ))
                  ) : (
                    <BackupRecentMeta>{t('sysNoBackups')}</BackupRecentMeta>
                  )}
                </BackupRecentList>
              </BackupRecent>
            </BackupModalBody>
            <BackupModalFooter>
              <NormalButton
                variant="soft"
                onClick={restoreBackup}
                disabled={busy}
              >
                <ArrowClockwise size={16} weight="bold" />
                {t('sysRestoreBackup')}
              </NormalButton>
              <NormalButton
                variant="soft"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                {t('cancel')}
              </NormalButton>
              <NormalButton
                onClick={createBackup}
                disabled={busy || (mode === 'selected' && !items.length)}
              >
                {busy ? t('pvProcessing') : t('sysChooseDirAndBackup')}
              </NormalButton>
            </BackupModalFooter>
          </BackupModal>
        </BackupModalLayer>
      )}
    </>
  );
};

const FlashSupport = observer(() => {
  const t = getSettingsTranslator();
  const enabled = store.settings.flashSupport !== false;
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState('');

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setStatus(
      enabled ? t('sysFlashUninstalling') : t('sysFlashInstalling'),
    );
    try {
      const result = (await ipcRenderer.invoke(
        'flash-support-set-enabled',
        !enabled,
      )) as { ok: boolean; enabled: boolean; message?: string };
      setStatus(
        result?.ok
          ? result.enabled
            ? t('sysFlashInstalled')
            : t('sysFlashDisabled')
          : result?.message || t('sysOperationFailed'),
      );
    } catch (_) {
      setStatus(t('sysOperationFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Row
      onClick={busy ? undefined : toggle}
      style={{ opacity: busy ? 0.7 : 1 }}
    >
      <SettingIcon tone="orange">
        <Lightning size={19} weight="fill" />
      </SettingIcon>
      <RowInfo>
        <Title>{t('searchFlashSupport')}</Title>
        <SecondaryText>{t('sysFlashDesc')}</SecondaryText>
        {status && <RestartHint>{status}</RestartHint>}
      </RowInfo>
      <Control>
        <Switch value={enabled} />
      </Control>
    </Row>
  );
});

// 硬件加速:app.disableHardwareAcceleration() 只能在启动前生效,运行时切换仅落盘,
// 真正生效要等下次启动。当前值与进入设置页时不同 → 提示重启。(从「个性化」迁入)
const HardwareAcceleration = observer(() => {
  const t = getSettingsTranslator();
  const { hardwareAcceleration } = store.settings;
  const [initialValue] = React.useState(hardwareAcceleration);
  const needsRestart = hardwareAcceleration !== initialValue;

  return (
    <Row onClick={onSwitchChange('hardwareAcceleration')}>
      <SettingIcon tone="cyan">
        <Cpu size={19} weight="fill" />
      </SettingIcon>
      <RowInfo>
        <Title>{t('searchHardwareAcceleration')}</Title>
        <SecondaryText>{t('sysHwAccelDesc')}</SecondaryText>
        {needsRestart && <RestartHint>{t('sysRestartRequired')}</RestartHint>}
      </RowInfo>
      <Control>
        <Switch value={hardwareAcceleration} />
      </Control>
    </Row>
  );
});

const MemorySaver = observer(() => {
  const t = getSettingsTranslator();
  const { memorySaver } = store.settings;

  return (
    <Row onClick={onSwitchChange('memorySaver')}>
      <SettingIcon tone="green">
        <Gauge size={19} weight="fill" />
      </SettingIcon>
      <RowInfo>
        <Title>{t('searchMemorySaver')}</Title>
      </RowInfo>
      <Control>
        <Switch value={memorySaver} />
      </Control>
    </Row>
  );
});

export const SystemSection = observer(() => {
  const t = getSettingsTranslator();
  const [data, setData] = React.useState<IGetResult | null>(null);
  const [notice, setNotice] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      const res = (await ipcRenderer.invoke('data-location-get')) as IGetResult;
      setData(res);
    } catch {
      // 忽略
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  React.useEffect(() => {
    if (!notice) return undefined;
    const t = window.setTimeout(() => setNotice(''), 3600);
    return () => window.clearTimeout(t);
  }, [notice]);

  const onChange = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = (await ipcRenderer.invoke(
        'data-location-change',
      )) as ChangeResult;
      if (res.status === 'cancelled') return;
      if (res.status === 'error') {
        setNotice(res.message || t('sysDirUnavailable'));
        return;
      }
      // ok:刷新到 pending 态;附带提示信息。
      await refresh();
      const notes: string[] = [];
      if (res.existingNote) notes.push(res.existingNote);
      if (res.spaceWarn) notes.push(res.spaceWarn);
      if (notes.length > 0) setNotice(notes.join(' '));
    } catch (e) {
      setNotice(t('sysChooseDirFailed'));
    } finally {
      setBusy(false);
    }
  };

  const onRelaunch = () => {
    ipcRenderer.send('data-location-relaunch');
  };

  const onReset = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = (await ipcRenderer.invoke(
        'data-location-reset',
      )) as ChangeResult;
      if (res.status === 'error') {
        setNotice(res.message || t('sysResetDirFailed'));
        return;
      }
      if (res.status === 'cancelled') return;
      await refresh();
      const notes: string[] = [];
      if (res.existingNote) notes.push(res.existingNote);
      if (res.spaceWarn) notes.push(res.spaceWarn);
      if (notes.length > 0) setNotice(notes.join(' '));
    } catch {
      setNotice(t('sysResetDirFailed'));
    } finally {
      setBusy(false);
    }
  };

  const onCancel = async () => {
    ipcRenderer.send('data-location-cancel');
    await refresh();
  };

  const onOpenDir = async () => {
    if (data?.current) {
      // 复用主进程的 shell.openPath:这里通过 IPC 触发更稳妥(WebUI 沙箱可能没有 remote.shell)。
      ipcRenderer.send('data-location-open-dir', data.current);
    }
  };

  const current = data?.current || '';
  const pending = data?.pending || null;

  return (
    <>
      {data && (
        <ProfileNetwork
          profileName={data.profileName || t('sysMainAccount')}
        />
      )}

      <SettingGroupBlock>
        <SettingGroupLabel>{t('sysRuntimeSection')}</SettingGroupLabel>
        <SettingGroup>
          <FlashSupport />
          <HardwareAcceleration />
          <MemorySaver />
        </SettingGroup>
      </SettingGroupBlock>

      <SettingGroupBlock>
        <SettingGroupLabel>{t('sysDataSection')}</SettingGroupLabel>
        <SettingGroup>
          {data && !data.canChange ? (
            <PlainRow>
              <SettingIcon tone="purple">
                <FolderSimple size={19} weight="fill" />
              </SettingIcon>
              <div>
                <Title>{t('sysAltDataLocation')}</Title>
                <PathText>{current}</PathText>
                <SecondaryText>
                  {t('sysAltDataDesc', { name: data.profileName || '' })}
                </SecondaryText>
              </div>
              <Control>
                <NormalButton variant="soft" onClick={onOpenDir}>
                  {t('sysOpenDir')}
                </NormalButton>
              </Control>
            </PlainRow>
          ) : pending ? (
            <>
              <PlainRow>
                <SettingIcon tone="purple">
                  <FolderSimple size={19} weight="fill" />
                </SettingIcon>
                <div>
                  <Title>{t('sysMigrationPending')}</Title>
                  <PathText>
                    {pending.from}
                    <Arrow>→</Arrow>
                    {pending.to}
                  </PathText>
                  <SecondaryText>{t('sysMigrationDesc')}</SecondaryText>
                </div>
                <Control>
                  <NormalButton variant="soft" onClick={onCancel}>
                    {t('sysCancelMigration')}
                  </NormalButton>
                  <BtnGap />
                  <NormalButton onClick={onRelaunch}>
                    {t('sysRelaunchNow')}
                  </NormalButton>
                </Control>
              </PlainRow>
            </>
          ) : (
            <PlainRow>
              <SettingIcon tone="purple">
                <FolderSimple size={19} weight="fill" />
              </SettingIcon>
              <div>
                <Title>{t('searchDataLocation')}</Title>
                <PathText>{current || t('scLoading')}</PathText>
                <SecondaryText>{t('sysDataLocationDesc')}</SecondaryText>
              </div>
              <Control>
                <NormalButton variant="soft" onClick={onOpenDir}>
                  {t('sysOpenDir')}
                </NormalButton>
                {data && !data.isDefault && (
                  <>
                    <BtnGap />
                    <NormalButton
                      variant="soft"
                      onClick={onReset}
                      disabled={busy}
                      title={t('sysResetTitle', { path: data.defaultPath })}
                    >
                      {t('resetToDefault')}
                    </NormalButton>
                  </>
                )}
                <BtnGap />
                <NormalButton onClick={onChange} disabled={busy}>
                  {t('modify')}
                </NormalButton>
              </Control>
            </PlainRow>
          )}
          <DataBackup onNotice={setNotice} />
        </SettingGroup>
      </SettingGroupBlock>

      {notice && <WarnBanner>{notice}</WarnBanner>}
    </>
  );
});
