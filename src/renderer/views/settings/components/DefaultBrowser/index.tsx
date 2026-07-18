import * as React from 'react';
import { observer } from 'mobx-react-lite';

import { Header, Row, Title, Control, SecondaryText } from '../App/style';
import { NormalButton } from '../App';

// view-preload 暴露的纯函数桥(与 downloads store 同一套)。
const w = window as any;
const ipcInvoke: (channel: string, ...args: any[]) => Promise<any> =
  w.ipcInvoke ||
  ((channel, ...args) => w.electron.ipcRenderer.invoke(channel, ...args));

interface IStatus {
  isDefault: boolean;
  supported: boolean;
  platform: string;
}

export const DefaultBrowser = observer(() => {
  const [status, setStatus] = React.useState<IStatus | null>(null);
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      const s = await ipcInvoke('get-default-browser-status');
      setStatus(s);
    } catch (e) {
      setStatus(null);
    }
  }, []);

  React.useEffect(() => {
    refresh();

    // 用户从系统设置切回窗口时,重新查询一次状态。
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const onSetDefault = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await ipcInvoke('set-as-default-browser');
      // 给系统注册/设置页一点时间,再刷新状态。
      setTimeout(refresh, 800);
    } finally {
      setBusy(false);
    }
  };

  const isDefault = status?.isDefault;
  const supported = status ? status.supported : true;

  return (
    <>
      <Header>默认浏览器</Header>
      <Row style={{ cursor: 'default' }}>
        <div>
          <Title>
            {isDefault ? '雨见浏览器已是您的默认浏览器' : '雨见浏览器当前不是默认浏览器'}
          </Title>
          <SecondaryText>
            {isDefault
              ? '点击链接时将使用本浏览器打开。'
              : 'Windows 10/11 不允许程序自动抢占默认浏览器,点击下方按钮后请在弹出的系统设置中,将“网页浏览器”选择为“雨见浏览器”。'}
          </SecondaryText>
        </div>
        <Control>
          {isDefault ? (
            <NormalButton variant="soft" onClick={refresh}>已是默认</NormalButton>
          ) : (
            <NormalButton onClick={onSetDefault} disabled={busy}>
              {busy ? '设置中…' : '设为默认'}
            </NormalButton>
          )}
        </Control>
      </Row>
      {!supported && (
        <Row style={{ cursor: 'default' }}>
          <SecondaryText>
            当前为开发模式,无法写入系统注册表,设为默认仅在打包安装后生效。
          </SecondaryText>
        </Row>
      )}
    </>
  );
});
