import * as React from 'react';

import {Header, Row, Title, Control, SecondaryText} from '../App/style';
import store from '../../store';
import { observer } from 'mobx-react-lite';
import { onSwitchChange } from '../../utils';
import { Switch } from '~/renderer/components/Switch';
import {NormalButton} from "~/renderer/views/settings/components/App";
import BrowsingDataDialog from "~/renderer/views/settings/components/Privacy/BrowsingDataDialog";
import AdblockManager from "~/renderer/views/settings/components/Privacy/AdblockManager";
import WhitelistManager from "~/renderer/views/settings/components/Privacy/WhitelistManager";
import AdRulesEditor from "~/renderer/views/settings/components/Privacy/AdRulesEditor";

const onClearBrowsingData = () => {
  store.dialogContent = 'privacy';
};

const DoNotTrackToggle = observer(() => {
  const { doNotTrack } = store.settings;

  return (
    <Row onClick={onSwitchChange('doNotTrack')}>
      <Title>
        Send a &quot;Do Not Track&quot; request with your browsing traffic
      </Title>
      <Control>
        <Switch value={doNotTrack} />
      </Control>
    </Row>
  );
});

const IncognitoThirdPartyCookieToggle = observer(() => {
  const { incognitoBlockThirdPartyCookies } = store.settings;

  return (
    <Row onClick={onSwitchChange('incognitoBlockThirdPartyCookies')}>
      <Title>无痕模式下阻止第三方 Cookie</Title>
      <Control>
        <Switch value={incognitoBlockThirdPartyCookies} />
      </Control>
    </Row>
  );
});

export const Privacy = observer(() => {
  const adblockEnabled = store.settings.shield;

  return (
    <>
      <Header>拦截保护</Header>
      <Row style={{ cursor: 'default' }}>
        <div>
          <Title>广告拦截</Title>
          <SecondaryText>订阅 ublock、adblockplus、adguard 格式规则，自动过滤网页广告</SecondaryText>
        </div>
        <Control>
          <Switch
            value={adblockEnabled}
            onClick={onSwitchChange('shield')}
          />
        </Control>
      </Row>

      {adblockEnabled && (
        <>
          <AdblockManager/>

          <WhitelistManager/>

          <AdRulesEditor/>
        </>
      )}

      <Row>
        <div>
          <Title>浏览数据</Title>
        </div>
        <Control>
          <NormalButton onClick={onClearBrowsingData}>清除</NormalButton>
        </Control>
      </Row>
      <BrowsingDataDialog/>
      <DoNotTrackToggle />
      <IncognitoThirdPartyCookieToggle />
    </>
  );
});
