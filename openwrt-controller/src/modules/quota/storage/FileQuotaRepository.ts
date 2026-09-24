import fs from 'node:fs';
import path from 'node:path';
import { env } from '../../../config/env.js';
import type { DeviceQuotaRecord } from '../types.js';
import { QuotaStorageError } from '../types.js';
import type { IQuotaRepository } from './IQuotaRepository.js';

/**
 * Robust JSON-file based persistence implementation for Device Quotas.
 * Features:
 * - Atomic write semantics (write to temporary file then atomic rename) to avoid corruption.
 * - In-memory cache for fast lookups.
 * - Concurrency serialization via write queue.
 * - Automatic directory initialization.
 */
export class FileQuotaRepository implements IQuotaRepository {
  private readonly filePath: string;
  private cache: Map<string, DeviceQuotaRecord> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath?: string) {
    this.filePath = filePath ?? path.resolve(process.cwd(), env.QUOTA_STORAGE_PATH);
  }

  /**
   * Ensures cache is initialized from disk.
   */
  private async ensureInitialized(): Promise<Map<string, DeviceQuotaRecord>> {
    if (this.cache !== null) {
      return this.cache;
    }

    this.cache = new Map<string, DeviceQuotaRecord>();

    try {
      const dir = path.dirname(this.filePath);
      await fs.promises.mkdir(dir, { recursive: true });

      if (fs.existsSync(this.filePath)) {
        const fileContent = await fs.promises.readFile(this.filePath, 'utf-8');
        const trimmed = fileContent.trim();
        if (trimmed) {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (item && typeof item === 'object' && typeof item.mac === 'string') {
                this.cache.set(item.mac, item as DeviceQuotaRecord);
              }
            }
          }
        }
      }
    } catch (err) {
      throw new QuotaStorageError(
        `Failed to initialize quota storage from ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }

    return this.cache;
  }

  /**
   * Serialized atomic persistence to disk.
   */
  private async persistToDisk(): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        const dir = path.dirname(this.filePath);
        await fs.promises.mkdir(dir, { recursive: true });

        const records = Array.from((this.cache ?? new Map()).values());
        const jsonContent = JSON.stringify(records, null, 2);

        const tempPath = `${this.filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 8)}`;
        await fs.promises.writeFile(tempPath, jsonContent, 'utf-8');
        await fs.promises.rename(tempPath, this.filePath);
      } catch (err) {
        throw new QuotaStorageError(
          `Failed to persist quotas to disk at ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`,
          err
        );
      }
    });

    return this.writeQueue;
  }

  public async findById(mac: string): Promise<DeviceQuotaRecord | null> {
    const cache = await this.ensureInitialized();
    const record = cache.get(mac);
    return record ? { ...record } : null;
  }

  public async findAll(): Promise<DeviceQuotaRecord[]> {
    const cache = await this.ensureInitialized();
    return Array.from(cache.values()).map((r) => ({ ...r }));
  }

  public async save(record: DeviceQuotaRecord): Promise<void> {
    const cache = await this.ensureInitialized();
    cache.set(record.mac, { ...record });
    await this.persistToDisk();
  }

  public async delete(mac: string): Promise<boolean> {
    const cache = await this.ensureInitialized();
    const existed = cache.delete(mac);
    if (existed) {
      await this.persistToDisk();
    }
    return existed;
  }
}

export const quotaRepository = new FileQuotaRepository();
