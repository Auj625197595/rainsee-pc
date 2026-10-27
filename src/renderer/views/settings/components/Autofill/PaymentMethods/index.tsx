import * as React from 'react';
import { observer } from 'mobx-react-lite';
import {
  ArrowLeft,
  CreditCard,
  Eye,
  EyeSlash,
  PencilSimple,
  Trash,
} from '@phosphor-icons/react';

import store from '../../../store';
import { NormalButton } from '../../App';
import {
  Control,
  Row,
  SecondaryText,
  SeDialogFooter,
  SeDialogHeader,
  SeDialogHeading,
  SeDialogIcon,
  SeDialogSub,
  SeField,
  SeFieldGroup,
  SeFieldLabel,
  SeHint,
  SeInput,
  SettingCopy,
  SettingGroup,
  SettingGroupBlock,
  SettingIcon,
  Title,
} from '../../App/style';
import { Switch } from '~/renderer/components/Switch';
import { getSettingsTranslator, onSwitchChange } from '../../../utils';
import { CardNetwork, ICardSummary } from '~/interfaces';
import {
  ActionButton,
  BackButton,
  EditDialog,
  EmptyState,
  FieldError,
  FieldRow,
  ItemActions,
  ListHeader,
  NumberWrap,
  SubHeader,
} from '../shared';

const NETWORK_LABELS: Record<CardNetwork, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  unionpay: 'UnionPay',
  jcb: 'JCB',
  discover: 'Discover',
  diners: 'Diners Club',
  unknown: '',
};

const NETWORK_COLORS: Record<CardNetwork, string> = {
  visa: '#1a1f71',
  mastercard: '#eb001b',
  amex: '#2e77bc',
  unionpay: '#d7121f',
  jcb: '#0b7c3e',
  discover: '#f58220',
  diners: '#0079be',
  unknown: '#6b7280',
};

const luhnValid = (num: string) => {
  if (!/^\d{12,19}$/.test(num)) return false;
  let sum = 0;
  let double = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let digit = num.charCodeAt(i) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
};

const groupDigits = (value: string) =>
  value
    .replace(/\D/g, '')
    .slice(0, 19)
    .replace(/(\d{4})(?=\d)/g, '$1 ');

const isExpired = (card: ICardSummary) => {
  if (!card.expMonth || !card.expYear) return false;
  const now = new Date();
  const year = Number(card.expYear);
  const month = Number(card.expMonth);
  return year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1);
};

const cardTitle = (card: ICardSummary) => {
  const head = card.nickname || NETWORK_LABELS[card.network] || '';
  return `${head} •••• ${card.last4}`.trim();
};

const onBack = () => {
  store.selectedSection = 'autofill';
};

const openEditor = (card: ICardSummary | null) => {
  store.autofillProfiles.editingCard = card;
  store.dialogContent = 'edit-card';
};

const closeEditor = () => {
  store.dialogContent = null;
  store.autofillProfiles.editingCard = null;
};

const CardDialog = observer(() => {
  const t = getSettingsTranslator();
  const visible = store.dialogContent === 'edit-card';
  const editing = store.autofillProfiles.editingCard;
  const [number, setNumber] = React.useState('');
  const [revealed, setRevealed] = React.useState(false);
  const [expMonth, setExpMonth] = React.useState('');
  const [expYear, setExpYear] = React.useState('');
  const [holderName, setHolderName] = React.useState('');
  const [nickname, setNickname] = React.useState('');
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!visible) return;
    setNumber('');
    setRevealed(false);
    setExpMonth(editing?.expMonth || '');
    setExpYear(editing?.expYear || '');
    setHolderName(editing?.holderName || '');
    setNickname(editing?.nickname || '');
    setError('');
    setSaving(false);
  }, [visible, editing]);

  const years = React.useMemo(() => {
    const start = new Date().getFullYear();
    const list: string[] = [];
    for (let y = start; y <= start + 15; y++) list.push(String(y));
    if (editing?.expYear && !list.includes(editing.expYear)) list.unshift(editing.expYear);
    return list;
  }, [editing]);

  const toggleReveal = async () => {
    if (!editing) return;
    if (revealed) {
      setNumber('');
      setRevealed(false);
      return;
    }
    setError('');
    const res = await store.autofillProfiles.revealCard(editing._id);
    if (res?.ok) {
      setNumber(groupDigits(res.number));
      setRevealed(true);
    } else if (res?.msg) {
      setError(res.msg);
    }
  };

  const digits = number.replace(/\D/g, '');
  const numberInvalid = !!digits && !luhnValid(digits);

  const onSave = async () => {
    if (saving) return;
    if (!editing && !digits) {
      setError(t('autofillCardInvalid'));
      return;
    }
    if (numberInvalid) {
      setError(t('autofillCardInvalid'));
      return;
    }
    setSaving(true);
    try {
      const res = await store.autofillProfiles.saveCard({
        _id: editing?._id,
        // 编辑时卡号留空则不回传,主进程保留原密文
        number: digits || undefined,
        expMonth,
        expYear,
        holderName,
        nickname,
      });
      if (res?.ok) closeEditor();
      else setError(res?.msg || t('autofillSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <EditDialog visible={visible} onClose={closeEditor} width={440}>
      <SeDialogHeader>
        <SeDialogIcon>
          <CreditCard size={22} weight="bold" />
        </SeDialogIcon>
        <div>
          <SeDialogHeading>
            {editing ? t('autofillEditCard') : t('autofillAddCard')}
          </SeDialogHeading>
          <SeDialogSub>{t('autofillPaymentsToggleDesc')}</SeDialogSub>
        </div>
      </SeDialogHeader>
      <SeFieldGroup>
        <SeField>
          <SeFieldLabel>{t('autofillCardNumber')}</SeFieldLabel>
          <NumberWrap>
            <SeInput
              value={number}
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              placeholder={editing ? `•••• •••• •••• ${editing.last4}` : '0000 0000 0000 0000'}
              aria-invalid={numberInvalid}
              onChange={(e) => {
                setNumber(groupDigits(e.target.value));
                setError('');
              }}
            />
            {editing && !editing.undecryptable && (
              <ActionButton
                type="button"
                title={revealed ? t('autofillCardHideNumber') : t('autofillCardShowNumber')}
                aria-label={revealed ? t('autofillCardHideNumber') : t('autofillCardShowNumber')}
                onClick={toggleReveal}
              >
                {revealed ? <EyeSlash size={18} /> : <Eye size={18} />}
              </ActionButton>
            )}
          </NumberWrap>
          {editing && !revealed && <SeHint>{t('autofillCardNumberKeep')}</SeHint>}
        </SeField>
        <SeField as="div">
          <SeFieldLabel>{t('autofillCardExpiry')}</SeFieldLabel>
          <FieldRow>
            <SeInput
              as="select"
              value={expMonth}
              aria-label={t('autofillCardExpiryMonth')}
              onChange={(e: React.ChangeEvent<any>) => setExpMonth(e.target.value)}
            >
              <option value="">{t('autofillCardExpiryMonth')}</option>
              {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map(
                (m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ),
              )}
            </SeInput>
            <SeInput
              as="select"
              value={expYear}
              aria-label={t('autofillCardExpiryYear')}
              onChange={(e: React.ChangeEvent<any>) => setExpYear(e.target.value)}
            >
              <option value="">{t('autofillCardExpiryYear')}</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </SeInput>
          </FieldRow>
        </SeField>
        <SeField>
          <SeFieldLabel>{t('autofillCardHolder')}</SeFieldLabel>
          <SeInput
            value={holderName}
            maxLength={128}
            autoComplete="off"
            onChange={(e) => setHolderName(e.target.value)}
          />
        </SeField>
        <SeField>
          <SeFieldLabel>{t('autofillCardNickname')}</SeFieldLabel>
          <SeInput
            value={nickname}
            maxLength={64}
            autoComplete="off"
            placeholder={t('autofillCardNicknameHint')}
            onChange={(e) => setNickname(e.target.value)}
          />
        </SeField>
      </SeFieldGroup>
      {error && <FieldError role="alert">{error}</FieldError>}
      <SeDialogFooter>
        <NormalButton variant="soft" onClick={closeEditor}>
          {t('cancel')}
        </NormalButton>
        <NormalButton onClick={onSave} disabled={saving}>
          {t('save')}
        </NormalButton>
      </SeDialogFooter>
    </EditDialog>
  );
});

const CardRow = observer(({ card }: { card: ICardSummary }) => {
  const t = getSettingsTranslator();
  const expired = isExpired(card);
  const exp =
    card.expMonth && card.expYear ? `${card.expMonth}/${card.expYear.slice(-2)}` : '';
  const sub = card.undecryptable
    ? t('autofillCardUndecryptable')
    : [card.holderName, exp && (expired ? t('autofillCardExpired') : t('autofillCardExpires', { date: exp }))]
        .filter(Boolean)
        .join(' · ');

  const onDelete = async () => {
    if (!window.confirm(t('autofillDeleteConfirm'))) return;
    await store.autofillProfiles.remove(card._id);
  };

  return (
    <Row style={{ cursor: 'default' }}>
      <SettingIcon tone="green" style={{ color: NETWORK_COLORS[card.network] }}>
        <CreditCard size={19} weight="fill" />
      </SettingIcon>
      <SettingCopy>
        <Title>{cardTitle(card)}</Title>
        {sub && (
          <SecondaryText style={card.undecryptable || expired ? { color: '#e5484d' } : undefined}>
            {sub}
          </SecondaryText>
        )}
      </SettingCopy>
      <ItemActions>
        {!card.undecryptable && (
          <ActionButton
            type="button"
            title={t('edit')}
            aria-label={t('edit')}
            onClick={() => openEditor(card)}
          >
            <PencilSimple size={17} />
          </ActionButton>
        )}
        <ActionButton
          type="button"
          $danger
          title={t('delete')}
          aria-label={t('delete')}
          onClick={onDelete}
        >
          <Trash size={17} />
        </ActionButton>
      </ItemActions>
    </Row>
  );
});

export const PaymentMethods = observer(() => {
  const t = getSettingsTranslator();
  const { cards, loaded } = store.autofillProfiles;

  React.useEffect(() => {
    void store.autofillProfiles.load();
  }, []);

  return (
    <>
      <SubHeader>
        <BackButton type="button" aria-label={t('autofill')} onClick={onBack}>
          <ArrowLeft size={18} weight="bold" />
        </BackButton>
        {t('autofill')}
      </SubHeader>
      <SettingGroupBlock>
        <SettingGroup>
          <Row onClick={onSwitchChange('autofillPayments')}>
            <SettingCopy>
              <Title>{t('autofillPaymentsToggle')}</Title>
              <SecondaryText>{t('autofillPaymentsToggleDesc')}</SecondaryText>
            </SettingCopy>
            <Control>
              <Switch value={store.settings.autofillPayments} />
            </Control>
          </Row>
        </SettingGroup>
      </SettingGroupBlock>
      <ListHeader>
        <span>{t('autofillCardsLabel')}</span>
        <NormalButton variant="soft" onClick={() => openEditor(null)}>
          {t('add')}
        </NormalButton>
      </ListHeader>
      <SettingGroup>
        {cards.map((card) => (
          <CardRow key={card._id} card={card} />
        ))}
        {loaded && cards.length === 0 && (
          <EmptyState>
            <strong>{t('autofillNoCards')}</strong>
            {t('autofillNoCardsHint')}
          </EmptyState>
        )}
      </SettingGroup>
      <CardDialog />
    </>
  );
});
