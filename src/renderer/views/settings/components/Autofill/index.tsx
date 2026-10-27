import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { CaretRight, CreditCard, Key, MapPin } from '@phosphor-icons/react';

import store from '../../store';
import {
  ContextMenu,
  ContextMenuItem,
} from '~/renderer/components/ContextMenu';
import { Passwords } from './Passwords';
import {
  Control,
  Row,
  Title,
  SecondaryText,
  SettingCopy,
  SettingGroup,
  SettingGroupBlock,
  SettingIcon,
} from '../App/style';
import { ICON_TRASH } from '~/renderer/constants';
import {
  onSwitchChange,
  getSettingsTranslator,
} from '~/renderer/views/settings/utils';
import { Switch } from '~/renderer/components/Switch';
import type { SettingsSection } from '../../store';

const onRemoveClick = () => {
  const item = store.autoFill.selectedItem;
  store.autoFill.removeItem(item);
};

const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
  e.stopPropagation();
};

const Menu = observer(() => {
  const t = getSettingsTranslator();
  const style: any = {
    top: store.autoFill.menuTop,
    left: store.autoFill.menuLeft - 130,
    position: 'fixed',
  };

  return (
    <ContextMenu
      onMouseDown={onMouseDown}
      style={style}
      visible={store.autoFill.menuVisible}
    >
      <ContextMenuItem icon={ICON_TRASH} onClick={onRemoveClick}>
        {t('remove')}
      </ContextMenuItem>
    </ContextMenu>
  );
});

const AutofillSwitch = observer(() => {
  const t = getSettingsTranslator();
  const { autofill } = store.settings;
  return (
    <Row onClick={onSwitchChange('autofill')}>
      <SettingIcon tone="purple">
        <Key size={19} weight="fill" />
      </SettingIcon>
      <SettingCopy>
        <Title>{t('searchRememberPassword')}</Title>
      </SettingCopy>
      <Control>
        <Switch value={autofill} />
      </Control>
    </Row>
  );
});

const openSubPage = (section: SettingsSection) => () => {
  store.selectedSection = section;
};

// 对齐 Chrome「自动填充和密码」:密码管理 / 付款方式 / 地址及更多 三个入口。
const EntryRows = observer(() => {
  const t = getSettingsTranslator();
  const { cards, addresses, loaded } = store.autofillProfiles;
  return (
    <SettingGroupBlock>
      <SettingGroup>
        <Row onClick={openSubPage('payment-methods')}>
          <SettingIcon tone="green">
            <CreditCard size={19} weight="fill" />
          </SettingIcon>
          <SettingCopy>
            <Title>{t('autofillPaymentMethods')}</Title>
            <SecondaryText>
              {loaded && cards.length
                ? `${t('autofillPaymentMethodsDesc')} · ${cards.length}`
                : t('autofillPaymentMethodsDesc')}
            </SecondaryText>
          </SettingCopy>
          <CaretRight size={17} color="#B0B0BA" />
        </Row>
        <Row onClick={openSubPage('addresses')}>
          <SettingIcon tone="blue">
            <MapPin size={19} weight="fill" />
          </SettingIcon>
          <SettingCopy>
            <Title>{t('autofillAddressesMore')}</Title>
            <SecondaryText>
              {loaded && addresses.length
                ? `${t('autofillAddressesMoreDesc')} · ${addresses.length}`
                : t('autofillAddressesMoreDesc')}
            </SecondaryText>
          </SettingCopy>
          <CaretRight size={17} color="#B0B0BA" />
        </Row>
      </SettingGroup>
    </SettingGroupBlock>
  );
});

export const Autofill = () => {
  React.useEffect(() => {
    void store.autofillProfiles.load();
  }, []);

  return (
    <>
      <EntryRows />
      <SettingGroupBlock>
        <SettingGroup>
          <AutofillSwitch />
        </SettingGroup>
      </SettingGroupBlock>
      <Passwords />
      <Menu />
    </>
  );
};
