import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';
import { Question, Keyboard } from '@phosphor-icons/react';
import store, { selectDevice, submit, cancel } from '../../store';
import { useI18n } from '~/renderer/components/I18n';
import { UIStyle } from '~/renderer/mixins/default-styles';
import {
  StyledApp,
  Header,
  Title,
  DeviceList,
  DeviceItem,
  DeviceIcon,
  DeviceMain,
  DeviceName,
  DeviceMeta,
  Empty,
  Footer,
  HelpButton,
  Buttons,
  ActionButton,
} from './style';

const hex = (value: number) => `0x${value.toString(16).padStart(4, '0').toUpperCase()}`;

export const App = observer(() => {
  const t = useI18n();
  return (
    <ThemeProvider theme={{ ...store.theme }}>
    <StyledApp>
      <UIStyle />
      <Header>
        <Title>
        {t('hidWantsConnect', {
          site: store.domain || t('dcSite'),
          type:
            store.deviceType === 'usb'
              ? t('hidTypeUsb')
              : store.deviceType === 'serial'
                ? t('hidTypeSerial')
                : t('hidTypeHid'),
        })}
      </Title>
      </Header>
      <DeviceList role="listbox" aria-label={t('hidDevicesAria', { type: store.deviceType.toUpperCase() })}>
        {store.devices.length === 0 && <Empty>{t('hidNoDevices')}</Empty>}
        {store.devices.map((device) => (
          <DeviceItem
            key={device.deviceId}
            role="option"
            aria-selected={store.selectedId === device.deviceId}
            selected={store.selectedId === device.deviceId}
            onMouseDown={() => selectDevice(device.deviceId)}
            onClick={() => selectDevice(device.deviceId)}
            onDoubleClick={() => {
              selectDevice(device.deviceId);
              submit();
            }}
          >
            <DeviceIcon><Keyboard size={20} weight="regular" /></DeviceIcon>
            <DeviceMain>
              <DeviceName>{device.name || t('hidUnknownDevice')}</DeviceName>
              {(device.vendorId > 0 || device.productId > 0) && (
                <DeviceMeta>VID {hex(device.vendorId)} · PID {hex(device.productId)}</DeviceMeta>
              )}
            </DeviceMain>
          </DeviceItem>
        ))}
      </DeviceList>
      <Footer>

        <Buttons>
          <ActionButton type="button" disabled={!store.selectedId} onClick={submit}>{t('btConnect')}</ActionButton>
          <ActionButton type="button" cancel onClick={cancel}>{t('cancel')}</ActionButton>
        </Buttons>
      </Footer>
    </StyledApp>
    </ThemeProvider>
  );
});
