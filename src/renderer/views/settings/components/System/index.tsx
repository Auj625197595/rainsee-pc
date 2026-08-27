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
import { onSwitchChange } from '../../utils';
import { getPalette } from '../../utils/palette';
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
    accent-color: ${({ theme }: { theme?: ITheme }) => getPalette(theme).primary};
  }

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
    background: ${getPalette(theme).bg};
    border: 1px solid ${getPalette(theme).line};
  `}
`;

const BackupModalFooter = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 22px 20px;
`;

type BackupItem = 'bookmarks' | 'history' | 'passwords' | 'extensions';
type BackupMode = 'full' | 'selected';

const BACKUP_OPTIONS: Array<{ key: BackupItem; label: string }> = [
  { key: 'bookmarks', label: '书签' },
  { key: 'history', label: '历史记录' },
  { key: 'passwords', label: '密码' },
  { key: 'extensions', label: '扩展程序' },
];

const DataBackup = ({ onNotice }: { onNotice: (message: string) => void }) => {
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<BackupMode>('full');
  const [items, setItems] = React.useState<BackupItem[]>([
    'bookmarks',
    'history',
    'passwords',
    'extensions',
  ]);
  const [busy, setBusy] = React.useState(false);

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
      const result = (await ipcRenderer.invoke('data-backup-create', mode, items)) as {
        status: 'ok' | 'cancelled' | 'error';
        path?: string;
        message?: string;
      };
      if (result.status === 'ok') {
        setOpen(false);
        onNotice(`备份已保存至 ${result.path}`);
      } else if (result.status === 'error') {
        onNotice(result.message || '创建备份失败');
      }
    } catch {
      onNotice('创建备份失败');
    } finally {
      setBusy(false);
    }
  };

  const restoreBackup = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const selected = (await ipcRenderer.invoke('data-backup-select-restore')) as {
        status: 'ok' | 'cancelled' | 'error';
        path?: string;
        message?: string;
      };
      if (selected.status === 'error') {
        onNotice(selected.message || '无法读取备份文件');
        return;
      }
      if (selected.status !== 'ok' || !selected.path) return;

      const restored = (await ipcRenderer.invoke(
        'data-backup-restore',
        selected.path,
      )) as { status: 'ok' | 'cancelled' | 'error'; message?: string };
      if (restored.status === 'ok') {
        setOpen(false);
        onNotice('还原已准备完成，正在重启浏览器…');
        window.setTimeout(() => ipcRenderer.send('data-backup-relaunch'), 700);
      } else if (restored.status === 'error') {
        onNotice(restored.message || '还原失败');
      }
    } catch {
      onNotice('还原失败');
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
          <Title>数据备份</Title>
          <SecondaryText>
            完整备份可保存全部浏览器数据；可选备份支持单独保存书签、历史、密码和扩展。
          </SecondaryText>
        </RowInfo>
        <Control>
          <NormalButton variant="soft" onClick={() => setOpen(true)}>
            管理备份
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
          <BackupModal role="dialog" aria-modal="true" aria-label="数据备份">
            <BackupModalHead>
              <BackupModalTitle>数据备份</BackupModalTitle>
              <BackupModalSub>
                备份文件为 ZIP 格式。密码备份含敏感信息，请仅保存到可信位置。
              </BackupModalSub>
            </BackupModalHead>
            <BackupModalBody>
              <BackupModeTabs role="tablist" aria-label="备份模式">
                <BackupModeTab
                  type="button"
                  $active={mode === 'full'}
                  onClick={() => setMode('full')}
                >
                  完整备份
                </BackupModeTab>
                <BackupModeTab
                  type="button"
                  $active={mode === 'selected'}
                  onClick={() => setMode('selected')}
                >
                  可选备份
                </BackupModeTab>
              </BackupModeTabs>
              <BackupModeHint>
                {mode === 'full'
                  ? '归档整个数据目录，包含书签、历史、密码、Cookie、扩展及浏览器设置。'
                  : '选择需要保存的数据。还原时只覆盖所选项目，不影响其他浏览器设置。'}
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
                      {option.label}
                    </BackupOption>
                  ))}
                </BackupOptions>
              )}
            </BackupModalBody>
            <BackupModalFooter>
              <NormalButton variant="soft" onClick={restoreBackup} disabled={busy}>
                <ArrowClockwise size={16} weight="bold" />
                还原备份
              </NormalButton>
              <NormalButton variant="soft" onClick={() => setOpen(false)} disabled={busy}>
                取消
              </NormalButton>
              <NormalButton
                onClick={createBackup}
                disabled={busy || (mode === 'selected' && !items.length)}
              >
                {busy ? '处理中…' : '选择目录并备份'}
              </NormalButton>
            </BackupModalFooter>
          </BackupModal>
        </BackupModalLayer>
      )}
    </>
  );
};

const FlashSupport = observer(() => {
  const enabled = store.settings.flashSupport !== false;
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState('');

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setStatus(
      enabled ? '正在卸载 Flash 兼容插件…' : '正在安装 Flash 兼容插件…',
    );
    try {
      const result = (await ipcRenderer.invoke(
        'flash-support-set-enabled',
        !enabled,
      )) as { ok: boolean; enabled: boolean; message?: string };
      setStatus(
        result?.ok
          ? result.enabled
            ? 'Flash 兼容插件已安装并启用'
            : 'Flash 支持已关闭，兼容插件已卸载'
          : result?.message || '操作失败，请稍后重试',
      );
    } catch (_) {
      setStatus('操作失败，请稍后重试');
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
        <Title>Flash 支持</Title>
        <SecondaryText>
          使用 Ruffle 兼容插件播放旧版 Flash
          内容。开启会安装插件，关闭会卸载插件并停止检测 Flash 页面。
        </SecondaryText>
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
  const { hardwareAcceleration } = store.settings;
  const [initialValue] = React.useState(hardwareAcceleration);
  const needsRestart = hardwareAcceleration !== initialValue;

  return (
    <Row onClick={onSwitchChange('hardwareAcceleration')}>
      <SettingIcon tone="cyan">
        <Cpu size={19} weight="fill" />
      </SettingIcon>
      <RowInfo>
        <Title>硬件加速</Title>
        <SecondaryText>
          使用 GPU 渲染页面。若遇到花屏、黑屏或闪烁等问题可尝试关闭。
        </SecondaryText>
        {needsRestart && <RestartHint>更改将在重启浏览器后生效</RestartHint>}
      </RowInfo>
      <Control>
        <Switch value={hardwareAcceleration} />
      </Control>
    </Row>
  );
});

const MemorySaver = observer(() => {
  const { memorySaver } = store.settings;

  return (
    <Row onClick={onSwitchChange('memorySaver')}>
      <SettingIcon tone="green">
        <Gauge size={19} weight="fill" />
      </SettingIcon>
      <RowInfo>
        <Title>内存节省</Title>
      </RowInfo>
      <Control>
        <Switch value={memorySaver} />
      </Control>
    </Row>
  );
});

export const SystemSection = observer(() => {
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
        setNotice(res.message || '目录不可用');
        return;
      }
      // ok:刷新到 pending 态;附带提示信息。
      await refresh();
      const notes: string[] = [];
      if (res.existingNote) notes.push(res.existingNote);
      if (res.spaceWarn) notes.push(res.spaceWarn);
      if (notes.length > 0) setNotice(notes.join(' '));
    } catch (e) {
      setNotice('选择目录失败');
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
        setNotice(res.message || '恢复默认目录失败');
        return;
      }
      if (res.status === 'cancelled') return;
      await refresh();
      const notes: string[] = [];
      if (res.existingNote) notes.push(res.existingNote);
      if (res.spaceWarn) notes.push(res.spaceWarn);
      if (notes.length > 0) setNotice(notes.join(' '));
    } catch {
      setNotice('恢复默认目录失败');
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
      {data && <ProfileNetwork profileName={data.profileName || '主账号'} />}

      <SettingGroupBlock>
        <SettingGroupLabel>运行环境</SettingGroupLabel>
        <SettingGroup>
          <FlashSupport />
          <HardwareAcceleration />
          <MemorySaver />
        </SettingGroup>
      </SettingGroupBlock>

      <SettingGroupBlock>
        <SettingGroupLabel>数据存储</SettingGroupLabel>
        <SettingGroup>
          {data && !data.canChange ? (
            <PlainRow>
              <SettingIcon tone="purple">
                <FolderSimple size={19} weight="fill" />
              </SettingIcon>
              <div>
                <Title>小号数据存储位置</Title>
                <PathText>{current}</PathText>
                <SecondaryText>
                  “{data.profileName}
                  ”的数据与其他窗口完全隔离，存储位置由主账号统一管理。
                </SecondaryText>
              </div>
              <Control>
                <NormalButton variant="soft" onClick={onOpenDir}>
                  打开目录
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
                  <Title>迁移已计划</Title>
                  <PathText>
                    {pending.from}
                    <Arrow>→</Arrow>
                    {pending.to}
                  </PathText>
                  <SecondaryText>
                    下次启动浏览器时执行迁移,数据将复制到新位置(原目录保留)。
                  </SecondaryText>
                </div>
                <Control>
                  <NormalButton variant="soft" onClick={onCancel}>
                    取消迁移
                  </NormalButton>
                  <BtnGap />
                  <NormalButton onClick={onRelaunch}>立即重启</NormalButton>
                </Control>
              </PlainRow>
            </>
          ) : (
            <PlainRow>
              <SettingIcon tone="purple">
                <FolderSimple size={19} weight="fill" />
              </SettingIcon>
              <div>
                <Title>数据存储位置</Title>
                <PathText>{current || '加载中…'}</PathText>
                <SecondaryText>
                  设置、书签、历史、扩展、登录态等全部数据存放于此。修改后需重启迁移。
                </SecondaryText>
              </div>
              <Control>
                <NormalButton variant="soft" onClick={onOpenDir}>
                  打开目录
                </NormalButton>
                {data && !data.isDefault && (
                  <>
                    <BtnGap />
                    <NormalButton
                      variant="soft"
                      onClick={onReset}
                      disabled={busy}
                      title={`恢复到 ${data.defaultPath}`}
                    >
                      恢复默认
                    </NormalButton>
                  </>
                )}
                <BtnGap />
                <NormalButton onClick={onChange} disabled={busy}>
                  修改
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
