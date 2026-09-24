import {
  ubusClient,
  OpenWrtNotConfiguredError,
  OpenWrtConnectionError,
  UbusAuthenticationError,
  type UbusClient,
} from '../../infrastructure/openwrt/UbusClient.js';
import type {
  Device,
  CandidateDevice,
  LuciDhcpLeasesResult,
  LuciHostHintsResult,
  FileExecResult,
  InfrastructureMetadata,
  LanSubnet,
} from './types.js';
import { DeviceFetchError } from './types.js';
import type { GetDevicesQuery } from './device.schemas.js';
import {
  InfrastructureService,
  infrastructureService,
} from './InfrastructureService.js';
import {
  normalizeMac,
  compareIps,
  calculateSubnet,
  ipToInt,
  intToIp,
  maskToInt,
  isIpInSubnet,
} from './utils/network.utils.js';

// Re-export domain errors and utilities for clean public module API
export {
  DeviceFetchError,
  normalizeMac,
  calculateSubnet,
  ipToInt,
  intToIp,
  maskToInt,
  isIpInSubnet,
  type InfrastructureMetadata,
  type LanSubnet,
};

export class DevicesService {
  constructor(
    private readonly ubus: UbusClient = ubusClient,
    private readonly infrastructure: InfrastructureService = new InfrastructureService(ubus)
  ) {}

  /**
   * Returns baseline known infrastructure topology for the router environment.
   * Delegates to InfrastructureService.
   */
  public getBaselineInfrastructure(): InfrastructureMetadata {
    return this.infrastructure.getBaselineInfrastructure();
  }

  /**
   * Dynamically inspects network topology to identify infrastructure components and LAN subnets.
   * Delegates to InfrastructureService.
   */
  public async detectInfrastructure(forceRefresh = false): Promise<InfrastructureMetadata> {
    return this.infrastructure.detectInfrastructure(forceRefresh);
  }

  /**
   * Validates whether a candidate device is a real LAN client vs infrastructure component.
   * Delegates to InfrastructureService.
   */
  public isRealLanClient(
    candidate: { mac: string; ip: string | null; hostname?: string | null; interface?: string | null },
    infra: InfrastructureMetadata,
    knownDevices?: Device[]
  ): boolean {
    return this.infrastructure.isRealLanClient(candidate, infra, knownDevices);
  }

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
    return filteredDevices.sort((a, b) => compareIps(a.ip, b.ip));
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
}

export const devicesService = new DevicesService();
// Aliases for backward compatibility
export const deviceService = devicesService;
export { DevicesService as DeviceService };
