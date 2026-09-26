import { type ISshClient, sshClient } from '../../infrastructure/openwrt/SshClient.js';
import { normalizeMac } from '../devices/DevicesService.js';
import {
  InvalidMacAddressError,
  FirewallExecutionError,
} from './types.js';

export interface INftablesClient {
  ensureRuleset(): Promise<void>;
  addBlockedMac(mac: string): Promise<void>;
  deleteBlockedMac(mac: string): Promise<void>;
  hasBlockedMac(mac: string): Promise<boolean>;
  listBlockedMacs(): Promise<string[]>;
}

/**
 * Production client managing remote nftables access control tables on OpenWrt via SSH.
 *
 * Enforces dedicated ruleset isolation:
 * - Table: `inet quota_enforcement`
 * - Set: `blocked_macs` (type `ether_addr`, flags `interval`)
 * - Chain: `forward_block` (hook forward, priority -5)
 *
 * Guarantees idempotency and zero interference with OpenWrt's native firewall4 (`inet fw4`).
 */
export class NftablesClient implements INftablesClient {
  public static readonly TABLE_NAME = 'quota_enforcement';
  public static readonly SET_NAME = 'blocked_macs';
  public static readonly CHAIN_NAME = 'forward_block';

  private static readonly MAC_REGEX = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;

  constructor(private readonly ssh: ISshClient = sshClient) {}

  /**
   * Strictly validates and normalizes a MAC address to prevent shell injection
   * and maintain uniform uppercase colon formatting.
   */
  public validateMac(rawMac: string): string {
    if (!rawMac || typeof rawMac !== 'string') {
      throw new InvalidMacAddressError('MAC address is required and must be a string');
    }
    const clean = rawMac.trim();
    if (!NftablesClient.MAC_REGEX.test(clean)) {
      throw new InvalidMacAddressError(`Invalid MAC address format: "${rawMac}"`);
    }
    return normalizeMac(clean);
  }

  /**
   * Ensures that the dedicated quota_enforcement table, blocked_macs set, and forward drop rules exist.
   *
   * Idempotency guarantee:
   * - Never flushes or removes existing blocked MAC addresses.
   * - Never creates duplicate tables, chains, or drop rules.
   * - Safely provisions only missing structures.
   */
  public async ensureRuleset(): Promise<void> {
    const table = NftablesClient.TABLE_NAME;
    const set = NftablesClient.SET_NAME;
    const chain = NftablesClient.CHAIN_NAME;

    // 1. Check if the table exists
    let tableExists = false;
    try {
      const res = await this.ssh.executeCommand(`nft list table inet ${table} 2>/dev/null`);
      tableExists = res.exitCode === 0;
    } catch {
      tableExists = false;
    }

    if (!tableExists) {
      // Table is missing: atomically create table, set, chain, and both directional drop rules
      const fullInitCmd = [
        `nft add table inet ${table}`,
        `nft 'add set inet ${table} ${set} { type ether_addr; flags interval; comment "Blocked MAC addresses"; }'`,
        `nft 'add chain inet ${table} ${chain} { type filter hook forward priority -5; policy accept; }'`,
        `nft add rule inet ${table} ${chain} ether saddr @${set} counter drop`,
        `nft add rule inet ${table} ${chain} ether daddr @${set} counter drop`,
      ].join(' && ');

      try {
        await this.ssh.executeCommand(fullInitCmd);
        return;
      } catch (err: unknown) {
        throw new FirewallExecutionError(
          `Failed to initialize dedicated nftables table inet ${table} on OpenWrt`,
          err
        );
      }
    }

    // 2. Table exists: inspect and provision missing components incrementally
    try {
      // Check set
      let setExists = false;
      try {
        const setRes = await this.ssh.executeCommand(`nft list set inet ${table} ${set} 2>/dev/null`);
        setExists = setRes.exitCode === 0;
      } catch {
        setExists = false;
      }
      if (!setExists) {
        await this.ssh.executeCommand(
          `nft 'add set inet ${table} ${set} { type ether_addr; flags interval; comment "Blocked MAC addresses"; }'`
        );
      }

      // Check chain and rules
      let chainContent = '';
      let chainExists = false;
      try {
        const chainRes = await this.ssh.executeCommand(`nft list chain inet ${table} ${chain} 2>/dev/null`);
        chainExists = chainRes.exitCode === 0;
        chainContent = chainRes.stdout ?? '';
      } catch {
        chainExists = false;
      }

      if (!chainExists) {
        await this.ssh.executeCommand(
          `nft 'add chain inet ${table} ${chain} { type filter hook forward priority -5; policy accept; }'`
        );
      }

      // Check outbound drop rule (ether saddr @blocked_macs)
      if (!chainContent.includes(`saddr @${set}`)) {
        await this.ssh.executeCommand(`nft add rule inet ${table} ${chain} ether saddr @${set} counter drop`);
      }

      // Check inbound return drop rule (ether daddr @blocked_macs)
      if (!chainContent.includes(`daddr @${set}`)) {
        await this.ssh.executeCommand(`nft add rule inet ${table} ${chain} ether daddr @${set} counter drop`);
      }
    } catch (err: unknown) {
      throw new FirewallExecutionError(
        `Failed to verify or update nftables structures for table inet ${table}`,
        err
      );
    }
  }

  /**
   * Adds a MAC address to the blocked_macs set in nftables.
   * Idempotent: safe if the MAC is already in the set.
   */
  public async addBlockedMac(rawMac: string): Promise<void> {
    const normMac = this.validateMac(rawMac);
    await this.ensureRuleset();

    const table = NftablesClient.TABLE_NAME;
    const set = NftablesClient.SET_NAME;
    const cmd = `nft add element inet ${table} ${set} '{ ${normMac} }'`;

    try {
      await this.ssh.executeCommand(cmd);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // If nftables reports that element already exists, treat as idempotent success
      if (errMsg.toLowerCase().includes('file exists') || errMsg.toLowerCase().includes('already exists')) {
        return;
      }
      throw new FirewallExecutionError(
        `Failed to add MAC ${normMac} to nftables set ${set}: ${errMsg}`,
        err
      );
    }
  }

  /**
   * Removes a MAC address from the blocked_macs set in nftables.
   * Idempotent: safe if the MAC is not currently in the set.
   */
  public async deleteBlockedMac(rawMac: string): Promise<void> {
    const normMac = this.validateMac(rawMac);
    await this.ensureRuleset();

    const table = NftablesClient.TABLE_NAME;
    const set = NftablesClient.SET_NAME;
    // nft delete element fails with "No such file or directory" if element does not exist
    const cmd = `nft delete element inet ${table} ${set} '{ ${normMac} }'`;

    try {
      await this.ssh.executeCommand(cmd);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // Treat non-existent element as safe idempotent deletion
      if (
        errMsg.toLowerCase().includes('no such file or directory') ||
        errMsg.toLowerCase().includes('does not exist')
      ) {
        return;
      }
      throw new FirewallExecutionError(
        `Failed to delete MAC ${normMac} from nftables set ${set}: ${errMsg}`,
        err
      );
    }
  }

  /**
   * Checks whether a specific MAC address is present in the blocked_macs set.
   */
  public async hasBlockedMac(rawMac: string): Promise<boolean> {
    const normMac = this.validateMac(rawMac);
    await this.ensureRuleset();

    const table = NftablesClient.TABLE_NAME;
    const set = NftablesClient.SET_NAME;
    const cmd = `nft get element inet ${table} ${set} '{ ${normMac} }'`;

    try {
      const res = await this.ssh.executeCommand(cmd);
      return res.exitCode === 0;
    } catch {
      return false;
    }
  }

  /**
   * Lists all MAC addresses currently inside the blocked_macs set.
   */
  public async listBlockedMacs(): Promise<string[]> {
    await this.ensureRuleset();

    const table = NftablesClient.TABLE_NAME;
    const set = NftablesClient.SET_NAME;
    const cmd = `nft -j list set inet ${table} ${set} 2>/dev/null || nft list set inet ${table} ${set}`;

    try {
      const res = await this.ssh.executeCommand(cmd);
      if (!res.stdout) return [];

      // 1. Parse JSON output
      try {
        const data = JSON.parse(res.stdout);
        for (const item of data?.nftables || []) {
          if (item.set && item.set.name === set) {
            const elements = item.set.elem || [];
            return elements.map((elem: unknown) => normalizeMac(String(elem)));
          }
        }
      } catch {
        // Fallback to regex
      }

      // 2. Parse plaintext regex output
      const matches = res.stdout.match(/([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})/g);
      if (matches) {
        const unique = new Set(matches.map((m) => normalizeMac(m)));
        return Array.from(unique);
      }

      return [];
    } catch (err: unknown) {
      throw new FirewallExecutionError(`Failed to list blocked MACs from nftables set ${set}`, err);
    }
  }
}

export const nftablesClient = new NftablesClient();
