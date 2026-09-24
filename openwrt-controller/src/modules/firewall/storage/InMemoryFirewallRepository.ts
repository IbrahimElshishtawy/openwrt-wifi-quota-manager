import type { BlockSource, IFirewallRepository } from './IFirewallRepository.js';

/**
 * In-memory repository implementation for firewall block ownership tracking.
 * Used for fast, side-effect-free unit tests.
 */
export class InMemoryFirewallRepository implements IFirewallRepository {
  private readonly manualBlocks = new Set<string>();
  private readonly quotaBlocks = new Set<string>();

  constructor(initialManual: string[] = [], initialQuota: string[] = []) {
    for (const mac of initialManual) {
      this.manualBlocks.add(mac.toUpperCase());
    }
    for (const mac of initialQuota) {
      this.quotaBlocks.add(mac.toUpperCase());
    }
  }

  public async getSources(mac: string): Promise<BlockSource[]> {
    const norm = mac.toUpperCase();
    const sources: BlockSource[] = [];
    if (this.manualBlocks.has(norm)) {
      sources.push('manual');
    }
    if (this.quotaBlocks.has(norm)) {
      sources.push('quota');
    }
    return sources;
  }

  public async addBlockSource(mac: string, source: BlockSource): Promise<void> {
    const norm = mac.toUpperCase();
    if (source === 'manual') {
      this.manualBlocks.add(norm);
    } else {
      this.quotaBlocks.add(norm);
    }
  }

  public async removeBlockSource(mac: string, source: BlockSource): Promise<void> {
    const norm = mac.toUpperCase();
    if (source === 'manual') {
      this.manualBlocks.delete(norm);
    } else {
      this.quotaBlocks.delete(norm);
    }
  }

  public async hasBlockSource(mac: string, source: BlockSource): Promise<boolean> {
    const norm = mac.toUpperCase();
    if (source === 'manual') {
      return this.manualBlocks.has(norm);
    }
    return this.quotaBlocks.has(norm);
  }

  public async listBlockedMacsBySource(source?: BlockSource): Promise<string[]> {
    if (source === 'manual') {
      return Array.from(this.manualBlocks);
    }
    if (source === 'quota') {
      return Array.from(this.quotaBlocks);
    }
    const combined = new Set([...this.manualBlocks, ...this.quotaBlocks]);
    return Array.from(combined);
  }

  public async clear(): Promise<void> {
    this.manualBlocks.clear();
    this.quotaBlocks.clear();
  }
}
