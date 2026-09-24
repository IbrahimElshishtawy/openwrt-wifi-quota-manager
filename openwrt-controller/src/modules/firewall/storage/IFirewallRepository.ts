export type BlockSource = 'manual' | 'quota';

export interface FirewallBlockState {
  manualBlockedMacs: string[];
  quotaBlockedMacs: string[];
}

export interface IFirewallRepository {
  getSources(mac: string): Promise<BlockSource[]>;
  addBlockSource(mac: string, source: BlockSource): Promise<void>;
  removeBlockSource(mac: string, source: BlockSource): Promise<void>;
  hasBlockSource(mac: string, source: BlockSource): Promise<boolean>;
  listBlockedMacsBySource(source?: BlockSource): Promise<string[]>;
  clear?(): Promise<void>;
}
