import * as React from 'react';
import styled, { css } from 'styled-components';

import {
  IProfileFingerprint,
  IProfileProxySettings,
  ProfileProxyMode,
} from '~/common/profile-network';
import { ITheme } from '~/interfaces';
import { ipcRenderer } from '~/common/renderer-ipc';
import { Switch } from '~/renderer/components/Switch';
import { Control, Row, SecondaryText, Title } from '../App/style';
import { NormalButton } from '../App';
import { getPalette } from '../../utils/palette';

interface IProfileNetworkPayload {
  available: boolean;
  profileName: string | null;
  fingerprintSupported: boolean;
  fingerprint: IProfileFingerprint;
  proxy: IProfileProxySettings;
}

interface IProxyForm {
  mode: ProfileProxyMode;
  host: string;
  port: string;
  username: string;
  password: string;
  bypass: string;
  pacScript: string;
}

const SectionHeading = styled.div`
  margin-top: 24px;
  margin-bottom: 2px;
  font-size: 18px;
  font-weight: 700;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

const PlainRow = styled(Row)`
  cursor: default;
`;

const RowInfo = styled.div`
  min-width: 0;
  flex: 1;
`;

const FingerprintControls = styled(Control)`
  gap: 10px;
`;

const FingerprintId = styled.span`
  font-family: 'SF Mono', 'Roboto Mono', Consolas, monospace;
  font-weight: 600;
`;

const ProxyRow = styled(Row)`
  align-items: stretch;
  flex-direction: column;
  cursor: default;
`;

const FieldGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(120px, 0.8fr) minmax(180px, 1.5fr) minmax(100px, 0.7fr);
  gap: 12px;
  width: 100%;
  margin-top: 12px;

  @media (max-width: 760px) {
    grid-template-columns: 1fr 1fr;
  }
`;

const Field = styled.label<{ $wide?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;

  ${({ $wide }) =>
    $wide &&
    css`
      grid-column: 1 / -1;
    `}
`;

const FieldLabel = styled.span`
  font-size: 12px;
  font-weight: 600;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const fieldStyle = css`
  width: 100%;
  height: 38px;
  padding: 0 11px;
  border-radius: 8px;
  font-family: inherit;
  font-size: 13px;
  outline: none;

  ${({ theme }: { theme?: ITheme }) => {
    const palette = getPalette(theme);
    return css`
      color: ${palette.textMain};
      background-color: ${palette.bg};
      border: 1px solid ${palette.line};

      &::placeholder {
        color: ${palette.textMute};
      }

      &:focus {
        border-color: ${palette.primary};
        box-shadow: 0 0 0 3px ${palette.primary}1f;
      }

      &:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
    `;
  }}
`;

const Input = styled.input`
  ${fieldStyle};
`;

const Select = styled.select`
  ${fieldStyle};
  cursor: pointer;
`;

const Textarea = styled.textarea`
  ${fieldStyle};
  height: auto;
  min-height: 110px;
  padding: 8px 11px;
  resize: vertical;
  font-family: 'SF Mono', 'Roboto Mono', Consolas, monospace;
  line-height: 1.5;
`;

const ProxyActions = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
  margin-top: 14px;
`;

const ProxyHint = styled(SecondaryText)`
  margin-top: 12px;
`;

const Status = styled.div<{ $error: boolean }>`
  margin-top: 10px;
  padding: 9px 12px;
  border-radius: 8px;
  font-size: 12.5px;
  line-height: 1.45;

  ${({ theme, $error }: { theme?: ITheme; $error: boolean }) => {
    const palette = getPalette(theme);
    const color = $error ? '#c53030' : palette.primary;
    return css`
      color: ${color};
      background-color: ${$error ? '#c5303012' : `${palette.primary}12`};
      box-shadow: inset 0 0 0 1px ${color}2b;
    `;
  }}
`;

const toForm = (proxy: IProfileProxySettings): IProxyForm => ({
  ...proxy,
  port: proxy.port ? String(proxy.port) : '',
});

export const ProfileNetwork = ({ profileName }: { profileName: string }) => {
  const [fingerprint, setFingerprint] =
    React.useState<IProfileFingerprint | null>(null);
  const [fingerprintSupported, setFingerprintSupported] =
    React.useState(false);
  const [proxy, setProxy] = React.useState<IProxyForm>({
    mode: 'system',
    host: '',
    port: '',
    username: '',
    password: '',
    bypass: '<local>',
    pacScript: '',
  });
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState({ text: '', error: false });

  React.useEffect(() => {
    ipcRenderer
      .invoke('profile-network-get')
      .then((payload: IProfileNetworkPayload) => {
        if (!payload) return;
        setFingerprintSupported(Boolean(payload.fingerprintSupported));
        setFingerprint(payload.fingerprint);
        if (payload.proxy) setProxy(toForm(payload.proxy));
      })
      .catch(() =>
        setStatus({ text: '无法读取网络设置', error: true }),
      );
  }, []);

  const updateProxy = (key: keyof IProxyForm, value: string) => {
    setProxy((current) => ({ ...current, [key]: value }));
    setStatus({ text: '', error: false });
  };

  const saveCurrentProxy = async (): Promise<boolean> => {
    const result = (await ipcRenderer.invoke('profile-proxy-save', {
      ...proxy,
      port:
        proxy.mode === 'direct' ||
        proxy.mode === 'system' ||
        proxy.mode === 'pac'
          ? 0
          : Number(proxy.port),
    })) as { ok: boolean; message?: string; proxy?: IProfileProxySettings };
    if (!result.ok) {
      setStatus({ text: result.message || '保存代理设置失败', error: true });
      return false;
    }
    if (result.proxy) setProxy(toForm(result.proxy));
    return true;
  };

  const onSave = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (await saveCurrentProxy()) {
        setStatus({
          text:
            proxy.mode === 'direct'
              ? '代理已关闭，后续连接将直接访问网络'
              : proxy.mode === 'system'
              ? '已使用本地系统代理设置'
              : '代理已保存并应用到当前窗口',
          error: false,
        });
      }
    } catch {
      setStatus({ text: '保存代理设置失败', error: true });
    } finally {
      setBusy(false);
    }
  };

  const onTest = async () => {
    if (busy) return;
    setBusy(true);
    setStatus({ text: '正在连接并检测出口 IP...', error: false });
    try {
      if (!(await saveCurrentProxy())) return;
      const result = (await ipcRenderer.invoke('profile-proxy-test')) as {
        ok: boolean;
        ip?: string;
        message?: string;
      };
      setStatus(
        result.ok
          ? { text: `连接成功，当前出口 IP：${result.ip}`, error: false }
          : { text: result.message || '代理连接失败', error: true },
      );
    } catch {
      setStatus({ text: '代理连接失败', error: true });
    } finally {
      setBusy(false);
    }
  };

  const toggleFingerprint = async () => {
    if (!fingerprint || busy) return;
    setBusy(true);
    try {
      const result = (await ipcRenderer.invoke(
        'profile-fingerprint-set-enabled',
        !fingerprint.enabled,
      )) as { ok: boolean; message?: string; fingerprint?: IProfileFingerprint };
      if (result.ok && result.fingerprint) {
        setFingerprint(result.fingerprint);
        setStatus({ text: '指纹设置将在重新加载网页后生效', error: false });
      } else {
        setStatus({ text: result.message || '修改指纹设置失败', error: true });
      }
    } finally {
      setBusy(false);
    }
  };

  const regenerateFingerprint = async () => {
    if (busy) return;
    if (!window.confirm('重新生成后，网站会将此小号识别为一台新设备。确定继续吗？')) {
      return;
    }
    setBusy(true);
    try {
      const result = (await ipcRenderer.invoke(
        'profile-fingerprint-regenerate',
      )) as { ok: boolean; message?: string; fingerprint?: IProfileFingerprint };
      if (result.ok && result.fingerprint) {
        setFingerprint(result.fingerprint);
        setStatus({ text: '新指纹已生成，将在重新加载网页后生效', error: false });
      } else {
        setStatus({ text: result.message || '重新生成指纹失败', error: true });
      }
    } finally {
      setBusy(false);
    }
  };

  const proxyEnabled = proxy.mode !== 'direct';

  return (
    <>
      <SectionHeading>
        {fingerprintSupported ? '小号身份与网络' : '网络代理'}
      </SectionHeading>
      {fingerprintSupported && (
        <PlainRow>
          <RowInfo>
            <Title>独立浏览器指纹</Title>
            <SecondaryText>
              “{profileName}”使用稳定的 Canvas、WebGL 与设备参数组合。
              {fingerprint && (
                <> 指纹编号：<FingerprintId>{fingerprint.id}</FingerprintId></>
              )}
            </SecondaryText>
          </RowInfo>
          <FingerprintControls>
            <NormalButton
              variant="soft"
              disabled={busy || !fingerprint}
              onClick={regenerateFingerprint}
            >
              重新生成
            </NormalButton>
            <Switch
              clickable
              value={fingerprint?.enabled === true}
              onClick={toggleFingerprint}
            />
          </FingerprintControls>
        </PlainRow>
      )}

      <ProxyRow>
        <div>
          <Title>独立 IP 代理</Title>
          <SecondaryText>
            {fingerprintSupported
              ? `代理仅应用于“${profileName}”的网络会话，其他小号和主账号不受影响。`
              : '代理将应用于主账号的全部网页会话；各小号互不影响，可在小号设置中单独配置。'}
          </SecondaryText>
        </div>

        <FieldGrid>
          <Field>
            <FieldLabel>代理类型</FieldLabel>
            <Select
              value={proxy.mode}
              disabled={busy}
              onChange={(event) => updateProxy('mode', event.target.value)}
            >
              <option value="direct">不使用代理</option>
              <option value="system">使用本地代理（系统代理）</option>
              <option value="http">HTTP 代理</option>
              <option value="socks5">SOCKS5 代理</option>
              <option value="pac">PAC 自动代理</option>
            </Select>
          </Field>
          {proxy.mode === 'system' ? (
            <ProxyHint>
              使用本机操作系统中的代理设置。请先在系统设置或本地代理工具中启用代理。
            </ProxyHint>
          ) : proxy.mode === 'pac' ? (
            <Field $wide>
              <FieldLabel>PAC 脚本或 URL</FieldLabel>
              <Textarea
                value={proxy.pacScript}
                disabled={busy}
                placeholder={
                  '粘贴 PAC 脚本（需含 FindProxyForURL），或填入 http(s)://、file:// 的 PAC 地址'
                }
                onChange={(event) =>
                  updateProxy('pacScript', event.target.value)
                }
              />
            </Field>
          ) : (
            <>
              <Field>
                <FieldLabel>服务器</FieldLabel>
                <Input
                  value={proxy.host}
                  disabled={busy || !proxyEnabled}
                  placeholder="127.0.0.1 或 proxy.example.com"
                  onChange={(event) => updateProxy('host', event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>端口</FieldLabel>
                <Input
                  type="number"
                  min="1"
                  max="65535"
                  value={proxy.port}
                  disabled={busy || !proxyEnabled}
                  placeholder="8080"
                  onChange={(event) => updateProxy('port', event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>用户名（可选）</FieldLabel>
                <Input
                  value={proxy.username}
                  disabled={busy || !proxyEnabled}
                  autoComplete="off"
                  onChange={(event) =>
                    updateProxy('username', event.target.value)
                  }
                />
              </Field>
              <Field>
                <FieldLabel>密码（可选）</FieldLabel>
                <Input
                  type="password"
                  value={proxy.password}
                  disabled={busy || !proxyEnabled}
                  autoComplete="new-password"
                  onChange={(event) =>
                    updateProxy('password', event.target.value)
                  }
                />
              </Field>
            </>
          )}
          {proxy.mode !== 'system' && (
            <Field $wide>
              <FieldLabel>不使用代理的地址</FieldLabel>
              <Input
                value={proxy.bypass}
                disabled={busy || !proxyEnabled}
                placeholder="<local>, localhost, *.example.com"
                onChange={(event) => updateProxy('bypass', event.target.value)}
              />
            </Field>
          )}
        </FieldGrid>

        <ProxyActions>
          <NormalButton variant="soft" disabled={busy} onClick={onTest}>
            测试出口 IP
          </NormalButton>
          <NormalButton disabled={busy} onClick={onSave}>
            保存并应用
          </NormalButton>
        </ProxyActions>
      </ProxyRow>

      {status.text && <Status $error={status.error}>{status.text}</Status>}
    </>
  );
};
