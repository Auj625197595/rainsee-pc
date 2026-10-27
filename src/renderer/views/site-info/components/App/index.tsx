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
  PencilSimple,
  Plus,
  SignIn,
  SlidersHorizontal,
  Trash,
  UploadSimple,
  WarningCircle,
  X,
} from '@phosphor-icons/react';

import store, {
  CookieExportFormat,
  CookieSaveError,
  SiteCookieData,
} from '../../store';
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
  CookieToolbar,
  ExportPanel,
  ExportLabel,
  ExportHint,
  CookieMainButton,
  Form,
  Field,
  FieldRow,
  FieldHint,
  TextInput,
  TextArea,
  Select,
  CheckRow,
  FormError,
  FormActions,
  PrimaryButton,
} from './style';
import { useI18n } from '~/renderer/components/I18n';

type Page = 'main' | 'connection' | 'certificate' | 'cookies' | 'cookie-edit';

interface CookieEditState {
  original: SiteCookieData | null;
  draft: SiteCookieData;
  error: CookieSaveError | '';
  saving: boolean;
}

const EXPORT_FORMATS: { format: CookieExportFormat; label: string }[] = [
  { format: 'json', label: 'JSON' },
  { format: 'header', label: 'Header String' },
  { format: 'netscape', label: 'Netscape' },
];

const SAME_SITE_OPTIONS = [
  { value: 'unspecified', labelKey: 'siSameSiteUnspecified' },
  { value: 'no_restriction', label: 'None' },
  { value: 'lax', label: 'Lax' },
  { value: 'strict', label: 'Strict' },
];

const SAVE_ERROR_KEYS: Record<CookieSaveError, string> = {
  noTarget: 'siCookieErrNoTarget',
  name: 'siCookieErrName',
  value: 'siCookieErrValue',
  domain: 'siCookieErrDomain',
  set: 'siCookieErrSet',
};

const pad2 = (value: number) => String(value).padStart(2, '0');

// datetime-local 需要本地时区的 "YYYY-MM-DDTHH:mm"。
const toLocalInput = (seconds?: number) => {
  if (!seconds) return '';
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

const fromLocalInput = (value: string) => {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : Math.floor(time / 1000);
};

const cookieKey = (cookie: SiteCookieData) =>
  `${cookie.domain}|${cookie.path}|${cookie.name}`;

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
  const [exportOpen, setExportOpen] = React.useState(false);
  const [copiedFormat, setCopiedFormat] = React.useState('');
  const [editing, setEditing] = React.useState<CookieEditState | null>(null);
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
      setExportOpen(false);
      setCopiedFormat('');
      setEditing(null);
    }
  }, [store.visible, data.url]);

  React.useEffect(() => {
    if (!copiedFormat) return undefined;
    const timer = window.setTimeout(() => setCopiedFormat(''), 1800);
    return () => window.clearTimeout(timer);
  }, [copiedFormat]);

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
    if (page === 'cookie-edit') {
      setEditing(null);
      setPage('cookies');
      return;
    }
    setPage(page === 'certificate' ? 'connection' : 'main');
  };

  const exportCookies = (format: CookieExportFormat) => {
    try {
      store.exportCookies(format);
      setCopiedFormat(format);
    } catch {
      setCopiedFormat('');
    }
  };

  const openCookieEditor = (cookie: SiteCookieData | null) => {
    const draft: SiteCookieData = cookie
      ? { ...cookie }
      : {
          name: '',
          value: '',
          domain: data.host,
          path: '/',
          secure: data.secure,
          httpOnly: false,
          hostOnly: true,
          session: false,
          sameSite: 'lax',
          expirationDate: Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
        };
    setEditing({ original: cookie, draft, error: '', saving: false });
    setExportOpen(false);
    setPage('cookie-edit');
  };

  const updateDraft = (patch: Partial<SiteCookieData>) => {
    setEditing((state) =>
      state ? { ...state, draft: { ...state.draft, ...patch }, error: '' } : state,
    );
  };

  const saveCookie = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing || editing.saving) return;
    setEditing({ ...editing, saving: true, error: '' });
    try {
      const result = await store.saveCookie(editing.original, editing.draft);
      if (result.ok) {
        setEditing(null);
        setPage('cookies');
        return;
      }
      setEditing((state) =>
        state ? { ...state, saving: false, error: result.error || 'set' } : state,
      );
    } catch {
      setEditing((state) =>
        state ? { ...state, saving: false, error: 'set' } : state,
      );
    }
  };

  const deleteEditingCookie = async () => {
    if (!editing?.original) return;
    setEditing({ ...editing, saving: true });
    try {
      await store.removeCookie(editing.original);
      setEditing(null);
      setPage('cookies');
    } catch {
      setEditing((state) => (state ? { ...state, saving: false } : state));
    }
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
      : page === 'cookie-edit'
      ? editing?.original
        ? t('siEditCookie')
        : t('siNewCookie')
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
            <CookieToolbar>
              <ActionButton
                type="button"
                disabled={busyCookie !== ''}
                onClick={() => openCookieEditor(null)}
              >
                <Plus size={16} />
                {t('siAddCookie')}
              </ActionButton>
              <ActionButton
                type="button"
                aria-expanded={exportOpen}
                disabled={data.cookies.length === 0}
                onClick={() => setExportOpen(!exportOpen)}
              >
                <UploadSimple size={16} />
                {t('siExport')}
              </ActionButton>
            </CookieToolbar>
            {exportOpen && data.cookies.length > 0 && (
              <ExportPanel role="group" aria-label={t('siExportAs')}>
                <ExportLabel>{t('siExportAs')}</ExportLabel>
                {EXPORT_FORMATS.map(({ format, label }) => (
                  <ActionButton
                    key={format}
                    type="button"
                    onClick={() => exportCookies(format)}
                  >
                    {label}
                  </ActionButton>
                ))}
                <ExportHint aria-live="polite">
                  {copiedFormat ? t('siExportCopied') : ''}
                </ExportHint>
              </ExportPanel>
            )}
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
                  const key = cookieKey(cookie);
                  return (
                    <CookieItem key={key}>
                      <CookieMainButton
                        type="button"
                        title={t('siEditCookieAria', { name: cookie.name })}
                        disabled={busyCookie !== ''}
                        onClick={() => openCookieEditor(cookie)}
                      >
                        <RowTitle>{cookie.name}</RowTitle>
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
                      </CookieMainButton>
                      <IconButton
                        type="button"
                        title={t('siEditCookieAria', { name: cookie.name })}
                        disabled={busyCookie !== ''}
                        onClick={() => openCookieEditor(cookie)}
                      >
                        <PencilSimple size={17} />
                      </IconButton>
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

        {page === 'cookie-edit' && editing && (
          <PageContent>
            <Form onSubmit={saveCookie}>
              <Field>
                <span>{t('siCookieName')}</span>
                <TextInput
                  autoFocus
                  required
                  spellCheck={false}
                  value={editing.draft.name}
                  onChange={(e) => updateDraft({ name: e.target.value })}
                />
              </Field>
              <Field>
                <span>{t('siCookieValue')}</span>
                <TextArea
                  spellCheck={false}
                  value={editing.draft.value}
                  onChange={(e) => updateDraft({ value: e.target.value })}
                />
              </Field>
              <FieldRow>
                <Field>
                  <span>{t('siCookieDomain')}</span>
                  <TextInput
                    spellCheck={false}
                    value={editing.draft.domain}
                    onChange={(e) => updateDraft({ domain: e.target.value })}
                  />
                </Field>
                <Field>
                  <span>{t('siCookiePath')}</span>
                  <TextInput
                    spellCheck={false}
                    value={editing.draft.path}
                    onChange={(e) => updateDraft({ path: e.target.value })}
                  />
                </Field>
              </FieldRow>
              <FieldHint>{t('siCookieDomainHint')}</FieldHint>
              <FieldRow>
                <Field>
                  <span>{t('siCookieExpires')}</span>
                  <TextInput
                    type="datetime-local"
                    disabled={editing.draft.session}
                    value={
                      editing.draft.session
                        ? ''
                        : toLocalInput(editing.draft.expirationDate)
                    }
                    onChange={(e) =>
                      updateDraft({
                        expirationDate: fromLocalInput(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field>
                  <span>SameSite</span>
                  <Select
                    value={editing.draft.sameSite}
                    onChange={(e) => updateDraft({ sameSite: e.target.value })}
                  >
                    {SAME_SITE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.labelKey ? t(option.labelKey) : option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </FieldRow>
              <CheckRow>
                <label>
                  <input
                    type="checkbox"
                    checked={editing.draft.session}
                    onChange={(e) =>
                      updateDraft({
                        session: e.target.checked,
                        expirationDate:
                          e.target.checked || editing.draft.expirationDate
                            ? editing.draft.expirationDate
                            : Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
                      })
                    }
                  />
                  {t('siCookieSessionOnly')}
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={
                      editing.draft.secure ||
                      editing.draft.sameSite === 'no_restriction'
                    }
                    disabled={editing.draft.sameSite === 'no_restriction'}
                    onChange={(e) => updateDraft({ secure: e.target.checked })}
                  />
                  Secure
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={editing.draft.httpOnly}
                    onChange={(e) =>
                      updateDraft({ httpOnly: e.target.checked })
                    }
                  />
                  HttpOnly
                </label>
              </CheckRow>
              {editing.error && (
                <FormError role="alert">
                  {t(SAVE_ERROR_KEYS[editing.error])}
                </FormError>
              )}
              <FormActions>
                {editing.original ? (
                  <ActionButton
                    type="button"
                    disabled={editing.saving}
                    onClick={deleteEditingCookie}
                  >
                    <Trash size={16} />
                    {t('siDelete')}
                  </ActionButton>
                ) : (
                  <span />
                )}
                <ActionButton type="button" onClick={goBack}>
                  {t('siCancel')}
                </ActionButton>
                <PrimaryButton type="submit" disabled={editing.saving}>
                  {t('siSave')}
                </PrimaryButton>
              </FormActions>
            </Form>
          </PageContent>
        )}
      </StyledApp>
    </ThemeProvider>
  );
});
