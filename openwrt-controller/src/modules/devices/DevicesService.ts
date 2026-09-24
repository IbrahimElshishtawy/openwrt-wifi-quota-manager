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

export interface LanSubnet {
  network: string;
  mask: number;
  cidr: string;
}

export interface InfrastructureMetadata {
  excludedIps: Set<string>;
  excludedMacs: Set<string>;
  excludedHostnames: Set<string>;
  wanDevices: Set<string>;
  lanSubnets: LanSubnet[];
}

export function ipToInt(ip: string): number {
  return ip
    .split('.')
    .reduce((acc, octet) => ((acc << 8) + parseInt(octet, 10)) >>> 0, 0);
}

export function intToIp(int: number): string {
  return [
    (int >>> 24) & 255,
    (int >>> 16) & 255,
    (int >>> 8) & 255,
    int & 255,
  ].join('.');
}

export function maskToInt(mask: number): number {
  return mask === 0 ? 0 : (~0 << (32 - mask)) >>> 0;
}

export function calculateSubnet(address: string, mask: number): LanSubnet {
  const ipInt = ipToInt(address);
  const maskInt = maskToInt(mask);
  const netInt = (ipInt & maskInt) >>> 0;
  const network = intToIp(netInt);
  return {
    network,
    mask,
    cidr: `${network}/${mask}`,
  };
}

export function isIpInSubnet(ip: string, network: string, mask: number): boolean {
  try {
    const ipInt = ipToInt(ip);
    const netInt = ipToInt(network);
    const maskInt = maskToInt(mask);
    return (ipInt & maskInt) === (netInt & maskInt);
  } catch {
    return false;
  }
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
      // Filter out infrastructure and verify real LAN client status
      if (!this.isRealLanClient(candidate, infra)) {
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
   * Returns baseline known infrastructure topology for the test/router environment.
   * Excludes router self, virtual bridge hosts, WAN interfaces, and libvirt networks.
   */
  public getBaselineInfrastructure(): InfrastructureMetadata {
    const excludedIps = new Set<string>([
      '127.0.0.1',
      '0.0.0.0',
      '255.255.255.255',
      // Baseline router and host bridge defaults
      '192.168.50.1',
      '192.168.50.254',
      '192.168.122.1',
      '192.168.122.132',
    ]);

    const excludedMacs = new Set<string>([
      '00:00:00:00:00:00',
      'FF:FF:FF:FF:FF:FF',
      '52:54:00:E3:BE:C2',
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

    const lanSubnets: LanSubnet[] = [
      { network: '192.168.50.0', mask: 24, cidr: '192.168.50.0/24' },
    ];

    return { excludedIps, excludedMacs, excludedHostnames, wanDevices, lanSubnets };
  }

  private cachedInfra: { data: InfrastructureMetadata; expiresAt: number } | null = null;

  /**
   * Dynamically inspects network topology to identify infrastructure components and LAN subnets:
   * 1. Router's own IPs, MACs, hostnames, and WAN interfaces (via OpenWrt Ubus).
   * 2. Host machine's own IPs and MACs (via Node.js os.networkInterfaces()).
   * 3. Discovered LAN subnets (from non-WAN network.interface dump).
   * 4. Known virtual bridge / gateway defaults (192.168.50.254, 192.168.122.1).
   */
  public async detectInfrastructure(forceRefresh = false): Promise<InfrastructureMetadata> {
    const now = Date.now();
    if (!forceRefresh && this.cachedInfra && this.cachedInfra.expiresAt > now) {
      return this.cachedInfra.data;
    }

    const baseline = this.getBaselineInfrastructure();
    const excludedIps = new Set<string>(baseline.excludedIps);
    const excludedMacs = new Set<string>(baseline.excludedMacs);
    const excludedHostnames = new Set<string>(baseline.excludedHostnames);
    const wanDevices = new Set<string>(baseline.wanDevices);
    const lanSubnetMap = new Map<string, LanSubnet>();
    for (const s of baseline.lanSubnets) {
      lanSubnetMap.set(s.cidr, s);
    }

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
          } else if (iface.interface !== 'loopback' && Array.isArray(iface['ipv4-address'])) {
            // Non-WAN interface: discover LAN subnet(s)
            for (const addr of iface['ipv4-address']) {
              if (addr.address && typeof addr.mask === 'number') {
                const subnet = calculateSubnet(addr.address, addr.mask);
                lanSubnetMap.set(subnet.cidr, subnet);
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

    const result: InfrastructureMetadata = {
      excludedIps,
      excludedMacs,
      excludedHostnames,
      wanDevices,
      lanSubnets: Array.from(lanSubnetMap.values()),
    };

    this.cachedInfra = { data: result, expiresAt: now + 30_000 };
    return result;
  }

  /**
   * Determines whether a candidate device (from discovery or usage telemetry)
   * represents a valid real client behind the OpenWrt LAN.
   *
   * Filters out:
   * - Router's own MACs and IPs
   * - Host gateway IPs and MACs
   * - Libvirt/WAN networks and interface addresses
   * - Non-LAN / external addresses
   */
  public isRealLanClient(
    candidate: { mac: string; ip: string | null; hostname?: string | null; interface?: string | null },
    infra: InfrastructureMetadata,
    knownDevices?: Device[]
  ): boolean {
    let normMac = '';
    if (candidate.mac) {
      try {
        normMac = normalizeMac(candidate.mac);
      } catch {
        return false;
      }
    }

    // 1. Exclude if MAC is in infrastructure excluded MACs
    if (normMac && infra.excludedMacs.has(normMac)) {
      return false;
    }

    // 2. Exclude if IP is in infrastructure excluded IPs
    if (candidate.ip && infra.excludedIps.has(candidate.ip)) {
      return false;
    }

    // 3. Exclude if residing on WAN interface
    if (candidate.interface && infra.wanDevices.has(candidate.interface.toLowerCase())) {
      return false;
    }

    // 4. Exclude by Router hostname
    if (candidate.hostname && infra.excludedHostnames.has(candidate.hostname.toLowerCase())) {
      return false;
    }

    // 5. If known discovered devices are provided, check for a match
    if (knownDevices && knownDevices.length > 0) {
      const isKnown = knownDevices.some(
        (d) => (normMac && d.mac === normMac) || (candidate.ip && d.ip === candidate.ip)
      );
      if (isKnown) {
        return true;
      }
    }

    // 6. Verify that the IP resides in one of the discovered LAN subnets
    if (candidate.ip && infra.lanSubnets && infra.lanSubnets.length > 0) {
      return infra.lanSubnets.some((s) => isIpInSubnet(candidate.ip!, s.network, s.mask));
    }

    // 7. If no IP is assigned yet, but interface is explicitly non-WAN (e.g. br-lan)
    if (!candidate.ip && candidate.interface && !infra.wanDevices.has(candidate.interface.toLowerCase())) {
      return true;
    }

    return false;
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
