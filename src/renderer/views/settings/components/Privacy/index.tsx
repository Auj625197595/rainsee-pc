import * as React from 'react';
import { ShieldCheck } from '@phosphor-icons/react';

import {
  Row,
  Title,
  Control,
  SecondaryText,
  SettingCopy,
  SettingGroup,
  SettingGroupBlock,
  SettingIcon,
} from '../App/style';
import store from '../../store';
import { observer } from 'mobx-react-lite';
import { onSwitchChange, getSettingsTranslator } from '../../utils';
import { Switch } from '~/renderer/components/Switch';
import AdblockManager from '~/renderer/views/settings/components/Privacy/AdblockManager';
import WhitelistManager from '~/renderer/views/settings/components/Privacy/WhitelistManager';
import AdRulesEditor from '~/renderer/views/settings/components/Privacy/AdRulesEditor';

export const Privacy = observer(() => {
  const t = getSettingsTranslator();
  const adblockEnabled = store.settings.shield;

  return (
    <>
      <SettingGroupBlock>
        <SettingGroup>
          <Row style={{ cursor: 'default' }}>
            <SettingIcon tone="blue">
              <ShieldCheck size={19} weight="fill" />
            </SettingIcon>
            <SettingCopy>
              <Title>{t('pvAdblock')}</Title>
              <SecondaryText>{t('pvAdblockDesc')}</SecondaryText>
            </SettingCopy>
            <Control>
              <Switch
                value={adblockEnabled}
                onClick={onSwitchChange('shield')}
              />
            </Control>
          </Row>
        </SettingGroup>
      </SettingGroupBlock>

      {adblockEnabled && (
        <>
          <AdblockManager />

          <WhitelistManager />

          <AdRulesEditor />
        </>
      )}
    </>
  );
});
