import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { Globe, Warning } from '@phosphor-icons/react';

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
import { NormalButton } from '../App';
import {ipcRenderer} from '~/common/renderer-ipc';
import { getSettingsTranslator } from '../../utils';

interface IStatus {
  isDefault: boolean;
  supported: boolean;
  platform: string;
}

export const DefaultBrowser = observer(() => {
  const t = getSettingsTranslator();
  const [status, setStatus] = React.useState<IStatus | null>(null);
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      const s = await ipcRenderer.invoke('get-default-browser-status');
      setStatus(s);
    } catch (e) {
      setStatus(null);
    }
  }, []);

  React.useEffect(() => {
    refresh();

    // 用户从系统设置切回窗口时,重新查询一次状态。
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const onSetDefault = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await ipcRenderer.invoke('set-as-default-browser');
      // 给系统注册/设置页一点时间,再刷新状态。
      setTimeout(refresh, 800);
    } finally {
      setBusy(false);
    }
  };

  const isDefault = status?.isDefault;
  const supported = status ? status.supported : true;

  return (
    <SettingGroupBlock>
      <SettingGroup>
        <Row style={{ cursor: 'default' }}>
          <SettingIcon tone="cyan">
            <Globe size={19} weight="fill" />
          </SettingIcon>
          <SettingCopy>
            <Title>{isDefault ? t('dbIsDefault') : t('dbNotDefault')}</Title>
            <SecondaryText>
              {isDefault ? t('dbIsDefaultDesc') : t('dbNotDefaultDesc')}
            </SecondaryText>
          </SettingCopy>
          <Control>
            {isDefault ? (
              <NormalButton variant="soft" onClick={refresh}>
                {t('dbAlreadyDefault')}
              </NormalButton>
            ) : (
              <NormalButton
                variant="soft"
                onClick={onSetDefault}
                disabled={busy}
              >
                {busy ? t('dbSetting') : t('dbSetDefault')}
              </NormalButton>
            )}
          </Control>
        </Row>
        {!supported && (
          <Row style={{ cursor: 'default' }}>
            <SettingIcon tone="orange">
              <Warning size={19} weight="fill" />
            </SettingIcon>
            <SettingCopy>
              <SecondaryText>{t('dbDevModeNote')}</SecondaryText>
            </SettingCopy>
          </Row>
        )}
      </SettingGroup>
    </SettingGroupBlock>
  );
});
