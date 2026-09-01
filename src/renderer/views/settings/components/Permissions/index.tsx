import * as React from 'react';
import { observer } from 'mobx-react-lite';
import styled, { css } from 'styled-components';
import {
  ArrowLeft,
  ArrowSquareOut,
  CaretRight,
  Plus,
} from '@phosphor-icons/react';

import { Header, SecondaryText, SettingIcon } from '../App/style';
import store from '../../store';
import { ipcRenderer } from '~/common/renderer-ipc';
import { getSettingsTranslator } from '../../utils';
import type { MessageKey, Translator } from '~/common/i18n';
import { IPermissionRecord, ITheme } from '~/interfaces';
import {
  getDomain,
  getPermissionText,
  EXTERNAL_NAVIGATION_PERMISSION,
  IGNORE_CERTIFICATE_ERRORS_PERMISSION,
  OPEN_LINKS_IN_NEW_PAGE_PERMISSION,
  OPEN_POPUPS_IN_NEW_TAB_PERMISSION,
  SELECTION_PANEL_PERMISSION,
} from '~/utils';
import { Switch } from '~/renderer/components/Switch';
import { getPalette } from '../../utils/palette';

const Wrapper = styled.div`
  margin-top: 6px;
`;

const Intro = styled.div`
  margin-bottom: 18px;
`;

const Section = styled.section`
  margin-top: 24px;
`;

const SectionHeader = styled.div`
  min-height: 36px;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const SectionTitle = styled.div`
  padding: 0 4px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const Card = styled.div`
  border-radius: 20px;
  padding: 18px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      box-shadow: inset 0 0 0 1px ${p.line},
        0 10px 26px -24px rgba(40, 60, 120, 0.28);
    `;
  }}
`;

const SettingRow = styled.div`
  min-height: 54px;
  display: flex;
  align-items: center;
  gap: 18px;
  cursor: pointer;
`;

const SettingMain = styled.div`
  min-width: 0;
  flex: 1;
`;

const SettingTitle = styled.div`
  font-size: 14.5px;
  font-weight: 600;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

const SettingDescription = styled.div`
  margin-top: 2px;
  font-size: 12.5px;
  line-height: 1.5;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const TextButton = styled.button`
  height: 34px;
  border: none;
  border-radius: 10px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${p.surface};
      border: 1px solid ${p.line};
      &:hover {
        color: ${p.primary};
        border-color: ${p.primary};
      }
    `;
  }}

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`;

const QuietButton = styled.button`
  min-height: 34px;
  border: none;
  border-radius: 10px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: transparent;
  font: inherit;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textSub};

      &:hover {
        color: ${p.textMain};
        background-color: ${p.bg};
      }
    `;
  }}
`;

const DangerButton = styled(QuietButton)`
  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.danger};

      &:hover {
        color: ${p.danger};
        background-color: ${p.danger}12;
      }

      &:disabled {
        opacity: 0.5;
        cursor: default;
      }
    `;
  }}
`;

const AddForm = styled.form`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;

  @media (max-width: 700px) {
    align-items: stretch;
    flex-direction: column;
  }
`;

const WebsiteInput = styled.input`
  min-width: 0;
  flex: 1;
  height: 40px;
  border: none;
  border-radius: 12px;
  padding: 0 13px;
  outline: none;
  font: inherit;
  font-size: 13px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${p.bg};
      box-shadow: inset 0 0 0 1px ${p.line};

      &:focus {
        box-shadow: inset 0 0 0 2px #4b7cff;
      }

      &::placeholder {
        color: ${p.textMute};
      }
    `;
  }}
`;

const FormError = styled.div`
  margin: -4px 0 14px;
  font-size: 12px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).danger};
  `}
`;

const SiteList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const SiteEntry = styled.button`
  width: 100%;
  min-height: 66px;
  border: none;
  border-radius: 16px;
  padding: 12px 14px 12px 16px;
  display: flex;
  align-items: center;
  gap: 14px;
  text-align: left;
  font: inherit;
  cursor: pointer;
  transition: transform 0.16s ease, box-shadow 0.16s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${p.bg};
      box-shadow: inset 0 0 0 1px ${p.line};

      &:hover {
        transform: translateY(-1px);
        box-shadow: inset 0 0 0 1px ${p.primary}4d;
      }
    `;
  }}
`;

const SiteMain = styled.div`
  min-width: 0;
  flex: 1;
`;

const SiteName = styled.div`
  font-size: 14px;
  font-weight: 800;
  overflow-wrap: anywhere;
`;

const SiteMeta = styled.div`
  margin-top: 5px;
  font-size: 12px;
  line-height: 1.4;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const DetailHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
`;

const IconButton = styled.button`
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  border: none;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textSub};
      background-color: ${p.bg};

      &:hover {
        color: ${p.textMain};
      }
    `;
  }}
`;

const DetailTitle = styled.div`
  min-width: 0;
  flex: 1;
  font-size: 19px;
  font-weight: 900;
  overflow-wrap: anywhere;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

const RuleList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const RuleRow = styled.div`
  min-height: 64px;
  padding: 12px 14px 12px 16px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  gap: 16px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.bg};
      box-shadow: inset 0 0 0 1px ${p.line};
    `;
  }}

  @media (max-width: 700px) {
    align-items: stretch;
    flex-direction: column;
  }
`;

const RuleMain = styled.div`
  min-width: 0;
  flex: 1;
`;

const RuleTitle = styled.div`
  font-size: 14px;
  font-weight: 800;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

const RuleDescription = styled.div`
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.45;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const RuleSelect = styled.select`
  width: 142px;
  height: 38px;
  flex: 0 0 142px;
  border: none;
  border-radius: 11px;
  padding: 0 32px 0 11px;
  outline: none;
  font: inherit;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${p.surface};
      box-shadow: inset 0 0 0 1px ${p.line};
    `;
  }}

  @media (max-width: 700px) {
    width: 100%;
    flex-basis: 38px;
  }
`;

const Empty = styled.div`
  padding: 26px 18px;
  text-align: center;
  border-radius: 16px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMute};
      background-color: ${p.bg};
      box-shadow: inset 0 0 0 1px ${p.line};
    `;
  }}
`;

type RuleKind =
  | 'links'
  | 'popup'
  | 'external-navigation'
  | 'permission'
  | 'selection';
type RuleValue = 'default' | 'allow' | 'ask' | 'deny';

interface RuleDefinition {
  id: string;
  permission: string;
  mediaTypes: string;
  kind: RuleKind;
  titleKey: MessageKey;
  descriptionKey: MessageKey;
}

const RULE_DEFINITIONS: RuleDefinition[] = [
  {
    id: 'external-navigation',
    permission: EXTERNAL_NAVIGATION_PERMISSION,
    mediaTypes: '',
    kind: 'external-navigation',
    titleKey: 'permExtNav',
    descriptionKey: 'permExtNavDesc',
  },
  {
    id: 'all-links',
    permission: OPEN_LINKS_IN_NEW_PAGE_PERMISSION,
    mediaTypes: '',
    kind: 'links',
    titleKey: 'searchLinksNewPage',
    descriptionKey: 'permLinksDesc',
  },
  {
    id: 'popup-window',
    permission: OPEN_POPUPS_IN_NEW_TAB_PERMISSION,
    mediaTypes: '',
    kind: 'popup',
    titleKey: 'searchPopupNewTab',
    descriptionKey: 'permPopupDesc',
  },
  {
    id: 'notifications',
    permission: 'notifications',
    mediaTypes: '',
    kind: 'permission',
    titleKey: 'permNotifications',
    descriptionKey: 'permNotificationsDesc',
  },
  {
    id: 'geolocation',
    permission: 'geolocation',
    mediaTypes: '',
    kind: 'permission',
    titleKey: 'permGeolocation',
    descriptionKey: 'permGeolocationDesc',
  },
  {
    id: 'microphone',
    permission: 'media',
    mediaTypes: JSON.stringify(['audio']),
    kind: 'permission',
    titleKey: 'permMicrophone',
    descriptionKey: 'permMicrophoneDesc',
  },
  {
    id: 'camera',
    permission: 'media',
    mediaTypes: JSON.stringify(['video']),
    kind: 'permission',
    titleKey: 'permCamera',
    descriptionKey: 'permCameraDesc',
  },
  {
    id: 'sensors',
    permission: 'sensors',
    mediaTypes: '',
    kind: 'permission',
    titleKey: 'permSensors',
    descriptionKey: 'permSensorsDesc',
  },
  {
    id: 'screen-wake-lock',
    permission: 'screen-wake-lock',
    mediaTypes: '',
    kind: 'permission',
    titleKey: 'permWakeLock',
    descriptionKey: 'permWakeLockDesc',
  },
  {
    id: 'open-external',
    permission: 'openExternal',
    mediaTypes: '',
    kind: 'permission',
    titleKey: 'permOpenExternal',
    descriptionKey: 'permOpenExternalDesc',
  },
  {
    id: 'ignore-certificate-errors',
    permission: IGNORE_CERTIFICATE_ERRORS_PERMISSION,
    mediaTypes: '',
    kind: 'permission',
    titleKey: 'permIgnoreCert',
    descriptionKey: 'permIgnoreCertDesc',
  },
  {
    id: 'selection-panel',
    permission: SELECTION_PANEL_PERMISSION,
    mediaTypes: '',
    kind: 'selection',
    titleKey: 'permSelectionPanel',
    descriptionKey: 'permSelectionPanelDesc',
  },
];

const normalizeWebsite = (value: string) => {
  const input = value.trim();
  if (!input) return '';

  try {
    const parsed = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`,
    );
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.hostname.toLowerCase();
  } catch {
    return '';
  }
};

const recordHost = (item: IPermissionRecord) =>
  getDomain(item.url).trim().toLowerCase();

const mediaTypesOf = (item: IPermissionRecord): string[] => {
  try {
    const value = JSON.parse(item.mediaTypes || '');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

const matchesDefinition = (
  item: IPermissionRecord,
  definition: RuleDefinition,
) => {
  if (item.permission !== definition.permission) return false;
  if (item.permission !== 'media') {
    return (item.mediaTypes || '') === definition.mediaTypes;
  }
  if ((item.mediaTypes || '') === definition.mediaTypes) return true;

  const targetType = JSON.parse(definition.mediaTypes)[0];
  return (
    mediaTypesOf(item).length > 1 && mediaTypesOf(item).includes(targetType)
  );
};

const isKnownRecord = (item: IPermissionRecord) =>
  RULE_DEFINITIONS.some((definition) => matchesDefinition(item, definition));

const ruleValue = (record?: IPermissionRecord): RuleValue => {
  if (!record) return 'default';
  return record.type === 1 ? 'allow' : record.type === 3 ? 'ask' : 'deny';
};

interface RuleOption {
  value: RuleValue;
  labelKey: MessageKey;
}

const optionsFor = (kind: RuleKind): RuleOption[] => {
  if (kind === 'external-navigation') {
    return [
      { value: 'default', labelKey: 'permOptDefaultAllow' },
      { value: 'allow', labelKey: 'permOptAllow' },
      { value: 'ask', labelKey: 'permOptAsk' },
      { value: 'deny', labelKey: 'permOptDeny' },
    ];
  }
  if (kind === 'links') {
    return [
      { value: 'default', labelKey: 'permOptDefault' },
      { value: 'allow', labelKey: 'permOptNewPage' },
      { value: 'deny', labelKey: 'permOptSamePage' },
    ];
  }
  if (kind === 'popup') {
    return [
      { value: 'default', labelKey: 'permOptFollowGlobal' },
      { value: 'allow', labelKey: 'permOptNewTab' },
      { value: 'deny', labelKey: 'permOptWindow' },
    ];
  }
  if (kind === 'selection') {
    return [
      { value: 'default', labelKey: 'permOptDefault' },
      { value: 'allow', labelKey: 'show' },
      { value: 'deny', labelKey: 'hide' },
    ];
  }
  return [
    { value: 'default', labelKey: 'permOptUseDefault' },
    { value: 'allow', labelKey: 'permOptAllow' },
    { value: 'deny', labelKey: 'permOptDeny' },
  ];
};

const recordQuery = (item: IPermissionRecord) =>
  item._id
    ? { _id: item._id }
    : {
        url: item.url,
        permission: item.permission,
        mediaTypes: item.mediaTypes || '',
      };

interface IDevicePermissionRecord {
  id: string;
  origin: string;
  deviceType: 'hid' | 'usb' | 'serial';
  name: string;
}

const deviceRecordHost = (item: IDevicePermissionRecord) => {
  if (item.origin === 'file://') return 'file://';
  try { return normalizeWebsite(new URL(item.origin).hostname); } catch { return ''; }
};

const deviceTypeKey = (
  deviceType: IDevicePermissionRecord['deviceType'],
): MessageKey =>
  deviceType === 'usb'
    ? 'permDeviceUsb'
    : deviceType === 'serial'
    ? 'permDeviceSerial'
    : 'permDeviceHid';

const deviceTypeText = (
  deviceType: IDevicePermissionRecord['deviceType'],
  t: Translator,
) => t(deviceTypeKey(deviceType));

export const Permissions = observer(() => {
  const t = getSettingsTranslator();
  const [list, setList] = React.useState<IPermissionRecord[]>([]);
  const [devicePermissions, setDevicePermissions] = React.useState<IDevicePermissionRecord[]>([]);
  const [selectedHost, setSelectedHost] = React.useState(() =>
    normalizeWebsite(
      new URLSearchParams(window.location.search).get('site') || '',
    ),
  );
  const [addVisible, setAddVisible] = React.useState(false);
  const [website, setWebsite] = React.useState('');
  const [formError, setFormError] = React.useState('');
  const [busyId, setBusyId] = React.useState('');

  const load = React.useCallback(async () => {
    const [res, devices] = await Promise.all([
      ipcRenderer.invoke('storage-get', {scope: 'permissions', query: {}}),
      ipcRenderer.invoke('device-permissions-list'),
    ]);
    setList(Array.isArray(res) ? res : []);
    setDevicePermissions(Array.isArray(devices) ? devices : []);
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const domains = React.useMemo(() => {
    const grouped = new Map<string, number>();
    for (const item of list) {
      const host = recordHost(item);
      if (!host) continue;
      grouped.set(host, (grouped.get(host) || 0) + 1);
    }
    for (const item of devicePermissions) {
      const host = deviceRecordHost(item);
      if (!host) continue;
      grouped.set(host, (grouped.get(host) || 0) + 1);
    }
    return [...grouped.entries()].sort(([a], [b]) =>
      a.localeCompare(b, 'zh-CN'),
    );
  }, [list, devicePermissions]);

  const siteRecords = React.useMemo(
    () => list.filter((item) => recordHost(item) === selectedHost),
    [list, selectedHost],
  );
  const siteDevicePermissions = React.useMemo(
    () => devicePermissions.filter((item) => deviceRecordHost(item) === selectedHost),
    [devicePermissions, selectedHost],
  );

  const removeRecords = async (records: IPermissionRecord[]) => {
    await Promise.all(
      records.map((item) =>
        ipcRenderer.invoke('storage-remove', {
          scope: 'permissions',
          query: recordQuery(item),
        }),
      ),
    );
  };

  const onToggleGlobal = () => {
    store.settings.openPopupsInNewTab = !store.settings.openPopupsInNewTab;
    store.save();
  };

  const onAddWebsite = (event: React.FormEvent) => {
    event.preventDefault();
    const host = normalizeWebsite(website);
    if (!host) {
      setFormError(t('permSiteInvalid'));
      return;
    }
    setSelectedHost(host);
    setWebsite('');
    setFormError('');
    setAddVisible(false);
  };

  const onSetRule = async (definition: RuleDefinition, value: RuleValue) => {
    setBusyId(definition.id);
    try {
      const related = siteRecords.filter((item) =>
        matchesDefinition(item, definition),
      );
      const exact = related.find(
        (item) => (item.mediaTypes || '') === definition.mediaTypes,
      );
      const type = value === 'allow' ? 1 : value === 'ask' ? 3 : 2;

      if (value === 'default') {
        await removeRecords(related);
      } else if (exact) {
        await ipcRenderer.invoke('storage-update', {
          scope: 'permissions',
          query: recordQuery(exact),
          value: {
            url: selectedHost,
            type,
            mediaTypes: definition.mediaTypes,
          },
        });
        await removeRecords(related.filter((item) => item !== exact));
      } else {
        await removeRecords(related);
        await ipcRenderer.invoke('storage-insert', {
          scope: 'permissions',
          item: {
            url: selectedHost,
            permission: definition.permission,
            type,
            mediaTypes: definition.mediaTypes,
          },
        });
      }

      if (definition.permission === SELECTION_PANEL_PERMISSION) {
        ipcRenderer.send(
          'selection-panel-rule-updated',
          selectedHost,
          value === 'deny',
        );
      }
      await load();
    } finally {
      setBusyId('');
    }
  };

  const onSetUnknownRule = async (
    item: IPermissionRecord,
    value: RuleValue,
  ) => {
    setBusyId(item._id || `${item.permission}-${item.mediaTypes}`);
    try {
      if (value === 'default') {
        await removeRecords([item]);
      } else {
        await ipcRenderer.invoke('storage-update', {
          scope: 'permissions',
          query: recordQuery(item),
          value: {
            url: selectedHost,
            type: value === 'allow' ? 1 : 2,
          },
        });
      }
      await load();
    } finally {
      setBusyId('');
    }
  };

  const onDeleteSite = async () => {
    setBusyId('__delete-site__');
    try {
      await removeRecords(siteRecords);
      await ipcRenderer.invoke('device-permissions-revoke-site', selectedHost);
      ipcRenderer.send('selection-panel-rule-updated', selectedHost, false);
      await load();
      setSelectedHost('');
    } finally {
      setBusyId('');
    }
  };

  const onRemoveDevicePermission = async (item: IDevicePermissionRecord) => {
    setBusyId(item.id);
    try {
      await ipcRenderer.invoke('device-permission-revoke', item.id);
      await load();
    } finally {
      setBusyId('');
    }
  };

  if (selectedHost) {
    const unknownRecords = siteRecords.filter((item) => !isKnownRecord(item));

    return (
      <Wrapper>
        <DetailHeader>
          <IconButton
            theme={store.theme}
            title={t('permBackToSites')}
            onClick={() => setSelectedHost('')}
          >
            <ArrowLeft size={18} weight="bold" />
          </IconButton>
          <DetailTitle theme={store.theme}>{selectedHost}</DetailTitle>
          <DangerButton
            theme={store.theme}
            disabled={(siteRecords.length === 0 && siteDevicePermissions.length === 0) || busyId !== ''}
            onClick={onDeleteSite}
          >
            {t('permDeleteSite')}
          </DangerButton>
        </DetailHeader>
        <Intro>
          <SecondaryText>{t('permDetailIntro')}</SecondaryText>
        </Intro>

        <Card theme={store.theme}>
          <RuleList>
            {RULE_DEFINITIONS.map((definition) => {
              const record = siteRecords.find((item) =>
                matchesDefinition(item, definition),
              );
              const ruleTitle = t(definition.titleKey);
              return (
                <RuleRow key={definition.id} theme={store.theme}>
                  <RuleMain>
                    <RuleTitle theme={store.theme}>{ruleTitle}</RuleTitle>
                    <RuleDescription theme={store.theme}>
                      {t(definition.descriptionKey)}
                    </RuleDescription>
                  </RuleMain>
                  <RuleSelect
                    theme={store.theme}
                    value={ruleValue(record)}
                    disabled={busyId !== ''}
                    aria-label={t('permRuleAria', { rule: ruleTitle })}
                    onChange={(event) =>
                      onSetRule(definition, event.target.value as RuleValue)
                    }
                  >
                    {optionsFor(definition.kind).map((option) => (
                      <option key={option.value} value={option.value}>
                        {t(option.labelKey)}
                      </option>
                    ))}
                  </RuleSelect>
                </RuleRow>
              );
            })}

            {unknownRecords.map((item) => (
              <RuleRow
                key={item._id || `${item.permission}-${item.mediaTypes}`}
                theme={store.theme}
              >
                <RuleMain>
                  <RuleTitle theme={store.theme}>
                    {getPermissionText(item.permission)}
                  </RuleTitle>
                  <RuleDescription theme={store.theme}>
                    {t('permUnknownDesc')}
                  </RuleDescription>
                </RuleMain>
                <RuleSelect
                  theme={store.theme}
                  value={ruleValue(item)}
                  disabled={busyId !== ''}
                  aria-label={t('permRuleAria', {
                    rule: getPermissionText(item.permission),
                  })}
                  onChange={(event) =>
                    onSetUnknownRule(item, event.target.value as RuleValue)
                  }
                >
                  {optionsFor('permission').map((option) => (
                    <option key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </option>
                  ))}
                </RuleSelect>
              </RuleRow>
            ))}

            {siteDevicePermissions.map((item) => (
              <RuleRow key={item.id} theme={store.theme}>
                <RuleMain>
                  <RuleTitle theme={store.theme}>
                    {item.name || deviceTypeText(item.deviceType, t)}
                  </RuleTitle>
                  <RuleDescription theme={store.theme}>
                    {t('permDeviceAllowed', {
                      device: deviceTypeText(item.deviceType, t),
                    })}
                  </RuleDescription>
                </RuleMain>
                <DangerButton
                  type="button"
                  theme={store.theme}
                  disabled={busyId !== ''}
                  onClick={() => onRemoveDevicePermission(item)}
                >
                  {t('remove')}
                </DangerButton>
              </RuleRow>
            ))}
          </RuleList>
        </Card>
      </Wrapper>
    );
  }

  return (
    <Wrapper>
      <SectionTitle theme={store.theme}>{t('permGlobalSection')}</SectionTitle>
      <Card theme={store.theme}>
        <SettingRow onClick={onToggleGlobal}>
          <SettingIcon tone="orange">
            <ArrowSquareOut size={19} weight="fill" />
          </SettingIcon>
          <SettingMain>
            <SettingTitle theme={store.theme}>
              {t('searchPopupNewTab')}
            </SettingTitle>
            <SettingDescription theme={store.theme}>
              {t('permGlobalPopupDesc')}
            </SettingDescription>
          </SettingMain>
          <Switch value={store.settings.openPopupsInNewTab} />
        </SettingRow>
      </Card>

      <Section>
        <SectionHeader>
          <SectionTitle theme={store.theme}>
            {t('searchSitePermissions')}
          </SectionTitle>
          <TextButton
            type="button"
            onClick={() => {
              setAddVisible(!addVisible);
              setFormError('');
            }}
          >
            <Plus size={15} weight="bold" />
            {t('permAddPermission')}
          </TextButton>
        </SectionHeader>
        <Card theme={store.theme}>
          {addVisible ? (
            <>
              <AddForm onSubmit={onAddWebsite}>
                <WebsiteInput
                  autoFocus
                  theme={store.theme}
                  value={website}
                  placeholder={t('permSiteInputPlaceholder')}
                  aria-label={t('permSiteInputAria')}
                  onChange={(event) => {
                    setWebsite(event.target.value);
                    setFormError('');
                  }}
                />
                <TextButton type="submit" disabled={!website.trim()}>
                  {t('permContinue')}
                </TextButton>
                <QuietButton
                  type="button"
                  theme={store.theme}
                  onClick={() => {
                    setAddVisible(false);
                    setWebsite('');
                    setFormError('');
                  }}
                >
                  {t('cancel')}
                </QuietButton>
              </AddForm>
              {formError ? (
                <FormError theme={store.theme}>{formError}</FormError>
              ) : null}
            </>
          ) : null}

          {domains.length === 0 ? (
            <Empty theme={store.theme}>{t('permNoSites')}</Empty>
          ) : (
            <SiteList>
              {domains.map(([host, recordCount]) => (
                <SiteEntry
                  key={host}
                  theme={store.theme}
                  onClick={() => setSelectedHost(host)}
                >
                  <SiteMain>
                    <SiteName>{host}</SiteName>
                    <SiteMeta theme={store.theme}>
                      {t('permSiteMeta', { count: recordCount })}
                    </SiteMeta>
                  </SiteMain>
                  <CaretRight size={18} weight="bold" />
                </SiteEntry>
              ))}
            </SiteList>
          )}
        </Card>
      </Section>
    </Wrapper>
  );
});
