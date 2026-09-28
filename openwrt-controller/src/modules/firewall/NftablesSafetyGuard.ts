import { InvalidMacAddressError } from './types.js';

export class ForbiddenFirewallOperationError extends Error {
  public readonly statusCode = 403;
  public readonly code = 'FORBIDDEN_FIREWALL_OPERATION';

  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenFirewallOperationError';
  }
}

const STRICT_MAC_REGEX = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
const DANGEROUS_SHELL_CHARS_REGEX = /[;&|`$><\\!]/;

// Forbidden keywords/tables that must never be targeted by controller
const FORBIDDEN_NFT_PATTERNS = [
  /\bflush\s+ruleset\b/i,
  /\bfw4\b/i,
  /\btable\s+inet\s+filter\b/i,
  /\btable\s+ip\b/i,
  /\btable\s+ip6\b/i,
  /\btable\s+bridge\b/i,
  /\bdelete\s+table\s+inet\s+(?!quota_enforcement\b)[a-zA-Z0-9_]+/i,
  /\bflush\s+table\s+inet\s+(?!quota_enforcement\b)[a-zA-Z0-9_]+/i,
];

export class NftablesSafetyGuard {
  public static readonly ALLOWED_TABLE = 'quota_enforcement';

  /**
   * Strictly validates a MAC address format and ensures no shell escape characters exist.
   */
  public static validateMac(mac: string): string {
    if (!mac || typeof mac !== 'string') {
      throw new InvalidMacAddressError('MAC address is required and must be a string');
    }

    const trimmed = mac.trim();

    if (DANGEROUS_SHELL_CHARS_REGEX.test(trimmed)) {
      throw new InvalidMacAddressError(`MAC address contains illegal characters: "${mac}"`);
    }

    if (!STRICT_MAC_REGEX.test(trimmed)) {
      throw new InvalidMacAddressError(`Invalid MAC address format: "${mac}"`);
    }

    return trimmed.replace(/-/g, ':').toUpperCase();
  }

  /**
   * Verifies that an nftables command is strictly restricted to inet quota_enforcement
   * and contains no forbidden destructive patterns (flush ruleset, fw4 modification).
   */
  public static assertSafeNftCommand(cmd: string): void {
    if (!cmd || typeof cmd !== 'string') {
      throw new ForbiddenFirewallOperationError('Empty or invalid command provided');
    }

    const trimmed = cmd.trim();

    // Check forbidden patterns
    for (const pattern of FORBIDDEN_NFT_PATTERNS) {
      if (pattern.test(trimmed)) {
        throw new ForbiddenFirewallOperationError(
          `Command rejected by safety guard: forbidden nftables operation detected ("${trimmed}")`
        );
      }
    }

    // If command invokes nft, ensure it is scoped to quota_enforcement or is read-only list tables
    if (trimmed.startsWith('nft') || trimmed.includes('&& nft') || trimmed.includes('; nft')) {
      if (trimmed === 'nft list tables' || trimmed === 'nft -j list tables') {
        return; // Safe read-only inspection
      }

      if (!trimmed.includes(NftablesSafetyGuard.ALLOWED_TABLE)) {
        throw new ForbiddenFirewallOperationError(
          `Command rejected by safety guard: nftables operation must target table "${NftablesSafetyGuard.ALLOWED_TABLE}"`
        );
      }
    }
  }
}
