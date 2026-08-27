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
  title: string;
  description: string;
}

const RULE_DEFINITIONS: RuleDefinition[] = [
  {
    id: 'external-navigation',
    permission: EXTERNAL_NAVIGATION_PERMISSION,
    mediaTypes: '',
    kind: 'external-navigation',
    title: '外链跳转',
    description: '控制此网站跳转到其他主域时是否需要确认。',
  },
  {
    id: 'all-links',
    permission: OPEN_LINKS_IN_NEW_PAGE_PERMISSION,
    mediaTypes: '',
    kind: 'links',
    title: '所有跳转在新页面打开',
    description: '拦截站内链接和表单，让普通页面跳转改为在新标签页打开。',
  },
  {
    id: 'popup-window',
    permission: OPEN_POPUPS_IN_NEW_TAB_PERMISSION,
    mediaTypes: '',
    kind: 'popup',
    title: '弹窗在新标签页打开',
    description: '仅处理网站通过 window.open 等方式请求的独立窗口。',
  },
  {
    id: 'notifications',
    permission: 'notifications',
    mediaTypes: '',
    kind: 'permission',
    title: '通知',
    description: '允许网站发送系统通知。',
  },
  {
    id: 'geolocation',
    permission: 'geolocation',
    mediaTypes: '',
    kind: 'permission',
    title: '位置信息',
    description: '允许网站获取当前位置。',
  },
  {
    id: 'microphone',
    permission: 'media',
    mediaTypes: JSON.stringify(['audio']),
    kind: 'permission',
    title: '麦克风',
    description: '允许网站采集麦克风音频。',
  },
  {
    id: 'camera',
    permission: 'media',
    mediaTypes: JSON.stringify(['video']),
    kind: 'permission',
    title: '摄像头',
    description: '允许网站使用摄像头画面。',
  },
  {
    id: 'sensors',
    permission: 'sensors',
    mediaTypes: '',
    kind: 'permission',
    title: '运动与方向传感器',
    description: '允许网站读取设备运动与方向信息。',
  },
  {
    id: 'screen-wake-lock',
    permission: 'screen-wake-lock',
    mediaTypes: '',
    kind: 'permission',
    title: '保持屏幕常亮',
    description: '允许网站阻止屏幕自动休眠。',
  },
  {
    id: 'open-external',
    permission: 'openExternal',
    mediaTypes: '',
    kind: 'permission',
    title: '打开外部链接',
    description: '允许网站唤起系统应用或其他外部协议。',
  },
  {
    id: 'ignore-certificate-errors',
    permission: IGNORE_CERTIFICATE_ERRORS_PERMISSION,
    mediaTypes: '',
    kind: 'permission',
    title: '忽略证书错误',
    description: '允许访问此站点时跳过证书校验错误。请仅为信任的站点启用。',
  },
  {
    id: 'selection-panel',
    permission: SELECTION_PANEL_PERMISSION,
    mediaTypes: '',
    kind: 'selection',
    title: '文本选择面板',
    description: '控制在此网站选中文本后是否显示操作面板。',
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

const optionsFor = (kind: RuleKind) => {
  if (kind === 'external-navigation') {
    return [
      { value: 'default', label: '默认（允许）' },
      { value: 'allow', label: '允许' },
      { value: 'ask', label: '询问' },
      { value: 'deny', label: '拒绝' },
    ];
  }
  if (kind === 'links') {
    return [
      { value: 'default', label: '默认' },
      { value: 'allow', label: '新页面打开' },
      { value: 'deny', label: '当前页面打开' },
    ];
  }
  if (kind === 'popup') {
    return [
      { value: 'default', label: '跟随全局' },
      { value: 'allow', label: '新标签页' },
      { value: 'deny', label: '独立窗口' },
    ];
  }
  if (kind === 'selection') {
    return [
      { value: 'default', label: '默认' },
      { value: 'allow', label: '显示' },
      { value: 'deny', label: '隐藏' },
    ];
  }
  return [
    { value: 'default', label: '使用默认设置' },
    { value: 'allow', label: '允许' },
    { value: 'deny', label: '拒绝' },
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

export const Permissions = observer(() => {
  const [list, setList] = React.useState<IPermissionRecord[]>([]);
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
    const res = await ipcRenderer.invoke('storage-get', {
      scope: 'permissions',
      query: {},
    });
    setList(Array.isArray(res) ? res : []);
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const domains = React.useMemo(() => {
    const grouped = new Map<string, IPermissionRecord[]>();
    for (const item of list) {
      const host = recordHost(item);
      if (!host) continue;
      const records = grouped.get(host) || [];
      records.push(item);
      grouped.set(host, records);
    }
    return [...grouped.entries()].sort(([a], [b]) =>
      a.localeCompare(b, 'zh-CN'),
    );
  }, [list]);

  const siteRecords = React.useMemo(
    () => list.filter((item) => recordHost(item) === selectedHost),
    [list, selectedHost],
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
      setFormError('请输入有效的网站域名或网址');
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
      ipcRenderer.send('selection-panel-rule-updated', selectedHost, false);
      await load();
      setSelectedHost('');
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
            title="返回网站列表"
            onClick={() => setSelectedHost('')}
          >
            <ArrowLeft size={18} weight="bold" />
          </IconButton>
          <DetailTitle theme={store.theme}>{selectedHost}</DetailTitle>
          <DangerButton
            theme={store.theme}
            disabled={siteRecords.length === 0 || busyId !== ''}
            onClick={onDeleteSite}
          >
            删除此网站设置
          </DangerButton>
        </DetailHeader>
        <Intro>
          <SecondaryText>
            分别配置页面跳转、窗口弹出和网站能力。未设置的项目使用全局或浏览器默认行为。
          </SecondaryText>
        </Intro>

        <Card theme={store.theme}>
          <RuleList>
            {RULE_DEFINITIONS.map((definition) => {
              const record = siteRecords.find((item) =>
                matchesDefinition(item, definition),
              );
              return (
                <RuleRow key={definition.id} theme={store.theme}>
                  <RuleMain>
                    <RuleTitle theme={store.theme}>
                      {definition.title}
                    </RuleTitle>
                    <RuleDescription theme={store.theme}>
                      {definition.description}
                    </RuleDescription>
                  </RuleMain>
                  <RuleSelect
                    theme={store.theme}
                    value={ruleValue(record)}
                    disabled={busyId !== ''}
                    aria-label={`${definition.title}设置`}
                    onChange={(event) =>
                      onSetRule(definition, event.target.value as RuleValue)
                    }
                  >
                    {optionsFor(definition.kind).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
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
                    该权限由网站请求后保存，可恢复为默认设置。
                  </RuleDescription>
                </RuleMain>
                <RuleSelect
                  theme={store.theme}
                  value={ruleValue(item)}
                  disabled={busyId !== ''}
                  aria-label={`${getPermissionText(item.permission)}设置`}
                  onChange={(event) =>
                    onSetUnknownRule(item, event.target.value as RuleValue)
                  }
                >
                  {optionsFor('permission').map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </RuleSelect>
              </RuleRow>
            ))}
          </RuleList>
        </Card>
      </Wrapper>
    );
  }

  return (
    <Wrapper>
      <SectionTitle theme={store.theme}>全局设置</SectionTitle>
      <Card theme={store.theme}>
        <SettingRow onClick={onToggleGlobal}>
          <SettingIcon tone="orange">
            <ArrowSquareOut size={19} weight="fill" />
          </SettingIcon>
          <SettingMain>
            <SettingTitle theme={store.theme}>弹窗在新标签页打开</SettingTitle>
            <SettingDescription theme={store.theme}>
              仅拦截网站通过 window.open
              等方式请求的独立窗口，不改变普通页面跳转。
            </SettingDescription>
          </SettingMain>
          <Switch value={store.settings.openPopupsInNewTab} />
        </SettingRow>
      </Card>

      <Section>
        <SectionHeader>
          <SectionTitle theme={store.theme}>网站权限</SectionTitle>
          <TextButton
            type="button"
            onClick={() => {
              setAddVisible(!addVisible);
              setFormError('');
            }}
          >
            <Plus size={15} weight="bold" />
            添加权限
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
                  placeholder="输入域名或网址，例如 example.com"
                  aria-label="网站域名或网址"
                  onChange={(event) => {
                    setWebsite(event.target.value);
                    setFormError('');
                  }}
                />
                <TextButton type="submit" disabled={!website.trim()}>
                  继续
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
                  取消
                </QuietButton>
              </AddForm>
              {formError ? (
                <FormError theme={store.theme}>{formError}</FormError>
              ) : null}
            </>
          ) : null}

          {domains.length === 0 ? (
            <Empty theme={store.theme}>还没有单独配置的网站</Empty>
          ) : (
            <SiteList>
              {domains.map(([host, records]) => (
                <SiteEntry
                  key={host}
                  theme={store.theme}
                  onClick={() => setSelectedHost(host)}
                >
                  <SiteMain>
                    <SiteName>{host}</SiteName>
                    <SiteMeta theme={store.theme}>
                      已配置 {records.length} 项权限
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
