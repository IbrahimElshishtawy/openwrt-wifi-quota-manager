/**
 * Domain error representing a failure during usage metrics retrieval or processing.
 */
export class UsageFetchError extends Error {
  public readonly statusCode = 502;
  public readonly code = 'USAGE_FETCH_ERROR';

  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'UsageFetchError';
  }
}

/**
 * Raw JSON output returned by `nlbw -c json` from OpenWrt nlbwmon.
 */
export interface RawNlbwmonResponse {
  columns: string[];
  data: Array<Array<string | number | null | undefined>>;
}

/**
 * Normalized per-device traffic accounting metrics.
 */
export interface DeviceUsage {
  mac: string;
  ip: string;
  downloadBytes: number;
  uploadBytes: number;
  totalBytes: number;
}

/**
 * Standard API response envelope for GET /api/usage.
 */
export interface UsageApiResponse {
  success: boolean;
  data: DeviceUsage[];
  count?: number;
}
