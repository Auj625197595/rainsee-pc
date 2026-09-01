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
import { useI18n } from '~/renderer/components/I18n';

type Page = 'main' | 'connection' | 'certificate' | 'cookies';

const connectionText = (
  protocol: string,
  secure: boolean,
  t: (k: string) => string,
) => {
  if (secure) return t('siSecure');
  if (protocol === 'http') return t('siNotSecure');
  if (protocol === 'file') return t('siLocalFile');
  return t('siInternalPage');
};

const formatDate = (seconds: number, t: (k: string) => string) => {
  if (!seconds) return t('siUnknown');
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return t('siUnknown');
  return date.toLocaleString(undefined, { hour12: false });
};

const cookieFlags = (cookie: SiteCookieData, t: (k: string) => string) =>
  [
    cookie.session ? t('siSession') : '',
    cookie.secure ? 'Secure' : '',
    cookie.httpOnly ? 'HttpOnly' : '',
  ]
    .filter(Boolean)
    .join(' · ');

export const App = observer(() => {
  const t = useI18n();
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
      ? t('siTabSecurity')
      : page === 'certificate'
      ? t('siTabCertificate')
      : page === 'cookies'
      ? t('siTabCookies')
      : data.host;

  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <StyledApp ref={rootRef} visible={store.visible}>
        <UIStyle />
        <Header>
          {page !== 'main' && (
            <IconButton type="button" title={t('siBack')} onClick={goBack}>
              <ArrowLeft size={18} weight="bold" />
            </IconButton>
          )}
          <SiteName title={pageTitle}>{pageTitle}</SiteName>
          <IconButton type="button" title={t('close')} onClick={() => store.hide()}>
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
                  {connectionText(data.protocol, data.secure, t)}
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
                        )}${t('siPermissionsSuffix')}`}
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
                        <option value="default">{t('siOptDefault')}</option>
                        <option value="allow">{t('siOptAllow')}</option>
                        {permission.permission === 'external-navigation' && (
                          <option value="ask">{t('siOptAsk')}</option>
                        )}
                        <option value="deny">{t('siOptDeny')}</option>
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
                <RowTitle>{t('siCookiesTitle')}</RowTitle>
                <RowDetail>{t('siCookieCount', { count: data.cookies.length })}</RowDetail>
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
                <RowTitle>{t('siSiteSettings')}</RowTitle>
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
                  {connectionText(data.protocol, data.secure, t)}
                </SummaryTitle>
                <SummaryText>
                  {data.secure
                    ? t('siSecureInfo')
                    : data.protocol === 'http'
                    ? t('siInsecureInfo')
                    : t('siNonStandardInfo')}
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
                        ? t('siReadingCert')
                        : data.certificate
                        ? t('siCertValid')
                        : t('siCertUnavailable')}
                    </RowTitle>
                    {data.certificate?.issuerName && (
                      <RowDetail>
                        {t('siIssuer', { name: data.certificate.issuerName })}
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
                  <DetailLabel>{t('siIssuedTo')}</DetailLabel>
                  <DetailValue>{data.certificate.subjectName}</DetailValue>
                </DetailRow>
                <DetailRow>
                  <DetailLabel>{t('siIssuerLabel')}</DetailLabel>
                  <DetailValue>
                    {data.certificate.issuerName || t('siUnknown')}
                  </DetailValue>
                </DetailRow>
                <DetailRow>
                  <DetailLabel>{t('siValidFrom')}</DetailLabel>
                  <DetailValue>
                    {formatDate(data.certificate.validStart, t)}
                  </DetailValue>
                </DetailRow>
                <DetailRow>
                  <DetailLabel>{t('siValidTo')}</DetailLabel>
                  <DetailValue>
                    {formatDate(data.certificate.validExpiry, t)}
                  </DetailValue>
                </DetailRow>
                <DetailRow>
                  <DetailLabel>{t('siProtocol')}</DetailLabel>
                  <DetailValue>
                    {[data.certificate.protocol, data.certificate.cipher]
                      .filter(Boolean)
                      .join(' · ') || t('siUnknown')}
                  </DetailValue>
                </DetailRow>
                <DetailRow>
                  <DetailLabel>{t('siSerial')}</DetailLabel>
                  <DetailValue $wrap>
                    {data.certificate.serialNumber || t('siUnknown')}
                  </DetailValue>
                </DetailRow>
                <DetailRow>
                  <DetailLabel>{t('siSha256')}</DetailLabel>
                  <DetailValue $wrap>
                    {data.certificate.fingerprint || t('siUnknown')}
                  </DetailValue>
                </DetailRow>
              </DetailList>
            ) : (
              <EmptyState>
                {data.certificatePending
                  ? t('siReadingCert')
                  : t('siCertNotRead')}
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
                <SummaryTitle>{t('siCookieCount', { count: data.cookies.length })}</SummaryTitle>
                <SummaryText>{data.host}</SummaryText>
              </RowMain>
              <ActionButton
                type="button"
                disabled={data.cookies.length === 0 || busyCookie !== ''}
                onClick={clearCookies}
              >
                <Trash size={16} />
                {t('siDeleteAll')}
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
                    <RowTitle>{t('siPersistTitle')}</RowTitle>
                    <RowDetail>{t('siPersistDetail')}</RowDetail>
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
                          {cookie.value || t('siEmptyValue')}
                        </CookieValue>
                        <CookieMeta>
                          {cookie.domain || data.host}
                          {cookie.path}
                          {cookieFlags(cookie, t)
                            ? ` · ${cookieFlags(cookie, t)}`
                            : ''}
                        </CookieMeta>
                      </RowMain>
                      <IconButton
                        type="button"
                        title={t('siDeleteCookieAria', { name: cookie.name })}
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
              <EmptyState>{t('siNoCookies')}</EmptyState>
            )}
          </PageContent>
        )}
      </StyledApp>
    </ThemeProvider>
  );
});
