import type { DeviceQuotaRecord } from '../types.js';

/**
 * Interface defining the persistence contract for device quotas.
 * Decouples domain logic from the underlying storage mechanism (File, SQLite, PostgreSQL, etc.).
 */
export interface IQuotaRepository {
  /**
   * Retrieves all stored quota records.
   */
  getAll(): Promise<DeviceQuotaRecord[]>;

  /**
   * Retrieves a quota record by normalized MAC address.
   */
  getByMac(mac: string): Promise<DeviceQuotaRecord | null>;

  /**
   * Creates a new quota record.
   */
  create(record: DeviceQuotaRecord): Promise<void>;

  /**
   * Updates an existing quota record.
   */
  update(record: DeviceQuotaRecord): Promise<void>;

  /**
   * Deletes a quota record by normalized MAC address.
   * Returns true if deleted, false if not found.
   */
  delete(mac: string): Promise<boolean>;

  /**
   * Checks whether a quota record exists for the given MAC address.
   */
  exists(mac: string): Promise<boolean>;

  // Backward-compatibility aliases for existing codebase & tests
  findById(mac: string): Promise<DeviceQuotaRecord | null>;
  findAll(): Promise<DeviceQuotaRecord[]>;
  save(record: DeviceQuotaRecord): Promise<void>;
}
