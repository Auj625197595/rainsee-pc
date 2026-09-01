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
import { getSettingsTranslator } from '../../utils';

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
  const t = getSettingsTranslator();
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
        setStatus({ text: t('sysNetReadFailed'), error: true }),
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
      setStatus({ text: result.message || t('sysProxySaveFailed'), error: true });
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
              ? t('sysProxyDirectOn')
              : proxy.mode === 'system'
              ? t('sysProxySystemOn')
              : t('sysProxySaved'),
          error: false,
        });
      }
    } catch {
      setStatus({ text: t('sysProxySaveFailed'), error: true });
    } finally {
      setBusy(false);
    }
  };

  const onTest = async () => {
    if (busy) return;
    setBusy(true);
    setStatus({ text: t('sysProxyTesting'), error: false });
    try {
      if (!(await saveCurrentProxy())) return;
      const result = (await ipcRenderer.invoke('profile-proxy-test')) as {
        ok: boolean;
        ip?: string;
        message?: string;
      };
      setStatus(
        result.ok
          ? { text: t('sysProxyTestOk', { ip: result.ip }), error: false }
          : { text: result.message || t('sysProxyTestFailed'), error: true },
      );
    } catch {
      setStatus({ text: t('sysProxyTestFailed'), error: true });
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
        setStatus({ text: t('sysFingerprintApplied'), error: false });
      } else {
        setStatus({
          text: result.message || t('sysFingerprintSetFailed'),
          error: true,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const regenerateFingerprint = async () => {
    if (busy) return;
    if (!window.confirm(t('sysRegenerateConfirm'))) {
      return;
    }
    setBusy(true);
    try {
      const result = (await ipcRenderer.invoke(
        'profile-fingerprint-regenerate',
      )) as { ok: boolean; message?: string; fingerprint?: IProfileFingerprint };
      if (result.ok && result.fingerprint) {
        setFingerprint(result.fingerprint);
        setStatus({ text: t('sysFingerprintRegenerated'), error: false });
      } else {
        setStatus({
          text: result.message || t('sysRegenerateFailed'),
          error: true,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const proxyEnabled = proxy.mode !== 'direct';

  return (
    <>
      <SectionHeading>
        {fingerprintSupported
          ? t('sysIdentityNetHeading')
          : t('sysNetHeading')}
      </SectionHeading>
      {fingerprintSupported && (
        <PlainRow>
          <RowInfo>
            <Title>{t('searchFingerprint')}</Title>
            <SecondaryText>
              {t('sysFingerprintDesc', { name: profileName })}
              {fingerprint && (
                <>
                  {' '}
                  {t('sysFingerprintId')}
                  <FingerprintId>{fingerprint.id}</FingerprintId>
                </>
              )}
            </SecondaryText>
          </RowInfo>
          <FingerprintControls>
            <NormalButton
              variant="soft"
              disabled={busy || !fingerprint}
              onClick={regenerateFingerprint}
            >
              {t('sysRegenerate')}
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
          <Title>{t('searchProxyIp')}</Title>
          <SecondaryText>
            {fingerprintSupported
              ? t('sysProxyAltDesc', { name: profileName })
              : t('sysProxyMainDesc')}
          </SecondaryText>
        </div>

        <FieldGrid>
          <Field>
            <FieldLabel>{t('sysProxyType')}</FieldLabel>
            <Select
              value={proxy.mode}
              disabled={busy}
              onChange={(event) => updateProxy('mode', event.target.value)}
            >
              <option value="direct">{t('sysProxyDirectMode')}</option>
              <option value="system">{t('sysProxySystemMode')}</option>
              <option value="http">{t('sysProxyHttp')}</option>
              <option value="socks5">{t('sysProxySocks5')}</option>
              <option value="pac">{t('sysProxyPac')}</option>
            </Select>
          </Field>
          {proxy.mode === 'system' ? (
            <ProxyHint>{t('sysProxySystemHint')}</ProxyHint>
          ) : proxy.mode === 'pac' ? (
            <Field $wide>
              <FieldLabel>{t('sysPacLabel')}</FieldLabel>
              <Textarea
                value={proxy.pacScript}
                disabled={busy}
                placeholder={t('sysPacPlaceholder')}
                onChange={(event) =>
                  updateProxy('pacScript', event.target.value)
                }
              />
            </Field>
          ) : (
            <>
              <Field>
                <FieldLabel>{t('sysServer')}</FieldLabel>
                <Input
                  value={proxy.host}
                  disabled={busy || !proxyEnabled}
                  placeholder={t('siServerPlaceholder')}
                  onChange={(event) => updateProxy('host', event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>{t('sysPort')}</FieldLabel>
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
                <FieldLabel>{t('sysUsername')}</FieldLabel>
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
                <FieldLabel>{t('sysPassword')}</FieldLabel>
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
              <FieldLabel>{t('sysBypassLabel')}</FieldLabel>
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
            {t('sysTestIp')}
          </NormalButton>
          <NormalButton disabled={busy} onClick={onSave}>
            {t('sysSaveApply')}
          </NormalButton>
        </ProxyActions>
      </ProxyRow>

      {status.text && <Status $error={status.error}>{status.text}</Status>}
    </>
  );
};
