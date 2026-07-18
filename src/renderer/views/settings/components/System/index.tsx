import * as React from 'react';
import styled, {css} from 'styled-components';
import {observer} from 'mobx-react-lite';

import {ipcRenderer} from '~/common/renderer-ipc';
import {ITheme} from '~/interfaces';
import {Switch} from '~/renderer/components/Switch';
import {Title, Row, Control, Header, SecondaryText} from '../App/style';
import {NormalButton} from '../App';
import store from '../../store';
import {onSwitchChange} from '../../utils';
import {getPalette} from '../../utils/palette';

// 数据存储位置 / 迁移状态。
interface IPending {
  from: string;
  to: string;
}
interface IGetResult {
  current: string;
  pending: IPending | null;
}
type ChangeResult =
  | {status: 'cancelled'}
  | {status: 'error'; message: string}
  | {status: 'ok'; pending: IPending; existingNote?: string | null; spaceWarn?: string | null};

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

  ${({theme}: {theme?: ITheme}) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const Arrow = styled.span`
  margin: 0 8px;

  ${({theme}: {theme?: ITheme}) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

const WarnBanner = styled.div`
  margin-top: 10px;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 12.5px;
  line-height: 1.5;

  ${({theme}: {theme?: ITheme}) => {
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

const FlashSupport = observer(() => {
  const enabled = store.settings.flashSupport !== false;
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState('');

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setStatus(enabled ? '正在卸载 Flash 兼容插件…' : '正在安装 Flash 兼容插件…');
    try {
      const result = (await ipcRenderer.invoke(
        'flash-support-set-enabled',
        !enabled,
      )) as {ok: boolean; enabled: boolean; message?: string};
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
    <Row onClick={busy ? undefined : toggle} style={{opacity: busy ? 0.7 : 1}}>
      <RowInfo>
        <Title>Flash 支持</Title>
        <SecondaryText>
          使用 Ruffle 兼容插件播放旧版 Flash 内容。开启会安装插件，关闭会卸载插件并停止检测 Flash 页面。
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
  const {hardwareAcceleration} = store.settings;
  const [initialValue] = React.useState(hardwareAcceleration);
  const needsRestart = hardwareAcceleration !== initialValue;

  return (
    <Row onClick={onSwitchChange('hardwareAcceleration')}>
      <RowInfo>
        <Title>硬件加速</Title>
        <SecondaryText>使用 GPU 渲染页面。若遇到花屏、黑屏或闪烁等问题可尝试关闭。</SecondaryText>
        {needsRestart && <RestartHint>更改将在重启浏览器后生效</RestartHint>}
      </RowInfo>
      <Control>
        <Switch value={hardwareAcceleration} />
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
      const res = (await ipcRenderer.invoke('data-location-change')) as ChangeResult;
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
      <Header>系统</Header>

      <FlashSupport />

      <HardwareAcceleration />

      {pending ? (
        <>
          <PlainRow>
            <div>
              <Title>迁移已计划</Title>
              <PathText>
                {pending.from}
                <Arrow>→</Arrow>
                {pending.to}
              </PathText>
              <SecondaryText>下次启动浏览器时执行迁移,数据将复制到新位置(原目录保留)。</SecondaryText>
            </div>
            <Control>
              <NormalButton variant="soft" onClick={onCancel}>取消迁移</NormalButton>
              <BtnGap />
              <NormalButton onClick={onRelaunch}>立即重启</NormalButton>
            </Control>
          </PlainRow>
        </>
      ) : (
        <PlainRow>
          <div>
            <Title>数据存储位置</Title>
            <PathText>{current || '加载中…'}</PathText>
            <SecondaryText>设置、书签、历史、扩展、登录态等全部数据存放于此。修改后需重启迁移。</SecondaryText>
          </div>
          <Control>
            <NormalButton variant="soft" onClick={onOpenDir}>打开目录</NormalButton>
            <BtnGap />
            <NormalButton onClick={onChange}>修改</NormalButton>
          </Control>
        </PlainRow>
      )}

      {notice && <WarnBanner>{notice}</WarnBanner>}
    </>
  );
});
