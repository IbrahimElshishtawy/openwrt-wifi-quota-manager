import {
  OpenWrtConnectionError,
  OpenWrtNotConfiguredError,
} from '../../infrastructure/openwrt/UbusClient.js';
import {
  FirewallError,
  FirewallExecutionError,
  InvalidMacAddressError,
  InfrastructureDeviceError,
  NonClientDeviceError,
} from '../firewall/types.js';
import {
  QuotaNotFoundError,
  QuotaAlreadyExistsError,
  InvalidDeviceQuotaError,
  QuotaStorageError,
} from '../quota/types.js';

export type EnforcementErrorCategory =
  | 'SSH_FAILURE'
  | 'FIREWALL_FAILURE'
  | 'QUOTA_FAILURE'
  | 'REPOSITORY_FAILURE'
  | 'VALIDATION_FAILURE'
  | 'CONFIGURATION_FAILURE'
  | 'UNKNOWN_FAILURE';

export class QuotaEnforcementError extends Error {
  public readonly category: EnforcementErrorCategory;
  public override readonly cause?: unknown;

  constructor(message: string, category: EnforcementErrorCategory, cause?: unknown) {
    super(message);
    this.name = 'QuotaEnforcementError';
    this.category = category;
    this.cause = cause;
  }
}

/**
 * Classifies an unknown error into a structured QuotaEnforcementError, preserving the original cause.
 */
export function classifyError(err: unknown, fallbackCategory?: EnforcementErrorCategory): QuotaEnforcementError {
  if (err instanceof QuotaEnforcementError) {
    return err;
  }

  const message = err instanceof Error ? err.message : String(err);
  const lowerMsg = message.toLowerCase();

  // 1. SSH / OpenWrt Connection errors
  if (
    err instanceof OpenWrtConnectionError ||
    (err as { code?: string })?.code === 'OPENWRT_UNAVAILABLE' ||
    lowerMsg.includes('ssh') ||
    lowerMsg.includes('timed out') ||
    lowerMsg.includes('connection refused') ||
    lowerMsg.includes('connecttimeout')
  ) {
    return new QuotaEnforcementError(message, 'SSH_FAILURE', err);
  }

  // 2. Configuration errors
  if (
    err instanceof OpenWrtNotConfiguredError ||
    (err as { code?: string })?.code === 'OPENWRT_NOT_CONFIGURED' ||
    lowerMsg.includes('not configured in environment')
  ) {
    return new QuotaEnforcementError(message, 'CONFIGURATION_FAILURE', err);
  }

  // 3. Validation errors
  if (
    err instanceof InvalidMacAddressError ||
    err instanceof InfrastructureDeviceError ||
    err instanceof NonClientDeviceError ||
    lowerMsg.includes('invalid mac') ||
    lowerMsg.includes('infrastructure component') ||
    lowerMsg.includes('not recognized as a legitimate lan client')
  ) {
    return new QuotaEnforcementError(message, 'VALIDATION_FAILURE', err);
  }

  // 4. Firewall execution errors
  if (
    err instanceof FirewallExecutionError ||
    err instanceof FirewallError ||
    lowerMsg.includes('nftables') ||
    lowerMsg.includes('firewall')
  ) {
    return new QuotaEnforcementError(message, 'FIREWALL_FAILURE', err);
  }

  // 5. Quota repository storage errors
  if (
    err instanceof QuotaStorageError ||
    lowerMsg.includes('quota storage') ||
    lowerMsg.includes('persist quotas')
  ) {
    return new QuotaEnforcementError(message, 'REPOSITORY_FAILURE', err);
  }

  // 6. Quota logic errors
  if (
    err instanceof QuotaNotFoundError ||
    err instanceof QuotaAlreadyExistsError ||
    err instanceof InvalidDeviceQuotaError ||
    lowerMsg.includes('quota')
  ) {
    return new QuotaEnforcementError(message, 'QUOTA_FAILURE', err);
  }

  return new QuotaEnforcementError(message, fallbackCategory ?? 'UNKNOWN_FAILURE', err);
}
