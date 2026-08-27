import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';
import { Bluetooth as BluetoothIcon } from '@phosphor-icons/react';

import {
  StyledApp,
  Header,
  HeaderMain,
  Eyebrow,
  Title,
  Domain,
  IconBadge,
  DeviceList,
  DeviceItem,
  DeviceMain,
  DeviceName,
  DeviceId,
  Empty,
  Footer,
  Buttons,
  ActionButton,
} from './style';
import store, {
  selectDevice,
  ensureSelectionValid,
  submit,
  cancel,
} from '../../store';
import { UIStyle } from '~/renderer/mixins/default-styles';

export const App = observer(() => {
  const listRef = React.useRef<HTMLDivElement>(null);

  // 已选设备在扫描推送中消失时清空选中,保持「连接」按钮状态正确。
  React.useEffect(() => {
    ensureSelectionValid();
  }, [store.devices.length]);

  // 新设备追加时滚动到列表底部,露出最新发现的项。
  React.useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [store.devices.length]);

  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <StyledApp>
        <UIStyle />
        <Header>
          <IconBadge>
            <BluetoothIcon size={20} weight="bold" />
          </IconBadge>
          <HeaderMain>
            <Eyebrow>蓝牙</Eyebrow>
            <Title>选择蓝牙设备</Title>
            <Domain>{store.domain}</Domain>
          </HeaderMain>
        </Header>

        <DeviceList ref={listRef}>
          {store.devices.length === 0 && (
            <Empty>正在搜索附近的蓝牙设备，请确认设备已开启…</Empty>
          )}
          {store.devices.map((device) => (
            <DeviceItem
              key={device.deviceId}
              selected={store.selectedId === device.deviceId}
              onClick={() => selectDevice(device.deviceId)}
              onDoubleClick={() => {
                selectDevice(device.deviceId);
                submit();
              }}
            >
              <BluetoothIcon size={16} weight="fill" />
              <DeviceMain>
                <DeviceName>{device.deviceName || '未知设备'}</DeviceName>
                <DeviceId>{device.deviceId}</DeviceId>
              </DeviceMain>
            </DeviceItem>
          ))}
        </DeviceList>

        <Footer>
          <Buttons>
            <ActionButton
              variant="primary"
              disabled={!store.selectedId}
              onClick={submit}
            >
              连接
            </ActionButton>
            <ActionButton variant="secondary" onClick={cancel}>
              取消
            </ActionButton>
          </Buttons>
        </Footer>
      </StyledApp>
    </ThemeProvider>
  );
});
