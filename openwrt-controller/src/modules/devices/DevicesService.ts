import {
  ubusClient,
  OpenWrtNotConfiguredError,
  OpenWrtConnectionError,
  UbusAuthenticationError,
  type UbusClient,
} from '../../infrastructure/openwrt/UbusClient.js';
import type { Device } from './types.js';
import type { GetDevicesQuery } from './device.schemas.js';

export class DeviceFetchError extends Error {
  public readonly statusCode = 502;
  public readonly code = 'DEVICE_FETCH_ERROR';

  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'DeviceFetchError';
  }
}

interface LuciDhcpLeasesResult {
  dhcp_leases?: Array<{
    macaddr?: string;
    ipaddr?: string;
    hostname?: string;
    expires?: number;
  }>;
}

type LuciHostHintsResult = Record<
  string,
  {
    ipaddrs?: string[];
    ip6addrs?: string[];
    name?: string;
  }
>;

interface FileExecResult {
  code: number;
  stdout?: string;
  stderr?: string;
}

const MAC_REGEX = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;

export const normalizeMac = (mac: string): string => {
  const trimmed = mac.trim();
  if (!MAC_REGEX.test(trimmed)) {
    throw new Error(`Invalid MAC address format: "${mac}"`);
  }
  return trimmed.replace(/-/g, ':').toUpperCase();
};

export class DevicesService {
  constructor(private readonly ubus: UbusClient = ubusClient) {}

  /**
   * Fetches and consolidates connected devices from OpenWrt router via Ubus.
   */
  public async getConnectedDevices(filter?: GetDevicesQuery): Promise<Device[]> {
    if (!this.ubus.isConfigured()) {
      throw new OpenWrtNotConfiguredError(
        'OpenWrt router connection is not configured. Please check OPENWRT_HOST and credentials.'
      );
    }

    const deviceMap = new Map<string, Device>();
    let hasSuccessfulSource = false;
    let primaryError: unknown = null;

    // 1. Fetch DHCP leases from luci-rpc
    try {
      const leasesResult = await this.ubus.call<LuciDhcpLeasesResult>('luci-rpc', 'getDHCPLeases');
      hasSuccessfulSource = true;
      if (Array.isArray(leasesResult?.dhcp_leases)) {
        for (const lease of leasesResult.dhcp_leases) {
          if (!lease.macaddr) continue;
          try {
            const mac = normalizeMac(lease.macaddr);
            const hostname = lease.hostname && lease.hostname !== '*' ? lease.hostname : null;

            deviceMap.set(mac, {
              id: mac.toLowerCase(),
              mac,
              ip: lease.ipaddr ?? null,
              hostname,
              interface: null,
              connected: true,
              rxBytes: 0,
              txBytes: 0,
            });
          } catch {
            // Skip invalid MAC format
          }
        }
      }
    } catch (err) {
      this.captureError(err, (e) => {
        primaryError = e;
      });
    }

    // 2. Fetch Host Hints from luci-rpc
    try {
      const hostHintsResult = await this.ubus.call<LuciHostHintsResult>('luci-rpc', 'getHostHints');
      hasSuccessfulSource = true;
      if (hostHintsResult && typeof hostHintsResult === 'object') {
        for (const [rawMac, hint] of Object.entries(hostHintsResult)) {
          try {
            const mac = normalizeMac(rawMac);
            const ip = hint.ipaddrs && hint.ipaddrs.length > 0 ? (hint.ipaddrs[0] ?? null) : null;
            const hostname = hint.name && hint.name !== '*' ? hint.name : null;

            const existing = deviceMap.get(mac);
            if (existing) {
              if (!existing.hostname && hostname) {
                existing.hostname = hostname;
              }
              if (!existing.ip && ip) {
                existing.ip = ip;
              }
            } else {
              deviceMap.set(mac, {
                id: mac.toLowerCase(),
                mac,
                ip,
                hostname,
                interface: null,
                connected: true,
                rxBytes: 0,
                txBytes: 0,
              });
            }
          } catch {
            // Skip non-MAC keys
          }
        }
      }
    } catch (err) {
      this.captureError(err, (e) => {
        if (!primaryError) primaryError = e;
      });
    }

    // 3. Query kernel neighbor table via file.exec (/sbin/ip -4 neigh show)
    try {
      const neighResult = await this.ubus.call<FileExecResult>('file', 'exec', {
        command: '/sbin/ip',
        params: ['-4', 'neigh', 'show'],
      });
      hasSuccessfulSource = true;

      if (neighResult?.stdout) {
        const lines = neighResult.stdout.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // Format: 192.168.50.254 dev br-lan lladdr 52:54:00:5b:2e:c1 ref 1 used 0/0/0 probes 1 REACHABLE
          const parts = trimmed.split(/\s+/);
          const ipIndex = 0;
          const devIndex = parts.indexOf('dev');
          const lladdrIndex = parts.indexOf('lladdr');

          if (devIndex === -1 || lladdrIndex === -1 || lladdrIndex + 1 >= parts.length) {
            continue;
          }

          const ip = parts[ipIndex] ?? null;
          const iface = parts[devIndex + 1] ?? null;
          const rawMac = parts[lladdrIndex + 1];
          const state = parts[parts.length - 1]?.toUpperCase() ?? '';

          if (!rawMac || rawMac === '00:00:00:00:00:00') continue;

          try {
            const mac = normalizeMac(rawMac);
            const isReachable = state === 'REACHABLE' || state === 'DELAY' || state === 'STALE';

            const existing = deviceMap.get(mac);
            if (existing) {
              existing.interface = iface;
              existing.connected = isReachable;
              if (!existing.ip && ip) {
                existing.ip = ip;
              }
            } else {
              deviceMap.set(mac, {
                id: mac.toLowerCase(),
                mac,
                ip,
                hostname: null,
                interface: iface,
                connected: isReachable,
                rxBytes: 0,
                txBytes: 0,
              });
            }
          } catch {
            // Skip invalid MAC
          }
        }
      }
    } catch (err) {
      this.captureError(err, (e) => {
        if (!primaryError) primaryError = e;
      });
    }

    // If all discovery calls failed, throw the underlying connection or fetch error
    if (!hasSuccessfulSource && primaryError) {
      if (
        primaryError instanceof OpenWrtNotConfiguredError ||
        primaryError instanceof OpenWrtConnectionError ||
        primaryError instanceof UbusAuthenticationError
      ) {
        throw primaryError;
      }
      throw new DeviceFetchError(
        `Failed to fetch devices from OpenWrt: ${primaryError instanceof Error ? primaryError.message : String(primaryError)}`,
        primaryError
      );
    }

    // Filter out router's own loopback and router IP addresses
    let devices = Array.from(deviceMap.values()).filter((d) => {
      if (!d.ip) return true;
      // Exclude router self addresses
      if (d.ip === '192.168.50.1' || d.ip === '127.0.0.1' || d.hostname === 'OpenWrt.lan') {
        return false;
      }
      return true;
    });

    // 4. Apply filters
    if (filter?.search) {
      const search = filter.search.toLowerCase();
      devices = devices.filter(
        (d) =>
          d.mac.toLowerCase().includes(search) ||
          (d.ip && d.ip.toLowerCase().includes(search)) ||
          (d.hostname && d.hostname.toLowerCase().includes(search))
      );
    }

    if (filter?.interface) {
      const iface = filter.interface.toLowerCase();
      devices = devices.filter((d) => d.interface?.toLowerCase() === iface);
    }

    if (filter?.connected !== undefined) {
      devices = devices.filter((d) => d.connected === filter.connected);
    }

    // Sort devices by IP address
    return devices.sort((a, b) => this.compareIps(a.ip, b.ip));
  }

  private captureError(err: unknown, setter: (e: unknown) => void): void {
    if (
      err instanceof OpenWrtNotConfiguredError ||
      err instanceof OpenWrtConnectionError ||
      err instanceof UbusAuthenticationError
    ) {
      setter(err);
    } else {
      setter(err);
    }
  }

  private compareIps(ipA: string | null, ipB: string | null): number {
    if (!ipA) return 1;
    if (!ipB) return -1;
    const numA = ipA.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
    const numB = ipB.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
    return numA - numB;
  }
}

export const devicesService = new DevicesService();
// Aliases for backward compatibility
export const deviceService = devicesService;
export { DevicesService as DeviceService };
