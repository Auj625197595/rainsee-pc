export interface IHidDevice {
  deviceId: string;
  name: string;
  vendorId: number;
  productId: number;
  serialNumber?: string;
}

export interface IHidRequestInfo {
  url: string;
  devices: IHidDevice[];
  deviceType?: 'hid' | 'usb' | 'serial';
}
