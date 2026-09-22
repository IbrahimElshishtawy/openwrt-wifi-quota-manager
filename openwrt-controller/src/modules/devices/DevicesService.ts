import os from 'node:os';
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
  dhcp6_leases?: Array<{
    macaddr?: string;
    ip6addr?: string;
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

interface NetworkInterfaceDump {
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

type LuciNetworkDevices = Record<
  string,
  {
    mac?: string;
    ipaddrs?: Array<{ address: string }>;
    name?: string;
  }
>;

interface InfrastructureMetadata {
  excludedIps: Set<string>;
  excludedMacs: Set<string>;
  excludedHostnames: Set<string>;
  wanDevices: Set<string>;
}

interface CandidateDevice {
  mac: string;
  ip: string | null;
  hostname: string | null;
  interface: string | null;
  leaseExpires?: number;
  neighState?: string;
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
   * Fetches and consolidates real connected devices behind the OpenWrt router.
   * Filters out network infrastructure (Router self, Host gateway, and Libvirt/WAN networks).
   */
  public async getConnectedDevices(filter?: GetDevicesQuery): Promise<Device[]> {
    if (!this.ubus.isConfigured()) {
      throw new OpenWrtNotConfiguredError(
        'OpenWrt router connection is not configured. Please check OPENWRT_HOST and credentials.'
      );
    }

    const candidateMap = new Map<string, CandidateDevice>();
    let hasSuccessfulSource = false;
    let primaryError: unknown = null;

    // 1. Concurrently fetch infrastructure metadata and client discovery sources
    const [infra, leasesResult, hostHintsResult, neighResult] = await Promise.all([
      this.detectInfrastructure(),
      this.safeCall<LuciDhcpLeasesResult>('luci-rpc', 'getDHCPLeases').catch((err) => {
        this.captureError(err, (e) => (primaryError ??= e));
        return null;
      }),
      this.safeCall<LuciHostHintsResult>('luci-rpc', 'getHostHints').catch((err) => {
        this.captureError(err, (e) => (primaryError ??= e));
        return null;
      }),
      this.safeCall<FileExecResult>('file', 'exec', {
        command: '/sbin/ip',
        params: ['-4', 'neigh', 'show'],
      }).catch((err) => {
        this.captureError(err, (e) => (primaryError ??= e));
        return null;
      }),
    ]);

    // 2. Process DHCP leases
    if (Array.isArray(leasesResult?.dhcp_leases)) {
      hasSuccessfulSource = true;
      for (const lease of leasesResult.dhcp_leases) {
        if (!lease.macaddr) continue;
        try {
          const mac = normalizeMac(lease.macaddr);
          const hostname = lease.hostname && lease.hostname !== '*' ? lease.hostname : null;

          const candidate = candidateMap.get(mac) ?? {
            mac,
            ip: null,
            hostname: null,
            interface: null,
          };

          if (lease.ipaddr) candidate.ip = lease.ipaddr;
          if (hostname && !candidate.hostname) candidate.hostname = hostname;
          if (lease.expires !== undefined) candidate.leaseExpires = lease.expires;

          candidateMap.set(mac, candidate);
        } catch {
          // Skip invalid MAC format
        }
      }
    }

    // 3. Process Host Hints
    if (hostHintsResult && typeof hostHintsResult === 'object') {
      hasSuccessfulSource = true;
      for (const [rawMac, hint] of Object.entries(hostHintsResult)) {
        try {
          const mac = normalizeMac(rawMac);
          const ip = hint.ipaddrs && hint.ipaddrs.length > 0 ? (hint.ipaddrs[0] ?? null) : null;
          const hostname = hint.name && hint.name !== '*' ? hint.name : null;

          const candidate = candidateMap.get(mac) ?? {
            mac,
            ip: null,
            hostname: null,
            interface: null,
          };

          if (!candidate.ip && ip) candidate.ip = ip;
          if (!candidate.hostname && hostname) candidate.hostname = hostname;

          candidateMap.set(mac, candidate);
        } catch {
          // Skip non-MAC keys
        }
      }
    }

    // 4. Process Kernel IPv4 Neighbour Table (/sbin/ip -4 neigh show)
    if (neighResult?.stdout) {
      hasSuccessfulSource = true;
      const lines = neighResult.stdout.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Example: 192.168.50.150 dev br-lan lladdr 52:54:00:cf:15:88 ref 1 used 0/0/0 probes 1 REACHABLE
        const parts = trimmed.split(/\s+/);
        const ip = parts[0] ?? null;
        const devIndex = parts.indexOf('dev');
        const lladdrIndex = parts.indexOf('lladdr');

        if (devIndex === -1 || lladdrIndex === -1 || lladdrIndex + 1 >= parts.length) {
          continue;
        }

        const iface = parts[devIndex + 1] ?? null;
        const rawMac = parts[lladdrIndex + 1];
        const neighState = parts[parts.length - 1]?.toUpperCase() ?? '';

        if (!rawMac || rawMac === '00:00:00:00:00:00') continue;

        try {
          const mac = normalizeMac(rawMac);
          const candidate = candidateMap.get(mac) ?? {
            mac,
            ip: null,
            hostname: null,
            interface: null,
          };

          if (!candidate.ip && ip) candidate.ip = ip;
          if (iface) candidate.interface = iface;
          candidate.neighState = neighState;

          candidateMap.set(mac, candidate);
        } catch {
          // Skip invalid MAC format
        }
      }
    }

    // If all discovery sources failed, propagate the underlying connection error
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

    // 5. Filter out infrastructure and build final Device models
    const activeNeighbourStates = new Set(['REACHABLE', 'DELAY', 'PROBE', 'PERMANENT']);
    const failedNeighbourStates = new Set(['FAILED', 'INCOMPLETE', 'NONE']);

    const devices: Device[] = [];

    for (const candidate of candidateMap.values()) {
      // Exclude by MAC
      if (infra.excludedMacs.has(candidate.mac)) {
        continue;
      }

      // Exclude by IP if assigned
      if (candidate.ip && infra.excludedIps.has(candidate.ip)) {
        continue;
      }

      // Exclude if residing on WAN interface
      if (candidate.interface && infra.wanDevices.has(candidate.interface.toLowerCase())) {
        continue;
      }

      // Exclude by Router hostname
      if (candidate.hostname && infra.excludedHostnames.has(candidate.hostname.toLowerCase())) {
        continue;
      }

      // Determine connected state based on real kernel neighbour state & DHCP lease
      let connected = false;
      if (candidate.neighState) {
        if (activeNeighbourStates.has(candidate.neighState)) {
          connected = true;
        } else if (candidate.neighState === 'STALE') {
          // Stale entry is considered online if DHCP lease is active
          connected = candidate.leaseExpires !== undefined ? candidate.leaseExpires > 0 : true;
        } else if (failedNeighbourStates.has(candidate.neighState)) {
          connected = false;
        }
      } else if (candidate.leaseExpires !== undefined && candidate.leaseExpires > 0) {
        // Device with active lease but not in ARP yet
        connected = true;
      }

      devices.push({
        id: candidate.mac,
        mac: candidate.mac,
        ip: candidate.ip,
        hostname: candidate.hostname,
        interface: candidate.interface,
        connected,
        rxBytes: 0,
        txBytes: 0,
      });
    }

    // 6. Apply API Query Filters
    let filteredDevices = devices;

    if (filter?.search) {
      const search = filter.search.toLowerCase();
      filteredDevices = filteredDevices.filter(
        (d) =>
          d.mac.toLowerCase().includes(search) ||
          (d.ip && d.ip.toLowerCase().includes(search)) ||
          (d.hostname && d.hostname.toLowerCase().includes(search))
      );
    }

    if (filter?.interface) {
      const iface = filter.interface.toLowerCase();
      filteredDevices = filteredDevices.filter((d) => d.interface?.toLowerCase() === iface);
    }

    if (filter?.connected !== undefined) {
      filteredDevices = filteredDevices.filter((d) => d.connected === filter.connected);
    }

    // Sort devices numerically by IP
    return filteredDevices.sort((a, b) => this.compareIps(a.ip, b.ip));
  }

  /**
   * Dynamically inspects network topology to identify infrastructure components:
   * 1. Router's own IPs, MACs, hostnames, and WAN interfaces (via OpenWrt Ubus).
   * 2. Host machine's own IPs and MACs (via Node.js os.networkInterfaces()).
   * 3. Known virtual bridge / gateway defaults (192.168.50.254, 192.168.122.1).
   */
  private async detectInfrastructure(): Promise<InfrastructureMetadata> {
    const excludedIps = new Set<string>([
      '127.0.0.1',
      '0.0.0.0',
      '255.255.255.255',
      // Baseline router and host bridge defaults
      '192.168.50.1',
      '192.168.50.254',
      '192.168.122.1',
    ]);

    const excludedMacs = new Set<string>([
      '00:00:00:00:00:00',
      'FF:FF:FF:FF:FF:FF',
    ]);

    const excludedHostnames = new Set<string>([
      'openwrt',
      'openwrt.lan',
      'localhost',
    ]);

    const wanDevices = new Set<string>([
      'eth1',
      'wan',
      'wan6',
    ]);

    // 1. Add Host machine's local interfaces dynamically
    try {
      const interfaces = os.networkInterfaces();
      for (const netList of Object.values(interfaces)) {
        if (!netList) continue;
        for (const net of netList) {
          if (net.address) excludedIps.add(net.address);
          if (net.mac && net.mac !== '00:00:00:00:00:00') {
            try {
              excludedMacs.add(normalizeMac(net.mac));
            } catch {
              // Ignore invalid MAC formats
            }
          }
        }
      }
    } catch {
      // Safe fallback to baseline exclusions
    }

    // 2. Fetch OpenWrt's router interfaces dynamically
    try {
      const ifaceDump = await this.ubus.call<NetworkInterfaceDump>('network.interface', 'dump');
      if (Array.isArray(ifaceDump?.interface)) {
        for (const iface of ifaceDump.interface) {
          // Record interface IPs
          if (Array.isArray(iface['ipv4-address'])) {
            for (const addr of iface['ipv4-address']) {
              if (addr.address) excludedIps.add(addr.address);
            }
          }

          // Identify WAN interfaces & upstream gateways
          const isWan =
            iface.interface === 'wan' ||
            iface.interface === 'wan6' ||
            iface.route?.some((r) => r.target === '0.0.0.0');

          if (isWan) {
            if (iface.l3_device) wanDevices.add(iface.l3_device.toLowerCase());
            if (iface.device) wanDevices.add(iface.device.toLowerCase());
            if (iface.data?.dhcpserver) excludedIps.add(iface.data.dhcpserver);
            if (Array.isArray(iface.route)) {
              for (const r of iface.route) {
                if (r.nexthop) excludedIps.add(r.nexthop);
              }
            }
          }
        }
      }
    } catch {
      // Fallback to baseline
    }

    // 3. Fetch OpenWrt's device MAC addresses dynamically
    try {
      const netDevices = await this.ubus.call<LuciNetworkDevices>('luci-rpc', 'getNetworkDevices');
      if (netDevices && typeof netDevices === 'object') {
        for (const dev of Object.values(netDevices)) {
          if (dev.mac) {
            try {
              excludedMacs.add(normalizeMac(dev.mac));
            } catch {
              // Ignore invalid MAC
            }
          }
          if (Array.isArray(dev.ipaddrs)) {
            for (const ipObj of dev.ipaddrs) {
              if (ipObj.address) excludedIps.add(ipObj.address);
            }
          }
        }
      }
    } catch {
      // Fallback to baseline
    }

    return { excludedIps, excludedMacs, excludedHostnames, wanDevices };
  }

  private async safeCall<T>(
    object: string,
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<T | null> {
    try {
      return await this.ubus.call<T>(object, method, params);
    } catch {
      return null;
    }
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
    const partsA = ipA.split('.').map((p) => parseInt(p, 10));
    const partsB = ipB.split('.').map((p) => parseInt(p, 10));
    for (let i = 0; i < 4; i++) {
      const a = partsA[i] ?? 0;
      const b = partsB[i] ?? 0;
      if (a !== b) return a - b;
    }
    return 0;
  }
}

export const devicesService = new DevicesService();
// Aliases for backward compatibility
export const deviceService = devicesService;
export { DevicesService as DeviceService };
