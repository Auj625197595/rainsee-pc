import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { Check, CreditCard, MapPin, X } from '@phosphor-icons/react';
import styled, { ThemeProvider } from 'styled-components';

import store from '../../store';
import { ITheme } from '~/interfaces';
import {
  StyledApp,
  Header,
  HeaderIcon,
  HeaderText,
  Title,
  Subtitle,
  Buttons,
  PrimaryButton,
  SecondaryButton,
} from '~/renderer/views/credentials/components/App/style';
import { UIStyle } from '~/renderer/mixins/default-styles';
import { useI18n } from '~/renderer/components/I18n';

const isDark = (theme?: ITheme) =>
  Boolean(theme?.dark || theme?.['dialog.lightForeground']);

const Summary = styled.div`
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.55;
  background: ${({ theme }: { theme?: ITheme }) =>
    isDark(theme) ? 'rgba(255, 255, 255, 0.06)' : '#f2f5f9'};
`;

const SummaryLine = styled.div`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const SummaryStrong = styled(SummaryLine)`
  font-weight: 600;
`;

const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: ${({ theme }: { theme?: ITheme }) =>
    isDark(theme) ? 'rgba(236, 240, 247, 0.62)' : '#6e7789'};
`;

const Input = styled.input`
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
  outline: none;
  color: inherit;
  border: 1px solid
    ${({ theme }: { theme?: ITheme }) =>
      isDark(theme) ? 'rgba(255, 255, 255, 0.14)' : '#dce2eb'};
  background: ${({ theme }: { theme?: ITheme }) =>
    isDark(theme) ? 'rgba(255, 255, 255, 0.055)' : '#fff'};

  &:focus {
    border-color: #397ed0;
  }
`;

const Fields = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
`;

const NETWORK_LABELS: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  unionpay: 'UnionPay',
  jcb: 'JCB',
  discover: 'Discover',
  diners: 'Diners Club',
};

const AddressSummary = observer(() => {
  const a = store.data?.address || {};
  const region = [a.country, a.state, a.city].filter(Boolean).join(' ');
  return (
    <Summary>
      {(a.name || a.phone) && (
        <SummaryStrong>{[a.name, a.phone].filter(Boolean).join('  ')}</SummaryStrong>
      )}
      {region && <SummaryLine>{region}</SummaryLine>}
      {a.street && <SummaryLine title={a.street}>{a.street}</SummaryLine>}
      {a.email && <SummaryLine>{a.email}</SummaryLine>}
    </Summary>
  );
});

const CardSummary = observer(() => {
  const t = useI18n();
  const c = store.data?.card;
  if (!c) return null;
  const network = NETWORK_LABELS[c.network] || '';
  const exp = c.expMonth && c.expYear ? `${c.expMonth}/${c.expYear.slice(-2)}` : '';
  return (
    <Fields>
      <Summary>
        <SummaryStrong>{`${network} •••• ${c.last4}`.trim()}</SummaryStrong>
        {exp && <SummaryLine>{`${t('autofillCardExpiry')} ${exp}`}</SummaryLine>}
      </Summary>
      <Field>
        {t('autofillCardHolder')}
        <Input
          value={store.holderName}
          maxLength={128}
          onChange={(e) => (store.holderName = e.target.value)}
        />
      </Field>
      <Field>
        {t('autofillCardNickname')}
        <Input
          value={store.nickname}
          maxLength={64}
          onChange={(e) => (store.nickname = e.target.value)}
        />
      </Field>
    </Fields>
  );
});

export const App = observer(() => {
  const t = useI18n();
  const data = store.data;
  const isCard = data?.kind === 'card';
  const title = isCard
    ? t('autofillSaveCardTitle')
    : data?.update
      ? t('autofillUpdateAddressTitle')
      : t('autofillSaveAddressTitle');

  return (
    <ThemeProvider
      theme={{ ...store.theme, dark: !!store.theme['dialog.lightForeground'] }}
    >
      <StyledApp>
        <UIStyle />
        <Header>
          <HeaderIcon aria-hidden="true">
            {isCard ? (
              <CreditCard size={18} weight="bold" />
            ) : (
              <MapPin size={18} weight="bold" />
            )}
          </HeaderIcon>
          <HeaderText>
            <Title>{title}</Title>
            <Subtitle>
              {isCard ? t('autofillSaveCardHint') : t('autofillSaveAddressHint')}
            </Subtitle>
          </HeaderText>
        </Header>
        {data && (isCard ? <CardSummary /> : <AddressSummary />)}
        <Buttons style={{ marginTop: 'auto' }}>
          <PrimaryButton onClick={() => store.save()} type="button">
            <Check size={15} weight="bold" />
            {t('autofillSave')}
          </PrimaryButton>
          <SecondaryButton onClick={() => store.dismiss()} type="button">
            <X size={15} weight="bold" />
            {t('autofillNoThanks')}
          </SecondaryButton>
        </Buttons>
      </StyledApp>
    </ThemeProvider>
  );
});
