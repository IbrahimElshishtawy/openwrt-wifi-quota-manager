import os from 'node:os';
import {
  ubusClient,
  type UbusClient,
} from '../../infrastructure/openwrt/UbusClient.js';
import type {
  InfrastructureMetadata,
  LanSubnet,
  NetworkInterfaceDump,
  LuciNetworkDevices,
  Device,
} from './types.js';
import {
  normalizeMac,
  calculateSubnet,
  isIpInSubnet,
} from './utils/network.utils.js';

export class InfrastructureService {
  private cachedInfra: { data: InfrastructureMetadata; expiresAt: number } | null = null;

  constructor(private readonly ubus: UbusClient = ubusClient) {}

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
}

export const infrastructureService = new InfrastructureService();
