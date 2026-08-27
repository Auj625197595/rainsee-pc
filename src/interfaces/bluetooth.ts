export interface IBluetoothDevice {
  deviceId: string;
  deviceName: string;
}

export interface IBluetoothRequestInfo {
  url: string;
  devices: IBluetoothDevice[];
}
