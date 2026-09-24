import {
  type INftablesClient,
  NftablesClient,
  nftablesClient,
} from './NftablesClient.js';
import {
  DevicesService,
  devicesService,
  normalizeMac,
} from '../devices/DevicesService.js';
import type { Device } from '../devices/types.js';
import {
  type BlockResult,
  type UnblockResult,
  InvalidMacAddressError,
  InfrastructureDeviceError,
  NonClientDeviceError,
  FirewallExecutionError,
} from './types.js';

export {
  InvalidMacAddressError,
  InfrastructureDeviceError,
  NonClientDeviceError,
  FirewallExecutionError,
  normalizeMac,
};
export type { BlockResult, UnblockResult };

/**
 * Production Firewall Management Service.
 *
 * Coordinates device access enforcement by interacting with NftablesClient
 * and verifying LAN client authenticity via DevicesService.isRealLanClient().
 */
export class FirewallService {
  constructor(
    private readonly nftables: INftablesClient = nftablesClient,
    private readonly devices: DevicesService = devicesService
  ) {}

  /**
   * Ensures the dedicated nftables table inet quota_block, set, chain, and drop rules exist.
   */
  public async ensureRuleset(): Promise<void> {
    await this.nftables.ensureRuleset();
  }

  /**
   * Returns a list of all MAC addresses currently blocked in the firewall.
   */
  public async getBlockedDevices(): Promise<string[]> {
    return this.nftables.listBlockedMacs();
  }

  /**
   * Checks whether a specific MAC address is currently blocked.
   */
  public async isBlocked(rawMac: string): Promise<boolean> {
    const normMac = this.validateAndNormalizeMac(rawMac);
    return this.nftables.hasBlockedMac(normMac);
  }

  /**
   * Blocks internet transit for an individual LAN client device.
   *
   * Safety checks:
   * 1. Validates MAC format.
   * 2. Checks against router, host, and libvirt infrastructure MACs.
   * 3. Verifies that the target is a legitimate LAN client via DevicesService.isRealLanClient().
   * 4. Idempotently skips addition if the device is already blocked.
   */
  public async blockDevice(rawMac: string): Promise<BlockResult> {
    const normMac = this.validateAndNormalizeMac(rawMac);

    // 1. Detect network infrastructure
    const infra = await this.devices.detectInfrastructure();

    // 2. Reject router / infrastructure MAC addresses
    if (infra.excludedMacs.has(normMac)) {
      throw new InfrastructureDeviceError(
        `Device ${normMac} is a router or network infrastructure component and cannot be blocked`
      );
    }

    // 3. Verify that the MAC represents a legitimate LAN client using DevicesService.isRealLanClient()
    let knownDevices: Device[] = [];
    try {
      knownDevices = await this.devices.getConnectedDevices();
    } catch {
      // If fetching full connected list fails, fall back to empty list for topology check
      knownDevices = [];
    }

    const matchedDevice = knownDevices.find((d) => d.mac === normMac);
    const candidate = matchedDevice ?? {
      mac: normMac,
      ip: null,
      interface: 'br-lan',
    };

    const isClient = this.devices.isRealLanClient(candidate, infra, knownDevices);
    if (!isClient) {
      throw new NonClientDeviceError(
        `Device ${normMac} is not recognized as a legitimate LAN client`
      );
    }

    // 4. Ensure ruleset is provisioned
    await this.nftables.ensureRuleset();

    // 5. Idempotent check: if already blocked, return success without re-adding
    const alreadyBlocked = await this.nftables.hasBlockedMac(normMac);
    if (alreadyBlocked) {
      return {
        success: true,
        mac: normMac,
        isBlocked: true,
        message: `Device ${normMac} is already blocked`,
        alreadyBlocked: true,
      };
    }

    // 6. Execute atomic nftables element addition
    await this.nftables.addBlockedMac(normMac);

    return {
      success: true,
      mac: normMac,
      isBlocked: true,
      message: `Device ${normMac} blocked successfully`,
    };
  }

  /**
   * Unblocks an individual device, restoring normal internet access.
   * Idempotent: safe even if the device is not currently blocked.
   */
  public async unblockDevice(rawMac: string): Promise<UnblockResult> {
    const normMac = this.validateAndNormalizeMac(rawMac);

    await this.nftables.ensureRuleset();

    const currentlyBlocked = await this.nftables.hasBlockedMac(normMac);
    if (!currentlyBlocked) {
      return {
        success: true,
        mac: normMac,
        isBlocked: false,
        message: `Device ${normMac} is not currently blocked`,
        wasBlocked: false,
      };
    }

    await this.nftables.deleteBlockedMac(normMac);

    return {
      success: true,
      mac: normMac,
      isBlocked: false,
      message: `Device ${normMac} unblocked successfully`,
      wasBlocked: true,
    };
  }

  public validateAndNormalizeMac(rawMac: string): string {
    if (!rawMac || typeof rawMac !== 'string') {
      throw new InvalidMacAddressError('MAC address is required');
    }
    const clean = rawMac.trim();
    const macRegex = /^([0-9a-fA-F]{2}[:-]){5}([0-9a-fA-F]{2})$/;
    if (!macRegex.test(clean)) {
      throw new InvalidMacAddressError(`Invalid MAC address format: "${rawMac}"`);
    }
    return normalizeMac(clean);
  }
}

export const firewallService = new FirewallService();
