import * as React from 'react';
import styled, { css } from 'styled-components';

import {
  IProfileFingerprint,
  IProfileProxySettings,
  IProxyRoutingSettings,
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
  proxyControl: IProxyControl;
  proxyRuleStatus: IProxyRuleStatus;
}

interface IProxyRuleStatus {
  updating: boolean;
  gfwUpdatedAt?: number;
  gfwRules: number;
  gfwIgnored: number;
  lastError?: string;
}

interface IProxyControl {
  source: 'profile' | 'extension';
  extensionId?: string;
  extensionName?: string;
  mode?: string;
}

interface IProxyForm {
  force: boolean;
  mode: ProfileProxyMode;
  host: string;
  port: string;
  username: string;
  password: string;
  bypass: string;
  pacScript: string;
  routing: IProxyRoutingSettings;
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

const RouteActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;

  ${Input} {
    flex: 1;
  }
`;

const RouteRuleGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

const ProxyControlNotice = styled.div`
  margin-top: 12px;
  padding: 9px 12px;
  border-radius: 6px;
  font-size: 12.5px;
  line-height: 1.45;

  ${({ theme }: { theme?: ITheme }) => {
    const palette = getPalette(theme);
    return css`
      color: ${palette.textMain};
      background-color: ${palette.primary}12;
      box-shadow: inset 0 0 0 1px ${palette.primary}2b;
    `;
  }}
`;

const ForceProxyOption = styled.label`
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin-top: 12px;
  cursor: pointer;

  input {
    width: 16px;
    height: 16px;
    margin: 2px 0 0;
    flex: 0 0 auto;
    accent-color: ${({ theme }: { theme?: ITheme }) =>
      getPalette(theme).primary};
  }
`;

const ForceProxyText = styled.span`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`;

const ForceProxyTitle = styled.span`
  font-size: 13px;
  font-weight: 600;
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
  routing: proxy.routing || {
    mode: 'global',
    proxyRules: '',
    directRules: '',
    bypassLocal: true,
    gfwListUrl: '',
  },
});

export const ProfileNetwork = ({ profileName }: { profileName: string }) => {
  const t = getSettingsTranslator();
  const [fingerprint, setFingerprint] =
    React.useState<IProfileFingerprint | null>(null);
  const [fingerprintSupported, setFingerprintSupported] =
    React.useState(false);
  const [proxy, setProxy] = React.useState<IProxyForm>({
    force: false,
    mode: 'system',
    host: '',
    port: '',
    username: '',
    password: '',
    bypass: '<local>',
    pacScript: '',
    routing: {
      mode: 'global',
      proxyRules: '',
      directRules: '',
      bypassLocal: true,
      gfwListUrl: '',
    },
  });
  const [busy, setBusy] = React.useState(false);
  const [proxyControl, setProxyControl] = React.useState<IProxyControl>({
    source: 'profile',
  });
  const [status, setStatus] = React.useState({ text: '', error: false });
  const [ruleStatus, setRuleStatus] = React.useState<IProxyRuleStatus>({
    updating: false,
    gfwRules: 0,
    gfwIgnored: 0,
  });
  const [routeTestInput, setRouteTestInput] = React.useState('');

  React.useEffect(() => {
    const onProxyControlChanged = (_event: unknown, value: IProxyControl) => {
      if (value) setProxyControl(value);
    };
    ipcRenderer.on('profile-proxy-control-changed', onProxyControlChanged);
    ipcRenderer
      .invoke('profile-network-get')
      .then((payload: IProfileNetworkPayload) => {
        if (!payload) return;
        setFingerprintSupported(Boolean(payload.fingerprintSupported));
        setFingerprint(payload.fingerprint);
        if (payload.proxy) setProxy(toForm(payload.proxy));
        if (payload.proxyControl) setProxyControl(payload.proxyControl);
        if (payload.proxyRuleStatus) setRuleStatus(payload.proxyRuleStatus);
      })
      .catch(() =>
        setStatus({ text: t('sysNetReadFailed'), error: true }),
      );
    return () => {
      ipcRenderer.removeListener(
        'profile-proxy-control-changed',
        onProxyControlChanged,
      );
    };
  }, []);

  const updateProxy = (key: keyof IProxyForm, value: string) => {
    setProxy((current) => ({ ...current, [key]: value }));
    setStatus({ text: '', error: false });
  };

  const updateRouting = <K extends keyof IProxyRoutingSettings>(
    key: K,
    value: IProxyRoutingSettings[K],
  ) => {
    setProxy((current) => ({
      ...current,
      routing: { ...current.routing, [key]: value },
    }));
    setStatus({ text: '', error: false });
  };

  const onUpdateRules = async () => {
    if (busy) return;
    setBusy(true);
    setStatus({ text: t('sysRouteUpdating'), error: false });
    try {
      if (!(await saveCurrentProxy())) return;
      const result = (await ipcRenderer.invoke(
        'profile-proxy-rules-update',
      )) as { ok: boolean; status?: IProxyRuleStatus; message?: string };
      if (result.status) setRuleStatus(result.status);
      setStatus({
        text: result.ok
          ? t('sysRouteUpdateOk')
          : result.message || t('sysRouteUpdateFailed'),
        error: !result.ok,
      });
    } catch {
      setStatus({ text: t('sysRouteUpdateFailed'), error: true });
    } finally {
      setBusy(false);
    }
  };

  const onRouteTest = async () => {
    if (busy || !routeTestInput.trim()) return;
    setBusy(true);
    try {
      if (!(await saveCurrentProxy())) return;
      const result = (await ipcRenderer.invoke(
        'profile-proxy-route-test',
        routeTestInput,
      )) as {
        ok: boolean;
        host?: string;
        action?: 'proxy' | 'direct';
        source?: string;
        rule?: string;
        message?: string;
      };
      if (!result.ok || !result.host || !result.action) {
        setStatus({ text: result.message || t('sysProxyTestFailed'), error: true });
        return;
      }
      const reasonKey =
        result.source === 'local'
          ? 'sysRouteReasonLocal'
          : result.source === 'direct_rule'
          ? 'sysRouteReasonDirectRule'
          : result.source === 'proxy_rule'
          ? 'sysRouteReasonProxyRule'
          : result.source === 'gfwlist'
          ? 'sysRouteReasonGfw'
          : result.source === 'unknown'
          ? 'sysRouteReasonUnknown'
          : 'sysRouteReasonDefault';
      const reason = t(reasonKey as any, { rule: result.rule || '' });
      setStatus({
        text: t(
          result.action === 'proxy'
            ? 'sysRouteTestProxy'
            : 'sysRouteTestDirect',
          { host: result.host, reason },
        ),
        error: false,
      });
    } catch {
      setStatus({ text: t('sysProxyTestFailed'), error: true });
    } finally {
      setBusy(false);
    }
  };

  const saveCurrentProxy = async (): Promise<IProxyControl | false> => {
    const result = (await ipcRenderer.invoke('profile-proxy-save', {
      ...proxy,
      port:
        proxy.mode === 'direct' ||
        proxy.mode === 'system' ||
        proxy.mode === 'pac'
          ? 0
          : Number(proxy.port),
    })) as {
      ok: boolean;
      message?: string;
      proxy?: IProfileProxySettings;
      proxyControl?: IProxyControl;
    };
    if (!result.ok) {
      setStatus({ text: result.message || t('sysProxySaveFailed'), error: true });
      return false;
    }
    if (result.proxy) setProxy(toForm(result.proxy));
    const effectiveControl = result.proxyControl || proxyControl;
    if (result.proxyControl) setProxyControl(result.proxyControl);
    return effectiveControl;
  };

  const onSave = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const effectiveControl = await saveCurrentProxy();
      if (effectiveControl) {
        setStatus({
          text:
            effectiveControl.source === 'extension'
              ? t('sysProxySavedAsFallback')
              : proxy.mode === 'direct'
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

        <ForceProxyOption>
          <input
            type="checkbox"
            checked={proxy.force}
            disabled={busy}
            onChange={(event) => {
              setProxy((current) => ({
                ...current,
                force: event.target.checked,
              }));
              setStatus({ text: '', error: false });
            }}
          />
          <ForceProxyText>
            <ForceProxyTitle>{t('sysProxyForce')}</ForceProxyTitle>
            <SecondaryText>{t('sysProxyForceDesc')}</SecondaryText>
          </ForceProxyText>
        </ForceProxyOption>

        {proxyControl.source === 'extension' && (
          <ProxyControlNotice>
            {t(
              proxyControl.mode === 'system'
                ? 'sysProxyControlledByExtensionSystem'
                : proxyControl.mode === 'direct'
                ? 'sysProxyControlledByExtensionDirect'
                : 'sysProxyControlledByExtension',
              {
                name:
                  proxyControl.extensionName || proxyControl.extensionId || '',
              },
            )}
          </ProxyControlNotice>
        )}

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
          {proxy.mode === 'system' || proxy.mode === 'direct' ? (
            <ProxyHint>
              {t(
                proxy.mode === 'direct'
                  ? 'sysProxyDirectHint'
                  : 'sysProxySystemHint',
              )}
            </ProxyHint>
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
          {proxy.mode !== 'system' && proxy.mode !== 'direct' && (
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
          {proxy.mode === 'http' || proxy.mode === 'socks5' ? (
            <>
              <Field $wide>
                <FieldLabel>{t('sysRouteMode')}</FieldLabel>
                <Select
                  value={proxy.routing.mode}
                  disabled={busy}
                  onChange={(event) =>
                    updateRouting(
                      'mode',
                      event.target.value as IProxyRoutingSettings['mode'],
                    )
                  }
                >
                  <option value="global">{t('sysRouteGlobal')}</option>
                  <option value="proxy_list">{t('sysRouteProxyList')}</option>
                  <option value="direct_list">{t('sysRouteDirectList')}</option>
                  <option value="bypass_mainland">
                    {t('sysRouteBypassMainland')}
                  </option>
                  <option value="proxy_mainland">
                    {t('sysRouteProxyMainland')}
                  </option>
                </Select>
              </Field>
              {proxy.routing.mode === 'proxy_list' ||
              proxy.routing.mode === 'direct_list' ? (
                <Field $wide>
                  <FieldLabel>
                    {t(
                      proxy.routing.mode === 'proxy_list'
                        ? 'sysRouteProxyRules'
                        : 'sysRouteDirectRules',
                    )}
                  </FieldLabel>
                  <Textarea
                    value={
                      proxy.routing.mode === 'proxy_list'
                        ? proxy.routing.proxyRules
                        : proxy.routing.directRules
                    }
                    disabled={busy}
                    placeholder={t('sysRouteRulesPlaceholder')}
                    onChange={(event) =>
                      updateRouting(
                        proxy.routing.mode === 'proxy_list'
                          ? 'proxyRules'
                          : 'directRules',
                        event.target.value,
                      )
                    }
                  />
                </Field>
              ) : (proxy.routing.mode === 'bypass_mainland' ||
                  proxy.routing.mode === 'proxy_mainland') && (
                <RouteRuleGrid>
                  <Field>
                    <FieldLabel>{t('sysRouteProxyRules')}</FieldLabel>
                    <Textarea
                      value={proxy.routing.proxyRules}
                      disabled={busy}
                      placeholder={t('sysRouteRulesPlaceholder')}
                      onChange={(event) =>
                        updateRouting('proxyRules', event.target.value)
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel>{t('sysRouteDirectRules')}</FieldLabel>
                    <Textarea
                      value={proxy.routing.directRules}
                      disabled={busy}
                      placeholder={t('sysRouteRulesPlaceholder')}
                      onChange={(event) =>
                        updateRouting('directRules', event.target.value)
                      }
                    />
                  </Field>
                </RouteRuleGrid>
              )}
              {proxy.routing.mode !== 'global' && (
                <ForceProxyOption>
                  <input
                    type="checkbox"
                    checked={proxy.routing.bypassLocal}
                    disabled={busy}
                    onChange={(event) =>
                      updateRouting('bypassLocal', event.target.checked)
                    }
                  />
                  <ForceProxyText>
                    <ForceProxyTitle>{t('sysRouteBypassLocal')}</ForceProxyTitle>
                  </ForceProxyText>
                </ForceProxyOption>
              )}
              {(proxy.routing.mode === 'bypass_mainland' ||
                proxy.routing.mode === 'proxy_mainland') && (
                <>
                  <Field $wide>
                    <FieldLabel>{t('sysRouteGfwUrl')}</FieldLabel>
                    <Input
                      value={proxy.routing.gfwListUrl}
                      disabled={busy}
                      onChange={(event) =>
                        updateRouting('gfwListUrl', event.target.value)
                      }
                    />
                  </Field>
                  <RouteActions>
                    <SecondaryText>
                      {t('sysRouteDataStatus', {
                        gfw: ruleStatus.gfwRules,
                        ignored: ruleStatus.gfwIgnored,
                        updated: ruleStatus.gfwUpdatedAt
                          ? t('sysRouteUpdatedAt', {
                              time: new Date(ruleStatus.gfwUpdatedAt).toLocaleString(),
                            })
                          : '',
                      })}
                    </SecondaryText>
                    <NormalButton
                      variant="soft"
                      disabled={busy || ruleStatus.updating}
                      onClick={onUpdateRules}
                    >
                      {t('sysRouteUpdate')}
                    </NormalButton>
                  </RouteActions>
                </>
              )}
              <Field $wide>
                <FieldLabel>{t('sysRouteTestLabel')}</FieldLabel>
                <RouteActions>
                  <Input
                    value={routeTestInput}
                    disabled={busy}
                    placeholder={t('sysRouteTestPlaceholder')}
                    onChange={(event) => setRouteTestInput(event.target.value)}
                  />
                  <NormalButton
                    variant="soft"
                    disabled={busy || !routeTestInput.trim()}
                    onClick={onRouteTest}
                  >
                    {t('sysRouteTestButton')}
                  </NormalButton>
                </RouteActions>
              </Field>
            </>
          ) : null}
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
