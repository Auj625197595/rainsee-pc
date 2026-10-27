import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ArrowLeft, MapPin, PencilSimple, Trash } from '@phosphor-icons/react';

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
  SeInput,
  SettingCopy,
  SettingGroup,
  SettingGroupBlock,
  SettingIcon,
  Title,
} from '../../App/style';
import { Switch } from '~/renderer/components/Switch';
import { getSettingsTranslator, onSwitchChange } from '../../../utils';
import type { MessageKey } from '~/common/i18n';
import { IAddressFields, IAddressProfile } from '~/interfaces';
import {
  ActionButton,
  BackButton,
  EditDialog,
  EmptyState,
  FieldError,
  FieldRow,
  FormScroll,
  ItemActions,
  ListHeader,
  SubHeader,
} from '../shared';

type FieldKey = keyof IAddressFields;

const LABELS: Record<FieldKey, MessageKey> = {
  country: 'autofillCountry',
  name: 'autofillName',
  organization: 'autofillOrganization',
  state: 'autofillState',
  city: 'autofillCity',
  street: 'autofillStreet',
  postCode: 'autofillPostCode',
  phone: 'autofillPhone',
  email: 'autofillEmail',
};

// 布局:单列或两列一行,顺序对齐 Chrome 中国大陆地址表单。
const LAYOUT: FieldKey[][] = [
  ['country'],
  ['name'],
  ['organization'],
  ['state', 'city'],
  ['street'],
  ['postCode'],
  ['phone', 'email'],
];

const INPUT_PROPS: Partial<Record<FieldKey, React.InputHTMLAttributes<HTMLInputElement>>> = {
  phone: { type: 'tel', inputMode: 'tel' },
  email: { type: 'email', inputMode: 'email' },
  postCode: { inputMode: 'numeric' },
};

const summaryOf = (fields: IAddressFields) =>
  [fields.state, fields.city, fields.street].filter(Boolean).join(' ') ||
  fields.phone ||
  fields.email ||
  '';

const onBack = () => {
  store.selectedSection = 'autofill';
};

const openEditor = (address: IAddressProfile | null) => {
  store.autofillProfiles.editingAddress = address;
  store.dialogContent = 'edit-address';
};

const closeEditor = () => {
  store.dialogContent = null;
  store.autofillProfiles.editingAddress = null;
};

const AddressDialog = observer(() => {
  const t = getSettingsTranslator();
  const visible = store.dialogContent === 'edit-address';
  const editing = store.autofillProfiles.editingAddress;
  const [fields, setFields] = React.useState<IAddressFields>({});
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!visible) return;
    const isZh = (store.settings.language || '').startsWith('zh') ||
      (store.settings.language === 'auto' && navigator.language.startsWith('zh'));
    setFields(editing ? { ...editing.fields } : { country: isZh ? '中国' : '' });
    setError('');
    setSaving(false);
  }, [visible, editing]);

  const update = (key: FieldKey) => (
    e: React.ChangeEvent<any>,
  ) => {
    const value = e.target.value;
    setFields((prev) => ({ ...prev, [key]: value }));
    setError('');
  };

  const onSave = async () => {
    if (saving) return;
    const hasContent = (Object.keys(LABELS) as FieldKey[]).some(
      (key) => key !== 'country' && (fields[key] || '').trim(),
    );
    if (!hasContent) {
      setError(t('autofillAddressEmpty'));
      return;
    }
    setSaving(true);
    try {
      const res = await store.autofillProfiles.saveAddress(editing?._id, fields);
      if (res?.ok) closeEditor();
      else setError(t('autofillSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const renderField = (key: FieldKey) => (
    <SeField key={key}>
      <SeFieldLabel>{t(LABELS[key])}</SeFieldLabel>
      {key === 'street' ? (
        <SeInput
          as="textarea"
          rows={2}
          value={fields[key] || ''}
          maxLength={1024}
          onChange={update(key)}
          style={{ height: 64, padding: '10px 14px', resize: 'none', lineHeight: 1.5 }}
        />
      ) : (
        <SeInput
          value={fields[key] || ''}
          maxLength={512}
          autoComplete="off"
          spellCheck={false}
          onChange={update(key)}
          {...INPUT_PROPS[key]}
        />
      )}
    </SeField>
  );

  return (
    <EditDialog visible={visible} onClose={closeEditor} width={480}>
      <SeDialogHeader>
        <SeDialogIcon>
          <MapPin size={22} weight="bold" />
        </SeDialogIcon>
        <div>
          <SeDialogHeading>
            {editing ? t('autofillEditAddress') : t('autofillAddAddress')}
          </SeDialogHeading>
          <SeDialogSub>{t('autofillAddressesToggleDesc')}</SeDialogSub>
        </div>
      </SeDialogHeader>
      <FormScroll>
        <SeFieldGroup>
          {LAYOUT.map((row) =>
            row.length === 1 ? (
              renderField(row[0])
            ) : (
              <FieldRow key={row.join('-')}>{row.map(renderField)}</FieldRow>
            ),
          )}
        </SeFieldGroup>
      </FormScroll>
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

const AddressRow = observer(({ address }: { address: IAddressProfile }) => {
  const t = getSettingsTranslator();
  const { fields } = address;
  const title = [fields.name, fields.phone].filter(Boolean).join('  ') || summaryOf(fields);

  const onDelete = async () => {
    if (!window.confirm(t('autofillDeleteConfirm'))) return;
    await store.autofillProfiles.remove(address._id || '');
  };

  return (
    <Row style={{ cursor: 'default' }}>
      <SettingIcon tone="blue">
        <MapPin size={19} weight="fill" />
      </SettingIcon>
      <SettingCopy>
        <Title>{title}</Title>
        <SecondaryText>{summaryOf(fields)}</SecondaryText>
      </SettingCopy>
      <ItemActions>
        <ActionButton
          type="button"
          title={t('edit')}
          aria-label={t('edit')}
          onClick={() => openEditor(address)}
        >
          <PencilSimple size={17} />
        </ActionButton>
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

export const AddressesPage = observer(() => {
  const t = getSettingsTranslator();
  const { addresses, loaded } = store.autofillProfiles;

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
          <Row onClick={onSwitchChange('autofillAddresses')}>
            <SettingCopy>
              <Title>{t('autofillAddressesToggle')}</Title>
              <SecondaryText>{t('autofillAddressesToggleDesc')}</SecondaryText>
            </SettingCopy>
            <Control>
              <Switch value={store.settings.autofillAddresses} />
            </Control>
          </Row>
        </SettingGroup>
      </SettingGroupBlock>
      <ListHeader>
        <span>{t('autofillAddressesLabel')}</span>
        <NormalButton variant="soft" onClick={() => openEditor(null)}>
          {t('add')}
        </NormalButton>
      </ListHeader>
      <SettingGroup>
        {addresses.map((address) => (
          <AddressRow key={address._id} address={address} />
        ))}
        {loaded && addresses.length === 0 && (
          <EmptyState>
            <strong>{t('autofillNoAddresses')}</strong>
            {t('autofillNoAddressesHint')}
          </EmptyState>
        )}
      </SettingGroup>
      <AddressDialog />
    </>
  );
});
