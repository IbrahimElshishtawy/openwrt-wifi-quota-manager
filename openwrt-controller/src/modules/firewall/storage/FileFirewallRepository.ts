import fs from 'node:fs';
import path from 'node:path';
import { env } from '../../../config/env.js';
import type { BlockSource, FirewallBlockState, IFirewallRepository } from './IFirewallRepository.js';

export class FirewallStorageError extends Error {
  public readonly statusCode = 500;
  public readonly code = 'FIREWALL_STORAGE_ERROR';

  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'FirewallStorageError';
  }
}

/**
 * Robust JSON-file based persistence implementation for Firewall Block Ownership.
 * Tracks manual blocks and quota-enforced blocks separately across server restarts.
 * Features:
 * - Atomic write semantics (write to temporary file then atomic rename).
 * - In-memory cache for fast lookups.
 * - Concurrency serialization via write queue.
 * - Automatic directory initialization.
 */
export class FileFirewallRepository implements IFirewallRepository {
  private readonly filePath: string;
  private manualBlocks: Set<string> | null = null;
  private quotaBlocks: Set<string> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath?: string) {
    this.filePath = filePath ?? path.resolve(process.cwd(), env.FIREWALL_STORAGE_PATH);
  }

  private async ensureInitialized(): Promise<{ manual: Set<string>; quota: Set<string> }> {
    if (this.manualBlocks !== null && this.quotaBlocks !== null) {
      return { manual: this.manualBlocks, quota: this.quotaBlocks };
    }

    this.manualBlocks = new Set<string>();
    this.quotaBlocks = new Set<string>();

    try {
      const dir = path.dirname(this.filePath);
      await fs.promises.mkdir(dir, { recursive: true });

      if (fs.existsSync(this.filePath)) {
        const fileContent = await fs.promises.readFile(this.filePath, 'utf-8');
        const trimmed = fileContent.trim();
        if (trimmed) {
          const parsed = JSON.parse(trimmed) as Partial<FirewallBlockState>;
          if (Array.isArray(parsed.manualBlockedMacs)) {
            for (const mac of parsed.manualBlockedMacs) {
              if (typeof mac === 'string') {
                this.manualBlocks.add(mac.toUpperCase());
              }
            }
          }
          if (Array.isArray(parsed.quotaBlockedMacs)) {
            for (const mac of parsed.quotaBlockedMacs) {
              if (typeof mac === 'string') {
                this.quotaBlocks.add(mac.toUpperCase());
              }
            }
          }
        }
      }
    } catch (err) {
      throw new FirewallStorageError(
        `Failed to initialize firewall storage from ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }

    return { manual: this.manualBlocks, quota: this.quotaBlocks };
  }

  private async persistToDisk(): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        const dir = path.dirname(this.filePath);
        await fs.promises.mkdir(dir, { recursive: true });

        const data: FirewallBlockState = {
          manualBlockedMacs: Array.from(this.manualBlocks ?? new Set()),
          quotaBlockedMacs: Array.from(this.quotaBlocks ?? new Set()),
        };

        const jsonContent = JSON.stringify(data, null, 2);
        const tempPath = `${this.filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 8)}`;
        await fs.promises.writeFile(tempPath, jsonContent, 'utf-8');
        await fs.promises.rename(tempPath, this.filePath);
      } catch (err) {
        throw new FirewallStorageError(
          `Failed to persist firewall blocks to disk at ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`,
          err
        );
      }
    });

    return this.writeQueue;
  }

  public async getSources(mac: string): Promise<BlockSource[]> {
    const { manual, quota } = await this.ensureInitialized();
    const norm = mac.toUpperCase();
    const sources: BlockSource[] = [];
    if (manual.has(norm)) sources.push('manual');
    if (quota.has(norm)) sources.push('quota');
    return sources;
  }

  public async addBlockSource(mac: string, source: BlockSource): Promise<void> {
    const { manual, quota } = await this.ensureInitialized();
    const norm = mac.toUpperCase();
    let changed = false;

    if (source === 'manual') {
      if (!manual.has(norm)) {
        manual.add(norm);
        changed = true;
      }
    } else {
      if (!quota.has(norm)) {
        quota.add(norm);
        changed = true;
      }
    }

    if (changed) {
      await this.persistToDisk();
    }
  }

  public async removeBlockSource(mac: string, source: BlockSource): Promise<void> {
    const { manual, quota } = await this.ensureInitialized();
    const norm = mac.toUpperCase();
    let changed = false;

    if (source === 'manual') {
      if (manual.has(norm)) {
        manual.delete(norm);
        changed = true;
      }
    } else {
      if (quota.has(norm)) {
        quota.delete(norm);
        changed = true;
      }
    }

    if (changed) {
      await this.persistToDisk();
    }
  }

  public async hasBlockSource(mac: string, source: BlockSource): Promise<boolean> {
    const { manual, quota } = await this.ensureInitialized();
    const norm = mac.toUpperCase();
    if (source === 'manual') {
      return manual.has(norm);
    }
    return quota.has(norm);
  }

  public async listBlockedMacsBySource(source?: BlockSource): Promise<string[]> {
    const { manual, quota } = await this.ensureInitialized();
    if (source === 'manual') {
      return Array.from(manual);
    }
    if (source === 'quota') {
      return Array.from(quota);
    }
    const combined = new Set([...manual, ...quota]);
    return Array.from(combined);
  }

  public async clear(): Promise<void> {
    const { manual, quota } = await this.ensureInitialized();
    manual.clear();
    quota.clear();
    await this.persistToDisk();
  }
}

export const firewallRepository = new FileFirewallRepository();
