import type { BlockResult, UnblockResult, BlockSource } from './types.js';

/**
 * Interface defining device firewall enforcement operations on OpenWrt router.
 * Injectable contract implemented by FirewallService.
 */
export interface IFirewallService {
  /**
   * Idempotently initializes the dedicated nftables quota enforcement structure.
   */
  initialize(): Promise<void>;

  /**
   * Ensures the dedicated nftables table, set, and forward drop rules exist.
   */
  ensureRuleset(): Promise<void>;

  /**
   * Blocks internet access for an individual LAN client device by its MAC address.
   * Operation must be idempotent.
   */
  blockDevice(mac: string, source?: BlockSource): Promise<BlockResult | void>;

  /**
   * Unblocks an individual device, restoring normal internet access.
   * Operation must be idempotent.
   */
  unblockDevice(mac: string, source?: BlockSource): Promise<UnblockResult | void>;

  /**
   * Checks whether a specific MAC address is currently blocked.
   */
  isBlocked(mac: string, source?: BlockSource): Promise<boolean>;

  /**
   * Lists all MAC addresses currently blocked in the firewall.
   */
  getBlockedDevices(source?: BlockSource): Promise<string[]>;

  /**
   * Validates and standardizes a MAC address string.
   */
  validateAndNormalizeMac?(rawMac: string): string;
}
