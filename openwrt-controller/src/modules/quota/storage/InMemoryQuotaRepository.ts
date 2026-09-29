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

  public async getAll(): Promise<DeviceQuotaRecord[]> {
    return Array.from(this.records.values()).map((r) => ({ ...r }));
  }

  public async getByMac(mac: string): Promise<DeviceQuotaRecord | null> {
    const rec = this.records.get(mac);
    return rec ? { ...rec } : null;
  }

  public async create(record: DeviceQuotaRecord): Promise<void> {
    await this.save(record);
  }

  public async update(record: DeviceQuotaRecord): Promise<void> {
    await this.save(record);
  }

  public async exists(mac: string): Promise<boolean> {
    return this.records.has(mac);
  }

  public async findById(mac: string): Promise<DeviceQuotaRecord | null> {
    return this.getByMac(mac);
  }

  public async findAll(): Promise<DeviceQuotaRecord[]> {
    return this.getAll();
  }

  public async save(record: DeviceQuotaRecord): Promise<void> {
    this.records.set(record.mac, { ...record });
  }

  public async saveAll(records: DeviceQuotaRecord[]): Promise<void> {
    for (const record of records) {
      this.records.set(record.mac, { ...record });
    }
  }

  public async delete(mac: string): Promise<boolean> {
    return this.records.delete(mac);
  }

  public clear(): void {
    this.records.clear();
  }
}
