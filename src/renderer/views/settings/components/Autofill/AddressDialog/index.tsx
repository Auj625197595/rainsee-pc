import * as React from 'react';
import { observer } from 'mobx-react-lite';

import { NormalButton } from '../../App';
import store from '../../../store';
import { Textfield } from '~/renderer/components/Textfield';
import { Dropdown } from '~/renderer/components/Dropdown';
import { Row } from '../../App/style';
import { Dialog, Title, Content, Buttons, CloseButton } from '../../Dialog';
import { getSettingsTranslator } from '../../../utils';

export default observer(() => {
  const t = getSettingsTranslator();
  return (
    <Dialog
      visible={store.dialogContent === 'edit-address'}
      style={{ width: 344 }}
    >
      <Title>Edit address</Title>
      <Content>
        <Textfield label={t('afName')} />
        <Textfield label={t('afStreet')} />
        <Row>
          <Textfield label={t('afZip')} style={{ marginRight: 24 }} />
          <Textfield label={t('afCity')} />
        </Row>
        <Dropdown>
          <Dropdown.Item value="pl">Poland</Dropdown.Item>
        </Dropdown>
      </Content>
      <Buttons>
        <CloseButton />
        <NormalButton>{t('save')}</NormalButton>
      </Buttons>
    </Dialog>
  );
});
