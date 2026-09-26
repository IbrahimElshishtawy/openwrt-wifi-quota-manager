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
import type { IFirewallService } from './IFirewallService.js';
import {
  type BlockResult,
  type UnblockResult,
  type BlockSource,
  FirewallError,
  InvalidMacAddressError,
  InfrastructureDeviceError,
  NonClientDeviceError,
  FirewallExecutionError,
} from './types.js';
import {
  type IFirewallRepository,
} from './storage/IFirewallRepository.js';
import {
  InMemoryFirewallRepository,
} from './storage/InMemoryFirewallRepository.js';
import {
  firewallRepository,
  FileFirewallRepository,
} from './storage/FileFirewallRepository.js';

export {
  FirewallError,
  InvalidMacAddressError,
  InfrastructureDeviceError,
  NonClientDeviceError,
  FirewallExecutionError,
  normalizeMac,
  FileFirewallRepository,
  InMemoryFirewallRepository,
};
export type { BlockResult, UnblockResult, BlockSource, IFirewallRepository, IFirewallService };

/**
 * Production Firewall Management Service.
 *
 * Coordinates device access enforcement by interacting with NftablesClient,
 * tracking block ownership (manual vs quota-enforced),
 * and verifying LAN client authenticity via DevicesService.isRealLanClient().
 */
export class FirewallService implements IFirewallService {
  constructor(
    private readonly nftables: INftablesClient = nftablesClient,
    private readonly devices: DevicesService = devicesService,
    private readonly repository: IFirewallRepository = new InMemoryFirewallRepository()
  ) {}

  /**
   * Idempotently initializes the dedicated nftables quota enforcement structure.
   */
  public async initialize(): Promise<void> {
    await this.ensureRuleset();
  }

  /**
   * Ensures the dedicated nftables table inet quota_enforcement, set, chain, and drop rules exist.
   */
  public async ensureRuleset(): Promise<void> {
    await this.nftables.ensureRuleset();
  }

  /**
   * Returns a list of all MAC addresses currently blocked in the firewall.
   * If a source is specified ('manual' | 'quota'), filters by ownership.
   */
  public async getBlockedDevices(source?: BlockSource): Promise<string[]> {
    if (source) {
      return this.repository.listBlockedMacsBySource(source);
    }
    return this.nftables.listBlockedMacs();
  }

  /**
   * Checks whether a specific MAC address is currently blocked.
   * If source is provided, checks if it is blocked by that specific source.
   */
  public async isBlocked(rawMac: string, source?: BlockSource): Promise<boolean> {
    const normMac = this.validateAndNormalizeMac(rawMac);
    if (source) {
      return this.repository.hasBlockSource(normMac, source);
    }
    return this.nftables.hasBlockedMac(normMac);
  }

  /**
   * Blocks internet transit for an individual LAN client device.
   *
   * Safety checks:
   * 1. Validates MAC format.
   * 2. Checks against router, host, and libvirt infrastructure MACs.
   * 3. Verifies that the target is a legitimate LAN client via DevicesService.isRealLanClient().
   * 4. Updates block ownership repository (distinguishing manual vs quota-enforced blocks).
   * 5. Idempotently skips nftables addition if the device is already blocked.
   */
  public async blockDevice(rawMac: string, source: BlockSource = 'manual'): Promise<BlockResult> {
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

    // 5. Update block ownership tracking
    const alreadyHadSource = await this.repository.hasBlockSource(normMac, source);
    await this.repository.addBlockSource(normMac, source);

    // 6. Idempotent check: if already blocked in nftables, return success without re-adding
    const alreadyBlockedInNftables = await this.nftables.hasBlockedMac(normMac);
    if (alreadyBlockedInNftables) {
      return {
        success: true,
        mac: normMac,
        isBlocked: true,
        message: `Device ${normMac} is already blocked`,
        alreadyBlocked: true,
      };
    }

    // 7. Execute atomic nftables element addition
    await this.nftables.addBlockedMac(normMac);

    return {
      success: true,
      mac: normMac,
      isBlocked: true,
      message: `Device ${normMac} blocked successfully`,
      alreadyBlocked: alreadyHadSource,
    };
  }

  /**
   * Unblocks an individual device, restoring normal internet access.
   * Enforces block ownership: only removes nftables block if no other sources remain.
   * If quota enforcement requests unblock but device was manually blocked by admin,
   * the manual block is strictly preserved.
   */
  public async unblockDevice(rawMac: string, source: BlockSource = 'manual'): Promise<UnblockResult> {
    const normMac = this.validateAndNormalizeMac(rawMac);

    await this.nftables.ensureRuleset();

    const hadSource = await this.repository.hasBlockSource(normMac, source);
    const currentlyBlockedInNft = await this.nftables.hasBlockedMac(normMac);

    // Safety: If quota enforcement attempts to unblock a device it does not own (e.g. manual admin block)
    if (source === 'quota' && !hadSource) {
      return {
        success: true,
        mac: normMac,
        isBlocked: currentlyBlockedInNft,
        message: `Device ${normMac} was not blocked by quota enforcement`,
        wasBlocked: false,
      };
    }

    await this.repository.removeBlockSource(normMac, source);

    const remainingSources = await this.repository.getSources(normMac);

    // If other sources still require this device to be blocked (e.g. manual admin block exists)
    if (remainingSources.length > 0) {
      return {
        success: true,
        mac: normMac,
        isBlocked: true,
        message: `Device ${normMac} ${source} block removed, but remains blocked by: ${remainingSources.join(', ')}`,
        wasBlocked: hadSource || currentlyBlockedInNft,
      };
    }

    // No remaining block owners exist. If not in nftables, safe no-op.
    if (!currentlyBlockedInNft) {
      return {
        success: true,
        mac: normMac,
        isBlocked: false,
        message: `Device ${normMac} is not currently blocked`,
        wasBlocked: false,
      };
    }

    // Atomically delete MAC from nftables set
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

export const firewallService = new FirewallService(
  nftablesClient,
  devicesService,
  firewallRepository
);
