import * as React from 'react';
import {
  Broom,
  ClockCounterClockwise,
  Cookie,
  EyeSlash,
  Plus,
  SignIn,
  Trash,
} from '@phosphor-icons/react';
import styled, { css, keyframes } from 'styled-components';

import {
  Row,
  Title,
  Control,
  SecondaryText,
  SettingCopy,
  SettingGroup,
  SettingGroupBlock,
  SettingGroupLabel,
  SettingIcon,
} from '../App/style';
import store from '../../store';
import { observer } from 'mobx-react-lite';
import { onSwitchChange, saveWebBrowsingSettings } from '../../utils';
import { Switch } from '~/renderer/components/Switch';
import { NormalButton } from '~/renderer/views/settings/components/App';
import { ITheme } from '~/interfaces';
import { getPalette } from '../../utils/palette';
// 两个清理对话框物理上仍位于 Privacy/ 目录(历史原因),此处跨目录复用。
// 后续如需整理可整体迁移到 WebBrowsing/,但需同步改动其内部 import 路径。
import BrowsingDataDialog from '../Privacy/BrowsingDataDialog';
import ClearOnExitDialog from '../Privacy/ClearOnExitDialog';

const onClearBrowsingData = () => {
  store.dialogContent = 'browsing-data';
};

const onClearOnExit = () => {
  store.dialogContent = 'clear-on-exit';
};

// 「退出时自动清理」勾选项摘要:展示当前会清理哪些项(无勾选时显示「已关闭」)。
const clearOnExitSummary = (coe?: {
  cache: boolean;
  cookies: boolean;
  history: boolean;
  searchHistory: boolean;
}) => {
  if (!coe) return '已关闭';
  const labels: string[] = [];
  if (coe.cache) labels.push('缓存');
  if (coe.cookies) labels.push('Cookie');
  if (coe.history) labels.push('历史');
  if (coe.searchHistory) labels.push('搜索历史');
  return labels.length === 0 ? '已关闭' : `将清理:${labels.join('、')}`;
};

const DoNotTrackToggle = observer(() => {
  const { doNotTrack } = store.settings;

  return (
    <Row onClick={onSwitchChange('doNotTrack')}>
      <SettingIcon tone="cyan">
        <EyeSlash size={19} weight="fill" />
      </SettingIcon>
      <SettingCopy>
        <Title>发送“不跟踪”请求</Title>
      </SettingCopy>
      <Control>
        <Switch value={doNotTrack} />
      </Control>
    </Row>
  );
});

const IncognitoThirdPartyCookieToggle = observer(() => {
  const { incognitoBlockThirdPartyCookies } = store.settings;

  return (
    <Row onClick={onSwitchChange('incognitoBlockThirdPartyCookies')}>
      <SettingIcon tone="blue">
        <Cookie size={19} weight="fill" />
      </SettingIcon>
      <SettingCopy>
        <Title>无痕模式下阻止第三方 Cookie</Title>
      </SettingCopy>
      <Control>
        <Switch value={incognitoBlockThirdPartyCookies} />
      </Control>
    </Row>
  );
});

const PersistCookieHosts = styled.div`
  padding: 14px 18px 16px 70px;
  border-top: 1px solid
    ${({ theme }: { theme?: ITheme }) => getPalette(theme).line};
`;

const PersistCookieHostForm = styled.form`
  display: flex;
  gap: 8px;
`;

const PersistCookieHostInput = styled.input`
  min-width: 0;
  flex: 1;
  height: 34px;
  padding: 0 10px;
  border: 1px solid rgba(120, 130, 150, 0.35);
  border-radius: 6px;
  outline: none;
  font: inherit;
  font-size: 13px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${p.bg};
      border-color: ${p.line};

      &::placeholder {
        color: ${p.textMute};
      }

      &:focus {
        border-color: ${p.primary};
        box-shadow: 0 0 0 2px ${p.primary}29;
      }
    `;
  }}
`;

const PersistCookieHostIconButton = styled.button`
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: #ffffff;
      background: ${p.primary};

      &:hover {
        filter: brightness(0.92);
      }

      &:focus-visible {
        outline: 2px solid ${p.primary}66;
        outline-offset: 2px;
      }
    `;
  }}
`;

const PersistCookieHostList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 10px;
`;

const PersistCookieHostChip = styled.div`
  height: 30px;
  padding-left: 9px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid rgba(120, 130, 150, 0.25);
  border-radius: 6px;
  font-size: 12.5px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${p.bg};
      border-color: ${p.line};
    `;
  }}
`;

const PersistCookieHostRemoveButton = styled.button`
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  cursor: pointer;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.danger};

      &:hover {
        background: ${p.danger}1f;
      }
    `;
  }}
`;

const PersistCookieHostHint = styled.div<{error?: boolean}>`
  margin-top: 7px;
  font-size: 12px;
  color: ${({ error, theme }: { error?: boolean; theme?: ITheme }) => {
    const p = getPalette(theme);
    return error ? p.danger : p.textSub;
  }};
`;

const highlightPersistSetting = keyframes`
  0%, 100% { outline-color: transparent; }
  35%, 70% { outline-color: var(--persist-highlight-color); }
`;

const PersistSessionCookiesRow = styled(Row)<{ $flashing: boolean }>`
  ${({ theme, $flashing }: { theme?: ITheme; $flashing: boolean }) => {
    if (!$flashing) return '';
    const p = getPalette(theme);
    return css`
      position: relative;
      z-index: 1;
      --persist-highlight-color: ${p.primary};
      background-color: ${p.primarySoft} !important;
      outline: 2px solid transparent;
      outline-offset: -2px;
      animation: ${highlightPersistSetting} 1s ease-in-out 3;
    `;
  }}
`;

const normalizeHost = (value: string): string | null => {
  let host = value.trim().toLowerCase();
  if (!host) return null;
  try {
    host = new URL(host.includes('://') ? host : `https://${host}`).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^\.+|\.+$/g, '');
  return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) && host.includes('.')
    ? host
    : null;
};

const PersistSessionCookieHosts = observer(() => {
  const [input, setInput] = React.useState('');
  const [error, setError] = React.useState('');
  const hosts = store.settings.persistSessionCookieHosts || [];

  if (!store.settings.persistSessionCookies) return null;

  const addHost = (event: React.FormEvent) => {
    event.preventDefault();
    const host = normalizeHost(input);
    if (!host) {
      setError('请输入有效主域名，例如 example.com');
      return;
    }
    if (hosts.includes(host)) {
      setError('该主域名已添加');
      return;
    }
    const next = [...hosts, host];
    store.settings.persistSessionCookieHosts = next;
    saveWebBrowsingSettings({persistSessionCookieHosts: next});
    setInput('');
    setError('');
  };

  const removeHost = (host: string) => {
    const next = hosts.filter((item) => item !== host);
    store.settings.persistSessionCookieHosts = next;
    saveWebBrowsingSettings({persistSessionCookieHosts: next});
  };

  return (
    <PersistCookieHosts>
      <PersistCookieHostForm onSubmit={addHost}>
        <PersistCookieHostInput
          value={input}
          maxLength={253}
          placeholder="添加主域名，例如 example.com"
          onChange={(event) => {
            setInput(event.target.value);
            if (error) setError('');
          }}
        />
        <PersistCookieHostIconButton type="submit" title="添加主域名" aria-label="添加主域名">
          <Plus size={18} weight="bold" />
        </PersistCookieHostIconButton>
      </PersistCookieHostForm>
      <PersistCookieHostHint error={!!error}>
        {error || '仅保存列表内主域名及其子域名的会话 Cookie。'}
      </PersistCookieHostHint>
      {hosts.length > 0 && (
        <PersistCookieHostList>
          {hosts.map((host) => (
            <PersistCookieHostChip key={host}>
              {host}
              <PersistCookieHostRemoveButton
                type="button"
                title={`移除 ${host}`}
                aria-label={`移除 ${host}`}
                onClick={() => removeHost(host)}
              >
                <Trash size={14} weight="bold" />
              </PersistCookieHostRemoveButton>
            </PersistCookieHostChip>
          ))}
        </PersistCookieHostList>
      )}
    </PersistCookieHosts>
  );
});

// 仅对用户手动添加的主域名保存会话 Cookie。重新进入登录页时会先清理该域名的
// 旧 Cookie，避免新旧登录态共存。
const PersistSessionCookiesToggle = observer(() => {
  const { persistSessionCookies } = store.settings;
  const highlight = store.highlightedSetting;
  const [flashing, setFlashing] = React.useState(false);
  const handledRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (highlight !== 'persistSessionCookies') return;
    if (handledRef.current === highlight) return;
    handledRef.current = highlight;

    const scrollToSetting = () =>
      document.getElementById('setting-persist-session-cookies')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });

    setFlashing(true);
    scrollToSetting();
    const firstRetry = setTimeout(scrollToSetting, 140);
    const secondRetry = setTimeout(scrollToSetting, 450);
    const stopFlashing = setTimeout(() => setFlashing(false), 3400);
    return () => {
      clearTimeout(firstRetry);
      clearTimeout(secondRetry);
      clearTimeout(stopFlashing);
    };
  }, [highlight]);

  const onChange = () => {
    const next = !persistSessionCookies;
    store.settings.persistSessionCookies = next;
    saveWebBrowsingSettings({ persistSessionCookies: next });
  };

  return (
    <PersistSessionCookiesRow
      id="setting-persist-session-cookies"
      $flashing={flashing}
      onClick={onChange}
    >
      <SettingIcon tone="green">
        <SignIn size={19} weight="fill" />
      </SettingIcon>
      <SettingCopy>
        <Title>重启后保持登录</Title>
        <SecondaryText>仅对下方主域名列表生效。</SecondaryText>
      </SettingCopy>
      <Control>
        <Switch value={persistSessionCookies} />
      </Control>
    </PersistSessionCookiesRow>
  );
});

export const WebBrowsing = observer(() => {
  return (
    <>
      <SettingGroupBlock>
        <SettingGroupLabel>浏览数据</SettingGroupLabel>
        <SettingGroup>
          <Row>
            <SettingIcon tone="orange">
              <Broom size={19} weight="fill" />
            </SettingIcon>
            <SettingCopy>
              <Title>浏览数据</Title>
            </SettingCopy>
            <Control>
              <NormalButton variant="soft" onClick={onClearBrowsingData}>
                清除
              </NormalButton>
            </Control>
          </Row>

          <Row onClick={onClearOnExit}>
            <SettingIcon tone="purple">
              <ClockCounterClockwise size={19} weight="fill" />
            </SettingIcon>
            <SettingCopy>
              <Title>退出时自动清理</Title>
              <SecondaryText>
                {clearOnExitSummary(store.settings.clearOnExit)}
              </SecondaryText>
            </SettingCopy>
            <Control>
              <NormalButton variant="soft">设置</NormalButton>
            </Control>
          </Row>
        </SettingGroup>
      </SettingGroupBlock>

      <SettingGroupBlock>
        <SettingGroupLabel>Cookie 与追踪</SettingGroupLabel>
        <SettingGroup>
          <DoNotTrackToggle />
          <IncognitoThirdPartyCookieToggle />
          <PersistSessionCookiesToggle />
          <PersistSessionCookieHosts />
        </SettingGroup>
      </SettingGroupBlock>

      <BrowsingDataDialog />
      <ClearOnExitDialog />
    </>
  );
});
