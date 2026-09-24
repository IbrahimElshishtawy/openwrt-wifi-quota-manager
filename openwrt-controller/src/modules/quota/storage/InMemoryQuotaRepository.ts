import type { DeviceQuotaRecord } from '../types.js';
import type { IQuotaRepository } from './IQuotaRepository.js';

/**
 * In-memory repository implementation primarily utilized for fast, isolated unit testing.
 */
export class InMemoryQuotaRepository implements IQuotaRepository {
  private readonly records = new Map<string, DeviceQuotaRecord>();

  constructor(initialRecords: DeviceQuotaRecord[] = []) {
    for (const rec of initialRecords) {
      this.records.set(rec.mac, { ...rec });
    }
  }

  public async findById(mac: string): Promise<DeviceQuotaRecord | null> {
    const rec = this.records.get(mac);
    return rec ? { ...rec } : null;
  }

  public async findAll(): Promise<DeviceQuotaRecord[]> {
    return Array.from(this.records.values()).map((r) => ({ ...r }));
  }

  public async save(record: DeviceQuotaRecord): Promise<void> {
    this.records.set(record.mac, { ...record });
  }

  public async delete(mac: string): Promise<boolean> {
    return this.records.delete(mac);
  }

  public clear(): void {
    this.records.clear();
  }
}
