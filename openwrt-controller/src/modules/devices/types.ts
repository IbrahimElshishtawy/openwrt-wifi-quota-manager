export interface Device {
  id: string;
  mac: string;
  ip: string | null;
  hostname: string | null;
  interface: string | null;
  connected: boolean;
  rxBytes: number;
  txBytes: number;
}

export interface DevicesApiResponse {
  success: boolean;
  data: Device[];
  devices: Device[];
  count: number;
}

// Aliases for backward compatibility
export type ConnectedDevice = Device;
export type GetDevicesResponse = DevicesApiResponse;
export type DeviceStatus = 'online' | 'offline' | 'idle' | 'unknown';
