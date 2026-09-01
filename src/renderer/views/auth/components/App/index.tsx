import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';
import {
  Eye,
  EyeSlash,
  LockKey,
  ShieldCheck,
  User,
} from '@phosphor-icons/react';

import store from '../../store';
import { UIStyle } from '~/renderer/mixins/default-styles';
import {
  Actions,
  CancelButton,
  Field,
  FieldControl,
  FieldLabel,
  Header,
  HeaderIcon,
  HeaderText,
  Input,
  CredentialSelect,
  PrimaryButton,
  SavedCredential,
  SavedCredentialLabel,
  Site,
  SiteAddress,
  StyledApp,
  Subtitle,
  Title,
  VisibilityButton,
} from './style';
import { useI18n } from '~/renderer/components/I18n';

const sendResponse = (
  credentials: {
    username: string;
    password: string;
    credentialId?: string;
  } | null,
) => {
  store.send('result', credentials);
};

const getSiteAddress = (url: string) => {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
};

export const App = observer(() => {
  const t = useI18n();
  const usernameRef = React.useRef<HTMLInputElement>(null);
  const credentialRequestRef = React.useRef(0);
  const autoFilledUrlRef = React.useRef('');
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [passwordVisible, setPasswordVisible] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [credentialId, setCredentialId] = React.useState('');

  const fillCredential = React.useCallback(async (id: string) => {
    const requestId = ++credentialRequestRef.current;
    setCredentialId(id);
    const credential = await store.getPassword(id);
    if (!credential || requestId !== credentialRequestRef.current) return;
    setUsername(credential.username);
    setPassword(credential.password);
    setSubmitted(false);
  }, []);

  React.useEffect(() => {
    setUsername('');
    setPassword('');
    setPasswordVisible(false);
    setSubmitted(false);
    setCredentialId('');
    credentialRequestRef.current += 1;
    autoFilledUrlRef.current = '';
    requestAnimationFrame(() => usernameRef.current?.focus());
  }, [store.url]);

  React.useEffect(() => {
    const first = store.credentials[0];
    if (!first || autoFilledUrlRef.current === store.url) return;
    autoFilledUrlRef.current = store.url;
    fillCredential(first.id);
  }, [fillCredential, store.credentials, store.url]);

  const submit = () => {
    setSubmitted(true);
    if (!username.trim() || !password.trim()) return;
    sendResponse({
      username,
      password,
      credentialId: credentialId || undefined,
    });
  };

  return (
    <ThemeProvider
      theme={{ ...store.theme, dark: store.theme['dialog.lightForeground'] }}
    >
      <StyledApp
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') sendResponse(null);
        }}
      >
        <UIStyle />

        <Header>
          <HeaderIcon aria-hidden="true">
            <ShieldCheck size={23} weight="duotone" />
          </HeaderIcon>
          <HeaderText>
            <Title>{t('authTitle')}</Title>
            <Subtitle>{t('authSubtitle')}</Subtitle>
          </HeaderText>
        </Header>

        <Site title={store.url}>
          <LockKey size={14} weight="bold" aria-hidden="true" />
          <SiteAddress>{getSiteAddress(store.url)}</SiteAddress>
        </Site>

        {store.credentials.length > 0 && (
          <SavedCredential>
            <SavedCredentialLabel htmlFor="auth-saved-credential">
              {t('authSavedAccounts')}
            </SavedCredentialLabel>
            <CredentialSelect
              id="auth-saved-credential"
              value={credentialId}
              onChange={(event) => {
                const id = event.target.value;
                if (id) {
                  fillCredential(id);
                  return;
                }
                credentialRequestRef.current += 1;
                setCredentialId('');
                setUsername('');
                setPassword('');
                requestAnimationFrame(() => usernameRef.current?.focus());
              }}
            >
              <option value="">{t('authManualEntry')}</option>
              {store.credentials.map((credential) => (
                <option key={credential.id} value={credential.id}>
                  {credential.username || t('authNoUsername')}
                </option>
              ))}
            </CredentialSelect>
          </SavedCredential>
        )}

        <Field>
          <FieldLabel htmlFor="auth-username">{t('authUsername')}</FieldLabel>
          <FieldControl $invalid={submitted && !username.trim()}>
            <User size={18} aria-hidden="true" />
            <Input
              ref={usernameRef}
              id="auth-username"
              name="username"
              autoComplete="username"
              value={username}
              placeholder={t('authUsernamePlaceholder')}
              aria-invalid={submitted && !username.trim()}
              onChange={(event) => {
                setUsername(event.target.value);
                setCredentialId('');
              }}
            />
          </FieldControl>
        </Field>

        <Field>
          <FieldLabel htmlFor="auth-password">{t('authPassword')}</FieldLabel>
          <FieldControl $invalid={submitted && !password.trim()}>
            <LockKey size={18} aria-hidden="true" />
            <Input
              id="auth-password"
              name="password"
              type={passwordVisible ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              placeholder={t('authPasswordPlaceholder')}
              aria-invalid={submitted && !password.trim()}
              onChange={(event) => setPassword(event.target.value)}
            />
            <VisibilityButton
              type="button"
              title={passwordVisible ? t('authHidePassword') : t('authShowPassword')}
              aria-label={passwordVisible ? t('authHidePassword') : t('authShowPassword')}
              onClick={() => setPasswordVisible((visible) => !visible)}
            >
              {passwordVisible ? <EyeSlash size={18} /> : <Eye size={18} />}
            </VisibilityButton>
          </FieldControl>
        </Field>

        <Actions>
          <CancelButton type="button" onClick={() => sendResponse(null)}>
            {t('cancel')}
          </CancelButton>
          <PrimaryButton type="submit">{t('authLogin')}</PrimaryButton>
        </Actions>
      </StyledApp>
    </ThemeProvider>
  );
});
