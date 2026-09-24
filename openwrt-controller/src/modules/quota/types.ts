/**
 * Per-Device Quota data transfer object and domain model definitions.
 */

export interface DeviceQuota {
  mac: string;
  quotaBytes: number;
  usedBytes: number;
  remainingBytes: number;
  percentage: number;
  status: 'active' | 'exhausted';
  createdAt: string;
  updatedAt: string;
}

/**
 * Storage record extending DeviceQuota with internal state tracking
 * for nlbwmon cumulative counter baselines and resets.
 */
export interface DeviceQuotaRecord {
  mac: string;
  quotaBytes: number;
  lastSeenTotalBytes: number;
  accumulatedUsedBytes: number;
  usedBytes: number;
  remainingBytes: number;
  percentage: number;
  status: 'active' | 'exhausted';
  createdAt: string;
  updatedAt: string;
}

export interface CreateQuotaDto {
  mac: string;
  quotaBytes: number;
}

export interface UpdateQuotaDto {
  quotaBytes?: number | undefined;
  resetUsage?: boolean | undefined;
}

export interface QuotaApiResponse {
  success: boolean;
  data: DeviceQuota;
}

export interface QuotaListApiResponse {
  success: boolean;
  data: DeviceQuota[];
  count: number;
}

export interface QuotaDeleteApiResponse {
  success: boolean;
  message: string;
}

/**
 * Domain errors for Quota management
 */
export class QuotaNotFoundError extends Error {
  public readonly statusCode = 404;
  public readonly code = 'QUOTA_NOT_FOUND';

  constructor(mac: string) {
    super(`Quota not found for device with MAC ${mac}`);
    this.name = 'QuotaNotFoundError';
  }
}

export class QuotaAlreadyExistsError extends Error {
  public readonly statusCode = 409;
  public readonly code = 'QUOTA_ALREADY_EXISTS';

  constructor(mac: string) {
    super(`Quota already exists for device with MAC ${mac}`);
    this.name = 'QuotaAlreadyExistsError';
  }
}

export class InvalidDeviceQuotaError extends Error {
  public readonly statusCode = 400;
  public readonly code = 'INVALID_DEVICE_QUOTA';

  constructor(message: string) {
    super(message);
    this.name = 'InvalidDeviceQuotaError';
  }
}

export class QuotaStorageError extends Error {
  public readonly statusCode = 500;
  public readonly code = 'QUOTA_STORAGE_ERROR';

  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'QuotaStorageError';
  }
}

/**
 * Transforms an internal DeviceQuotaRecord to the clean external DeviceQuota entity.
 */
export function toDeviceQuota(record: DeviceQuotaRecord): DeviceQuota {
  return {
    mac: record.mac,
    quotaBytes: record.quotaBytes,
    usedBytes: record.usedBytes,
    remainingBytes: record.remainingBytes,
    percentage: record.percentage,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
