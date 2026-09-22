export type DeviceStatus = 'online' | 'offline' | 'idle' | 'unknown';

export interface ConnectedDevice {
  mac: string;
  ip: string;
  hostname: string;
  status: DeviceStatus;
  leaseExpiresAt?: string | null | undefined;
  interface?: string | null | undefined;
}

export interface GetDevicesResponse {
  status: 'ok';
  count: number;
  devices: ConnectedDevice[];
}
