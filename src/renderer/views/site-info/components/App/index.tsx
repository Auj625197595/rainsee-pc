import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';
import {
  ArrowLeft,
  CaretRight,
  Cookie,
  Gear,
  Globe,
  Lock,
  SignIn,
  SlidersHorizontal,
  Trash,
  WarningCircle,
  X,
} from '@phosphor-icons/react';

import store, { SiteCookieData } from '../../store';
import { UIStyle } from '~/renderer/mixins/default-styles';
import { getPermissionText } from '~/utils';
import {
  StyledApp,
  Header,
  SiteName,
  IconButton,
  RowButton,
  RowIcon,
  RowMain,
  RowTitle,
  RowDetail,
  PermissionList,
  PermissionRow,
  PermissionSelect,
  Divider,
  PageContent,
  Summary,
  SummaryTitle,
  SummaryText,
  ActionButton,
  CookieList,
  CookieItem,
  CookieValue,
  CookieMeta,
  DetailList,
  DetailRow,
  DetailLabel,
  DetailValue,
  EmptyState,
} from './style';

type Page = 'main' | 'connection' | 'certificate' | 'cookies';

const connectionText = (protocol: string, secure: boolean) => {
  if (secure) return '连接是安全的';
  if (protocol === 'http') return '与此网站的连接不安全';
  if (protocol === 'file') return '本地文件';
  return '浏览器内部页面';
};

const formatDate = (seconds: number) => {
  if (!seconds) return '未知';
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return '未知';
  return date.toLocaleString('zh-CN', { hour12: false });
};

const cookieFlags = (cookie: SiteCookieData) =>
  [
    cookie.session ? '会话' : '',
    cookie.secure ? 'Secure' : '',
    cookie.httpOnly ? 'HttpOnly' : '',
  ]
    .filter(Boolean)
    .join(' · ');

export const App = observer(() => {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [page, setPage] = React.useState<Page>('main');
  const [busyCookie, setBusyCookie] = React.useState('');
  const [persistingCookies, setPersistingCookies] = React.useState(false);
  const { data } = store;
  const hasSessionCookies = data.cookies.some((cookie) => cookie.session);
  const ConnectionIcon = data.secure
    ? Lock
    : data.protocol === 'http'
    ? WarningCircle
    : Globe;

  React.useEffect(() => {
    if (store.visible) {
      setPage('main');
      setBusyCookie('');
      setPersistingCookies(false);
    }
  }, [store.visible, data.url]);

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const report = () => store.resize(Math.ceil(root.scrollHeight));
    report();
    const resizeObserver = new ResizeObserver(report);
    resizeObserver.observe(root);
    return () => resizeObserver.disconnect();
  }, []);

  const goBack = () => {
    setPage(page === 'certificate' ? 'connection' : 'main');
  };

  const removeCookie = async (cookie: SiteCookieData) => {
    const key = `${cookie.domain}|${cookie.path}|${cookie.name}`;
    setBusyCookie(key);
    try {
      await store.removeCookie(cookie);
    } catch {
      // 保留现有列表，用户可以再次尝试。
    } finally {
      setBusyCookie('');
    }
  };

  const clearCookies = async () => {
    setBusyCookie('__all__');
    try {
      await store.clearCookies();
    } catch {
      // 保留现有列表，用户可以再次尝试。
    } finally {
      setBusyCookie('');
    }
  };

  const persistSessionCookies = async () => {
    setPersistingCookies(true);
    try {
      await store.persistSessionCookies();
    } catch {
      // 设置未写入时保留弹窗，用户可以再次尝试。
    } finally {
      setPersistingCookies(false);
    }
  };

  const pageTitle =
    page === 'connection'
      ? '连接安全'
      : page === 'certificate'
      ? '证书详情'
      : page === 'cookies'
      ? 'Cookie 和网站数据'
      : data.host;

  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <StyledApp ref={rootRef} visible={store.visible}>
        <UIStyle />
        <Header>
          {page !== 'main' && (
            <IconButton type="button" title="返回" onClick={goBack}>
              <ArrowLeft size={18} weight="bold" />
            </IconButton>
          )}
          <SiteName title={pageTitle}>{pageTitle}</SiteName>
          <IconButton type="button" title="关闭" onClick={() => store.hide()}>
            <X size={18} weight="bold" />
          </IconButton>
        </Header>

        {page === 'main' && (
          <PageContent>
            <RowButton type="button" onClick={() => setPage('connection')}>
              <RowIcon $tone={data.secure ? 'secure' : 'muted'}>
                <ConnectionIcon size={20} weight="regular" />
              </RowIcon>
              <RowMain>
                <RowTitle>
                  {connectionText(data.protocol, data.secure)}
                </RowTitle>
              </RowMain>
              <CaretRight size={18} />
            </RowButton>

            {data.permissions.length > 0 && (
              <>
                <Divider />
                <PermissionList>
                  {data.permissions.map((permission, index) => (
                    <PermissionRow
                      key={
                        permission._id || `${permission.permission}-${index}`
                      }
                    >
                      <RowIcon $tone="muted">
                        <SlidersHorizontal size={20} />
                      </RowIcon>
                      <RowMain>
                        <RowTitle>
                          {getPermissionText(permission.permission)}
                        </RowTitle>
                      </RowMain>
                      <PermissionSelect
                        value={
                          permission.type === 1
                            ? 'allow'
                            : permission.type === 3
                            ? 'ask'
                            : 'deny'
                        }
                        aria-label={`${getPermissionText(
                          permission.permission,
                        )}设置`}
                        onChange={(event) =>
                          store.setPermission(
                            permission,
                            event.target.value as
                              | 'default'
                              | 'allow'
                              | 'ask'
                              | 'deny',
                          )
                        }
                      >
                        <option value="default">默认</option>
                        <option value="allow">允许</option>
                        {permission.permission === 'external-navigation' && (
                          <option value="ask">询问</option>
                        )}
                        <option value="deny">拒绝</option>
                      </PermissionSelect>
                    </PermissionRow>
                  ))}
                </PermissionList>
              </>
            )}

            <Divider />
            <RowButton type="button" onClick={() => setPage('cookies')}>
              <RowIcon $tone="muted">
                <Cookie size={21} />
              </RowIcon>
              <RowMain>
                <RowTitle>Cookie 和网站数据</RowTitle>
                <RowDetail>{data.cookies.length} 个 Cookie</RowDetail>
              </RowMain>
              <CaretRight size={18} />
            </RowButton>

            <RowButton
              type="button"
              onClick={() => store.openSettings('permissions')}
            >
              <RowIcon $tone="muted">
                <Gear size={21} />
              </RowIcon>
              <RowMain>
                <RowTitle>网站设置</RowTitle>
              </RowMain>
              <CaretRight size={18} />
            </RowButton>
          </PageContent>
        )}

        {page === 'connection' && (
          <PageContent>
            <Summary>
              <RowIcon $tone={data.secure ? 'secure' : 'muted'}>
                <ConnectionIcon size={24} />
              </RowIcon>
              <RowMain>
                <SummaryTitle>
                  {connectionText(data.protocol, data.secure)}
                </SummaryTitle>
                <SummaryText>
                  {data.secure
                    ? '发送到此网站的信息会经过加密传输。'
                    : data.protocol === 'http'
                    ? '请勿在此页面输入密码或付款信息等敏感内容。'
                    : '此页面不通过普通的网站连接加载。'}
                </SummaryText>
              </RowMain>
            </Summary>
            {data.secure && (
              <>
                <Divider />
                <RowButton type="button" onClick={() => setPage('certificate')}>
                  <RowIcon $tone="secure">
                    <Lock size={20} />
                  </RowIcon>
                  <RowMain>
                    <RowTitle>
                      {data.certificatePending
                        ? '正在读取证书...'
                        : data.certificate
                        ? '证书有效'
                        : '无法读取证书'}
                    </RowTitle>
                    {data.certificate?.issuerName && (
                      <RowDetail>
                        颁发者：{data.certificate.issuerName}
                      </RowDetail>
                    )}
                  </RowMain>
                  <CaretRight size={18} />
                </RowButton>
              </>
            )}
          </PageContent>
        )}

        {page === 'certificate' && (
          <PageContent>
            {data.certificate ? (
              <DetailList>
                <DetailRow>
                  <DetailLabel>颁发给</DetailLabel>
                  <DetailValue>{data.certificate.subjectName}</DetailValue>
                </DetailRow>
                <DetailRow>
                  <DetailLabel>颁发者</DetailLabel>
                  <DetailValue>
                    {data.certificate.issuerName || '未知'}
                  </DetailValue>
                </DetailRow>
                <DetailRow>
                  <DetailLabel>有效期起始</DetailLabel>
                  <DetailValue>
                    {formatDate(data.certificate.validStart)}
                  </DetailValue>
                </DetailRow>
                <DetailRow>
                  <DetailLabel>有效期截止</DetailLabel>
                  <DetailValue>
                    {formatDate(data.certificate.validExpiry)}
                  </DetailValue>
                </DetailRow>
                <DetailRow>
                  <DetailLabel>连接协议</DetailLabel>
                  <DetailValue>
                    {[data.certificate.protocol, data.certificate.cipher]
                      .filter(Boolean)
                      .join(' · ') || '未知'}
                  </DetailValue>
                </DetailRow>
                <DetailRow>
                  <DetailLabel>序列号</DetailLabel>
                  <DetailValue $wrap>
                    {data.certificate.serialNumber || '未知'}
                  </DetailValue>
                </DetailRow>
                <DetailRow>
                  <DetailLabel>SHA-256 指纹</DetailLabel>
                  <DetailValue $wrap>
                    {data.certificate.fingerprint || '未知'}
                  </DetailValue>
                </DetailRow>
              </DetailList>
            ) : (
              <EmptyState>
                {data.certificatePending
                  ? '正在读取证书...'
                  : '未读取到证书信息'}
              </EmptyState>
            )}
          </PageContent>
        )}

        {page === 'cookies' && (
          <PageContent>
            <Summary>
              <RowIcon $tone="muted">
                <Cookie size={24} />
              </RowIcon>
              <RowMain>
                <SummaryTitle>{data.cookies.length} 个 Cookie</SummaryTitle>
                <SummaryText>{data.host}</SummaryText>
              </RowMain>
              <ActionButton
                type="button"
                disabled={data.cookies.length === 0 || busyCookie !== ''}
                onClick={clearCookies}
              >
                <Trash size={16} />
                全部删除
              </ActionButton>
            </Summary>
            {hasSessionCookies && (
              <>
                <Divider />
                <RowButton
                  type="button"
                  disabled={persistingCookies}
                  onClick={persistSessionCookies}
                >
                  <RowIcon $tone="secure">
                    <SignIn size={21} />
                  </RowIcon>
                  <RowMain>
                    <RowTitle>重启后保持登录</RowTitle>
                    <RowDetail>保留当前主域名的会话 Cookie</RowDetail>
                  </RowMain>
                  <CaretRight size={18} />
                </RowButton>
              </>
            )}
            <Divider />
            {data.cookies.length > 0 ? (
              <CookieList>
                {data.cookies.map((cookie) => {
                  const key = `${cookie.domain}|${cookie.path}|${cookie.name}`;
                  return (
                    <CookieItem key={key}>
                      <RowMain>
                        <RowTitle title={cookie.name}>{cookie.name}</RowTitle>
                        <CookieValue title={cookie.value}>
                          {cookie.value || '空值'}
                        </CookieValue>
                        <CookieMeta>
                          {cookie.domain || data.host}
                          {cookie.path}
                          {cookieFlags(cookie)
                            ? ` · ${cookieFlags(cookie)}`
                            : ''}
                        </CookieMeta>
                      </RowMain>
                      <IconButton
                        type="button"
                        title={`删除 ${cookie.name}`}
                        disabled={busyCookie !== ''}
                        onClick={() => removeCookie(cookie)}
                      >
                        <Trash size={17} />
                      </IconButton>
                    </CookieItem>
                  );
                })}
              </CookieList>
            ) : (
              <EmptyState>此网站目前没有 Cookie</EmptyState>
            )}
          </PageContent>
        )}
      </StyledApp>
    </ThemeProvider>
  );
});
