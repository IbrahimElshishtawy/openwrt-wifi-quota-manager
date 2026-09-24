import type { DeviceQuotaRecord } from '../types.js';

/**
 * Interface defining the persistence contract for device quotas.
 * Decouples domain logic from the underlying storage mechanism (File, SQLite, PostgreSQL, etc.).
 */
export interface IQuotaRepository {
  /**
   * Retrieves a quota record by normalized MAC address.
   */
  findById(mac: string): Promise<DeviceQuotaRecord | null>;

  /**
   * Retrieves all stored quota records.
   */
  findAll(): Promise<DeviceQuotaRecord[]>;

  /**
   * Saves or updates a quota record.
   */
  save(record: DeviceQuotaRecord): Promise<void>;

  /**
   * Deletes a quota record by normalized MAC address.
   * Returns true if deleted, false if not found.
   */
  delete(mac: string): Promise<boolean>;
}
