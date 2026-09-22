import {
  ubusClient,
  OpenWrtNotConfiguredError,
  type UbusClient,
  type RawDhcpLeaseEntry,
  type RawArpEntry,
} from '../../infrastructure/openwrt/ubus.client.js';
import type { ConnectedDevice, DeviceStatus } from './device.types.js';
import type { GetDevicesQuery } from './device.schemas.js';

export class DeviceService {
  constructor(private readonly ubus: UbusClient = ubusClient) {}

  /**
   * Discovers and consolidates all connected devices from OpenWrt DHCP leases and ARP table.
   */
  public async getConnectedDevices(filter?: GetDevicesQuery): Promise<ConnectedDevice[]> {
    if (!this.ubus.isConfigured()) {
      throw new OpenWrtNotConfiguredError(
        'OpenWrt router connection is not configured. Please set OPENWRT_HOST and credentials in .env'
      );
    }

    let leases: RawDhcpLeaseEntry[] = [];
    let arpEntries: RawArpEntry[] = [];
    let lastError: unknown = null;

    try {
      leases = await this.ubus.getDhcpLeases();
    } catch (err) {
      lastError = err;
    }

    try {
      arpEntries = await this.ubus.getArpTable();
    } catch (err) {
      if (!lastError) lastError = err;
    }

    // If both failed and no data could be retrieved, surface the router error
    if (leases.length === 0 && arpEntries.length === 0 && lastError) {
      throw lastError;
    }

    const deviceMap = new Map<string, ConnectedDevice>();

    // 2. Process DHCP leases (provides MAC, IP, hostname, expiration)
    for (const lease of leases) {
      let leaseExpiresAt: string | null = null;
      if (lease.expires > 0) {
        // If lease.expires is an absolute unix timestamp
        const expiryDate = lease.expires > 1000000000
          ? new Date(lease.expires * 1000)
          : new Date(Date.now() + lease.expires * 1000);
        leaseExpiresAt = expiryDate.toISOString();
      }

      deviceMap.set(lease.mac, {
        mac: lease.mac,
        ip: lease.ip,
        hostname: lease.hostname && lease.hostname !== '*' ? lease.hostname : 'Unknown',
        status: 'online',
        leaseExpiresAt,
      });
    }

    // 3. Process ARP entries (catches static IP clients or active traffic)
    for (const arp of arpEntries) {
      const existing = deviceMap.get(arp.mac);

      if (existing) {
        // Augment interface if present
        if (arp.device) {
          existing.interface = arp.device;
        }
      } else {
        // Static device not in DHCP leases
        deviceMap.set(arp.mac, {
          mac: arp.mac,
          ip: arp.ip,
          hostname: 'Unknown',
          status: this.resolveStatusFromArpFlags(arp.flags),
          interface: arp.device,
        });
      }
    }

    let devices = Array.from(deviceMap.values());

    // 4. Apply optional query filters
    if (filter?.status) {
      devices = devices.filter((dev) => dev.status === filter.status);
    }

    if (filter?.search) {
      const query = filter.search.toLowerCase();
      devices = devices.filter(
        (dev) =>
          dev.mac.toLowerCase().includes(query) ||
          dev.ip.toLowerCase().includes(query) ||
          dev.hostname.toLowerCase().includes(query)
      );
    }

    // Sort by IP address numerically
    return devices.sort((a, b) => this.compareIps(a.ip, b.ip));
  }

  private resolveStatusFromArpFlags(flags: string): DeviceStatus {
    // 0x2 = complete ARP entry, 0x0 = incomplete
    if (flags === '0x2' || flags === '2') {
      return 'online';
    }
    return 'idle';
  }

  private compareIps(ipA: string, ipB: string): number {
    const numA = ipA.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
    const numB = ipB.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
    return numA - numB;
  }
}

// Singleton DeviceService instance
export const deviceService = new DeviceService();
