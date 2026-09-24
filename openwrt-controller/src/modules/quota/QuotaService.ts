import {
  type IQuotaRepository,
} from './storage/IQuotaRepository.js';
import {
  quotaRepository,
} from './storage/FileQuotaRepository.js';
import {
  usageService,
  UsageService,
  type DeviceUsage,
} from '../usage/UsageService.js';
import {
  devicesService,
  DevicesService,
  normalizeMac,
} from '../devices/DevicesService.js';
import {
  type DeviceQuota,
  type DeviceQuotaRecord,
  type CreateQuotaDto,
  type UpdateQuotaDto,
  QuotaNotFoundError,
  QuotaAlreadyExistsError,
  InvalidDeviceQuotaError,
  toDeviceQuota,
} from './types.js';

export {
  QuotaNotFoundError,
  QuotaAlreadyExistsError,
  InvalidDeviceQuotaError,
  normalizeMac,
  toDeviceQuota,
};
export type { DeviceQuota, DeviceQuotaRecord, CreateQuotaDto, UpdateQuotaDto };

/**
 * Production-quality Per-Device Quota Engine.
 * Responsibilities:
 * - Assign and track bandwidth quotas primarily keyed by normalized MAC address.
 * - Capture current nlbwmon cumulative usage as baseline at assignment time so past usage is not charged.
 * - Accurately handle nlbwmon counter resets, rebooting, and wrap-arounds without negative usage.
 * - Calculate used bytes, remaining bytes, usage percentage, and quota status ('active' | 'exhausted').
 * - Strictly validate that targets are real LAN clients (not infrastructure/router/WAN components).
 * - Ensure persistence across application restarts via the pluggable IQuotaRepository interface.
 */
export class QuotaService {
  constructor(
    private readonly repository: IQuotaRepository = quotaRepository,
    private readonly usage: UsageService = usageService,
    private readonly devices: DevicesService = devicesService
  ) {}

  /**
   * Assigns a new internet quota to a LAN client device.
   * Captures the current nlbwmon usage as baseline so previous traffic is not charged against the new quota.
   */
  public async createQuota(dto: CreateQuotaDto): Promise<DeviceQuota> {
    if (!dto.quotaBytes || dto.quotaBytes <= 0 || !Number.isInteger(dto.quotaBytes)) {
      throw new InvalidDeviceQuotaError('quotaBytes must be a positive integer greater than 0.');
    }

    const normMac = this.normalizeAndValidateMac(dto.mac);

    // Ensure a quota does not already exist for this device
    const existing = await this.repository.findById(normMac);
    if (existing) {
      throw new QuotaAlreadyExistsError(normMac);
    }

    // Verify MAC belongs to a discovered, real LAN client (excluding infrastructure)
    await this.validateLanClient(normMac);

    // Fetch current usage to establish the baseline
    const currentUsageList = await this.usage.getDeviceUsage();
    const currentUsage = currentUsageList.find((u) => u.mac === normMac);
    const baselineBytes = currentUsage ? currentUsage.totalBytes : 0;

    const now = new Date().toISOString();
    const record: DeviceQuotaRecord = {
      mac: normMac,
      quotaBytes: dto.quotaBytes,
      lastSeenTotalBytes: baselineBytes,
      accumulatedUsedBytes: 0,
      usedBytes: 0,
      remainingBytes: dto.quotaBytes,
      percentage: 0,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.save(record);
    return toDeviceQuota(record);
  }

  /**
   * Retrieves all assigned device quotas with fresh, real-time usage metrics.
   */
  public async getAllQuotas(): Promise<DeviceQuota[]> {
    const records = await this.repository.findAll();
    if (records.length === 0) {
      return [];
    }

    // Fetch fresh usage from UsageService
    const freshUsageList = await this.usage.getDeviceUsage();

    const updatedQuotas: DeviceQuota[] = [];
    for (const record of records) {
      this.applyFreshUsage(record, freshUsageList);
      await this.repository.save(record);
      updatedQuotas.push(toDeviceQuota(record));
    }

    return updatedQuotas;
  }

  /**
   * Retrieves quota state for a specific device by MAC with fresh usage metrics.
   */
  public async getQuotaByMac(rawMac: string): Promise<DeviceQuota> {
    const normMac = this.normalizeAndValidateMac(rawMac);
    const record = await this.repository.findById(normMac);

    if (!record) {
      throw new QuotaNotFoundError(normMac);
    }

    const freshUsageList = await this.usage.getDeviceUsage();
    this.applyFreshUsage(record, freshUsageList);
    await this.repository.save(record);

    return toDeviceQuota(record);
  }

  /**
   * Updates an existing device quota (quota size and/or explicit usage reset).
   * Modifying quotaBytes does NOT reset usage unless resetUsage is explicitly true.
   */
  public async updateQuota(rawMac: string, dto: UpdateQuotaDto): Promise<DeviceQuota> {
    const normMac = this.normalizeAndValidateMac(rawMac);
    const record = await this.repository.findById(normMac);

    if (!record) {
      throw new QuotaNotFoundError(normMac);
    }

    if (dto.quotaBytes !== undefined) {
      if (dto.quotaBytes <= 0 || !Number.isInteger(dto.quotaBytes)) {
        throw new InvalidDeviceQuotaError('quotaBytes must be a positive integer greater than 0.');
      }
      record.quotaBytes = dto.quotaBytes;
    }

    if (dto.resetUsage === true) {
      // Explicit reset intended: re-capture current usage counter as new baseline
      const freshUsageList = await this.usage.getDeviceUsage();
      const currentUsage = freshUsageList.find((u) => u.mac === normMac);
      record.lastSeenTotalBytes = currentUsage ? currentUsage.totalBytes : 0;
      record.accumulatedUsedBytes = 0;
      record.usedBytes = 0;
    } else {
      // Synchronize with fresh telemetry without resetting accumulated usage
      const freshUsageList = await this.usage.getDeviceUsage().catch(() => []);
      this.applyFreshUsage(record, freshUsageList);
    }

    this.recalculateMetrics(record);
    await this.repository.save(record);

    return toDeviceQuota(record);
  }

  /**
   * Removes a quota assignment for a device. Does not alter router firewall state.
   */
  public async deleteQuota(rawMac: string): Promise<boolean> {
    const normMac = this.normalizeAndValidateMac(rawMac);
    const record = await this.repository.findById(normMac);

    if (!record) {
      throw new QuotaNotFoundError(normMac);
    }

    return this.repository.delete(normMac);
  }

  /**
   * Validates whether a device belongs to a discovered, valid LAN client
   * and prevents assigning quotas to router, WAN, or infrastructure components.
   */
  public async validateLanClient(normMac: string): Promise<void> {
    const infra = await this.devices
      .detectInfrastructure()
      .catch(() => this.devices.getBaselineInfrastructure());

    // 1. Explicit check against excluded infrastructure MACs
    if (infra.excludedMacs.has(normMac)) {
      throw new InvalidDeviceQuotaError(
        `Cannot assign quota to infrastructure device or router interface (MAC: ${normMac}).`
      );
    }

    // 2. Discover known connected devices & active LAN usage
    const [knownDevices, activeUsage] = await Promise.all([
      this.devices.getConnectedDevices().catch(() => []),
      this.usage.getDeviceUsage().catch(() => []),
    ]);

    const matchingKnown = knownDevices.find((d) => d.mac === normMac);
    const matchingUsage = activeUsage.find((u) => u.mac === normMac);

    if (!matchingKnown && !matchingUsage) {
      throw new InvalidDeviceQuotaError(
        `Device with MAC ${normMac} is not a valid discovered LAN client. Please ensure the device has connected to the OpenWrt network.`
      );
    }

    // 3. Delegate to DevicesService.isRealLanClient to apply topology exclusion rules
    const candidate = matchingKnown ?? {
      mac: normMac,
      ip: matchingUsage?.ip ?? null,
      hostname: null,
      interface: null,
    };

    const isReal = this.devices.isRealLanClient(candidate, infra, knownDevices);
    if (!isReal) {
      throw new InvalidDeviceQuotaError(
        `Cannot assign quota to infrastructure device or non-LAN client (${normMac}).`
      );
    }
  }

  /**
   * Updates an in-memory quota record based on fresh nlbwmon cumulative telemetry.
   * Handles cumulative counter progression and detects counter resets/rollovers.
   */
  public applyFreshUsage(record: DeviceQuotaRecord, usageList: DeviceUsage[]): void {
    const usage = usageList.find((u) => u.mac === record.mac);
    if (!usage) {
      // Device had no traffic in current nlbwmon query window; preserve existing state
      return;
    }

    const currentCumulative = usage.totalBytes;

    if (currentCumulative < record.lastSeenTotalBytes) {
      // Counter Reset Detected: nlbwmon restarted, rolled over, or rotated period.
      // In this new counter cycle starting from 0, the device generated currentCumulative bytes.
      const deltaSinceReset = currentCumulative;
      record.accumulatedUsedBytes += deltaSinceReset;
      record.lastSeenTotalBytes = currentCumulative;
    } else {
      // Monotonic progression: delta is current - lastSeen
      const delta = currentCumulative - record.lastSeenTotalBytes;
      record.accumulatedUsedBytes += delta;
      record.lastSeenTotalBytes = currentCumulative;
    }

    this.recalculateMetrics(record);
  }

  /**
   * Recalculates remainingBytes, percentage, status, and updatedAt timestamp.
   */
  public recalculateMetrics(record: DeviceQuotaRecord): void {
    record.usedBytes = Math.max(0, record.accumulatedUsedBytes);
    record.remainingBytes = Math.max(0, record.quotaBytes - record.usedBytes);

    if (record.quotaBytes <= 0) {
      record.percentage = 0;
    } else {
      const rawPct = (record.usedBytes / record.quotaBytes) * 100;
      // Clamp between 0% and 100% and round to 2 decimal places
      record.percentage = Number(Math.min(100, Math.max(0, rawPct)).toFixed(2));
    }

    record.status = record.usedBytes >= record.quotaBytes ? 'exhausted' : 'active';
    record.updatedAt = new Date().toISOString();
  }

  /**
   * Validates MAC format and returns standardized uppercase colon-separated format.
   */
  private normalizeAndValidateMac(rawMac: string): string {
    if (!rawMac || typeof rawMac !== 'string') {
      throw new InvalidDeviceQuotaError('MAC address must be a non-empty string.');
    }
    try {
      return normalizeMac(rawMac);
    } catch {
      throw new InvalidDeviceQuotaError(`Invalid MAC address format: "${rawMac}". Must be XX:XX:XX:XX:XX:XX.`);
    }
  }
}

export const quotaService = new QuotaService();
