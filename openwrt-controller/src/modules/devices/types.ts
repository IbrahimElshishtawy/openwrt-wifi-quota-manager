import type { LanSubnet } from './utils/network.utils.js';

export type { LanSubnet } from './utils/network.utils.js';

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

export interface InfrastructureMetadata {
  excludedIps: Set<string>;
  excludedMacs: Set<string>;
  excludedHostnames: Set<string>;
  wanDevices: Set<string>;
  lanSubnets: LanSubnet[];
}

export interface CandidateDevice {
  mac: string;
  ip: string | null;
  hostname: string | null;
  interface: string | null;
  leaseExpires?: number;
  neighState?: string;
}

export interface LuciDhcpLeasesResult {
  dhcp_leases?: Array<{
    macaddr?: string;
    ipaddr?: string;
    hostname?: string;
    expires?: number;
  }>;
  dhcp6_leases?: Array<{
    macaddr?: string;
    ip6addr?: string;
    hostname?: string;
    expires?: number;
  }>;
}

export type LuciHostHintsResult = Record<
  string,
  {
    ipaddrs?: string[];
    ip6addrs?: string[];
    name?: string;
  }
>;

export interface FileExecResult {
  code: number;
  stdout?: string;
  stderr?: string;
}

export interface NetworkInterfaceDump {
  interface?: Array<{
    interface?: string;
    l3_device?: string;
    device?: string;
    proto?: string;
    'ipv4-address'?: Array<{ address: string; mask: number }>;
    route?: Array<{ target: string; mask: number; nexthop?: string; source?: string }>;
    data?: { dhcpserver?: string };
  }>;
}

export type LuciNetworkDevices = Record<
  string,
  {
    mac?: string;
    ipaddrs?: Array<{ address: string }>;
    name?: string;
  }
>;

export class DeviceFetchError extends Error {
  public readonly statusCode = 502;
  public readonly code = 'DEVICE_FETCH_ERROR';

  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'DeviceFetchError';
  }
}

// Aliases for backward compatibility
export type ConnectedDevice = Device;
export type GetDevicesResponse = DevicesApiResponse;
export type DeviceStatus = 'online' | 'offline' | 'idle' | 'unknown';
