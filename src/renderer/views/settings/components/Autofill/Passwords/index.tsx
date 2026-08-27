import * as React from 'react';
import { observer } from 'mobx-react-lite';

import store from '../../../store';
import { IFormFillData } from '~/interfaces';
import { Section } from '../Section';
import { getUserPassword } from '~/preloads/utils/autofill';
import { getDomain, getIconByUrlNet } from '~/utils/url';
import {
  CardHeader,
  CloudButton,
  DeleteButton,
  Container,
  EmptyState,
  EmptyStateSub,
  Favicon,
  FaviconFallback,
  HeaderLabel,
  HeaderMeta,
  HeaderTitle,
  Row,
  SearchBox,
  SearchClear,
  SearchInput,
  SiteMain,
  SiteText,
  StatusText,
  TextValue,
  Toolbar,
  UserMain,
  ValueCell,
} from './styles';
import { ICON_KEY } from '~/renderer/constants';

const getMaskedPassword = (password: string, fallbackLength = 0) => {
  if (!password) {
    return '*'.repeat(Math.max(fallbackLength, 0));
  }

  if (password.length <= 4) {
    return '*'.repeat(password.length);
  }

  return `${password.slice(0, 2)}${'*'.repeat(
    password.length - 4,
  )}${password.slice(-2)}`;
};

const isReadablePassword = (password: string) =>
  typeof password === 'string' &&
  password.trim() !== '' &&
  !password.includes('暂不支持查看密码');

const getSiteDisplay = (url?: string) => {
  if (!url) {
    return {
      domain: '未知网站',
      fullUrl: '',
    };
  }

  return {
    domain: getDomain(url),
    fullUrl: url,
  };
};

const compareText = (left: string, right: string) => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

// Keep the field order aligned with the Android and HarmonyOS password lists.
const compareCredentials = (left: IFormFillData, right: IFormFillData) => {
  const leftSite = getDomain(left.url).toLowerCase();
  const rightSite = getDomain(right.url).toLowerCase();
  const siteResult = compareText(leftSite, rightSite);
  if (siteResult !== 0) return siteResult;

  const leftUsername = (left.fields?.username || '').toLowerCase();
  const rightUsername = (right.fields?.username || '').toLowerCase();
  const usernameResult = compareText(leftUsername, rightUsername);
  if (usernameResult !== 0) return usernameResult;

  const passwordResult = compareText(
    left.fields?.password || '',
    right.fields?.password || '',
  );
  if (passwordResult !== 0) return passwordResult;

  const urlResult = compareText(
    (left.url || '').toLowerCase(),
    (right.url || '').toLowerCase(),
  );
  if (urlResult !== 0) return urlResult;

  return compareText(left._id || '', right._id || '');
};

const Item = observer(({ data }: { data: IFormFillData }) => {
  const { url, favicon, fields } = data;
  const [displayPassword, setDisplayPassword] = React.useState(
    getMaskedPassword(null, fields?.passLength || 0),
  );
  const site = React.useMemo(() => getSiteDisplay(url), [url]);
  const username = fields?.username || '未填写用户名';
  const iconUrl =
    favicon && favicon.trim() !== ''
      ? favicon
      : url
      ? getIconByUrlNet(url)
      : '';

  React.useEffect(() => {
    let mounted = true;

    const loadMaskedPassword = async () => {
      const password = await getUserPassword(data).catch(() => '');

      if (!mounted || !isReadablePassword(password)) return;

      setDisplayPassword(getMaskedPassword(password, fields?.passLength || 0));
    };

    loadMaskedPassword();

    return () => {
      mounted = false;
    };
  }, [data, fields?.passLength]);

  const onDelete = () => {
    store.autoFill.removeItem(data);
  };

  return (
    <Row>
      <ValueCell>
        <Favicon>
          {iconUrl ? (
            <img src={iconUrl} alt="" draggable={false} />
          ) : (
            <FaviconFallback>
              {site.domain.slice(0, 1).toUpperCase()}
            </FaviconFallback>
          )}
        </Favicon>
        <SiteText>
          <SiteMain title={site.domain}>{site.domain}</SiteMain>
        </SiteText>
      </ValueCell>
      <ValueCell>
        <UserMain title={username}>{username}</UserMain>
      </ValueCell>
      <ValueCell $align="end">
        <TextValue title={displayPassword}>{displayPassword}</TextValue>
        <DeleteButton onClick={onDelete} title="删除密码" />
      </ValueCell>
    </Row>
  );
});

// 导入/导出 CSV(支持 Chrome / Firefox / Bitwarden 导出的格式)
const ImportExportToolbar = observer(() => {
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState('');

  const ipc = (channel: string): Promise<any> => {
    const invoke = (window as any).ipcInvoke;
    return invoke ? invoke(channel) : Promise.resolve(null);
  };

  const onImport = async () => {
    if (busy) return;
    setBusy(true);
    setStatus('正在导入…');
    const res = await ipc('passwords-import-csv').catch(() => null);
    setStatus(res?.msg || '导入失败');
    if (res?.ok && res.count > 0) {
      await store.autoFill.load();
    }
    setBusy(false);
  };

  const onExport = async () => {
    if (busy) return;
    setBusy(true);
    setStatus('正在导出…');
    const res = await ipc('passwords-export-csv').catch(() => null);
    setStatus(res?.msg || '导出失败');
    setBusy(false);
  };

  return (
    <Toolbar>
      <CloudButton $variant="primary" onClick={onImport}>
        导入密码
      </CloudButton>
      <CloudButton onClick={onExport}>导出密码</CloudButton>
      <StatusText>支持 Chrome / Firefox 的 CSV</StatusText>
      {status ? <StatusText>{status}</StatusText> : null}
    </Toolbar>
  );
});

export const Passwords = observer(() => {
  const [query, setQuery] = React.useState('');
  const keyword = query.trim().toLowerCase();
  const filteredCredentials = (
    keyword === ''
      ? store.autoFill.credentials.slice()
      : store.autoFill.credentials.filter((item) => {
          const site = getSiteDisplay(item.url);
          const username = item.fields?.username || '';

          return [site.domain, site.fullUrl, username].some((value) =>
            value.toLowerCase().includes(keyword),
          );
        })
  ).sort(compareCredentials);

  return (
    <Section label="网站密码" icon={ICON_KEY} defaultExpanded>
      <ImportExportToolbar />
      <CardHeader>
        <div>
          <HeaderTitle>已保存的网站密码</HeaderTitle>
          <HeaderMeta>
            支持按网站搜索，网站和用户名可直接鼠标选中复制。
          </HeaderMeta>
        </div>
        <SearchBox>
          <SearchInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索网站或用户名"
          />
          {query ? (
            <SearchClear onClick={() => setQuery('')} title="清空搜索">
              清空
            </SearchClear>
          ) : null}
        </SearchBox>
      </CardHeader>
      <Container>
        <HeaderLabel>网站</HeaderLabel>
        <HeaderLabel>用户名</HeaderLabel>
        <HeaderLabel $align="end">密码</HeaderLabel>
        {filteredCredentials.length ? (
          filteredCredentials.map((item) => <Item key={item._id} data={item} />)
        ) : (
          <EmptyState>
            没有找到匹配的网站
            <EmptyStateSub>
              试试输入域名、完整网址或用户名关键词。
            </EmptyStateSub>
          </EmptyState>
        )}
      </Container>
    </Section>
  );
});
