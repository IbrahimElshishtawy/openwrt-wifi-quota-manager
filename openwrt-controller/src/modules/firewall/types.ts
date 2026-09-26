export type BlockSource = 'manual' | 'quota';

export interface BlockResult {
  success: boolean;
  mac: string;
  isBlocked: boolean;
  message: string;
  alreadyBlocked?: boolean;
}

export interface UnblockResult {
  success: boolean;
  mac: string;
  isBlocked: boolean;
  message: string;
  wasBlocked?: boolean;
}

export interface FirewallStatus {
  tableExists: boolean;
  setExists: boolean;
  chainExists: boolean;
  blockedCount: number;
  blockedMacs: string[];
}

export class InvalidMacAddressError extends Error {
  public readonly statusCode = 400;
  public readonly code = 'INVALID_MAC_ADDRESS';

  constructor(message: string = 'Invalid MAC address format') {
    super(message);
    this.name = 'InvalidMacAddressError';
  }
}

export class InfrastructureDeviceError extends Error {
  public readonly statusCode = 400;
  public readonly code = 'INFRASTRUCTURE_DEVICE_PROTECTED';

  constructor(message: string = 'Cannot block router or infrastructure network devices') {
    super(message);
    this.name = 'InfrastructureDeviceError';
  }
}

export class NonClientDeviceError extends Error {
  public readonly statusCode = 400;
  public readonly code = 'NON_CLIENT_DEVICE';

  constructor(message: string = 'Device is not a legitimate LAN client') {
    super(message);
    this.name = 'NonClientDeviceError';
  }
}

export class FirewallError extends Error {
  public readonly statusCode = 502;
  public readonly code: string;

  constructor(message: string, public readonly cause?: unknown, code: string = 'FIREWALL_ERROR') {
    super(message);
    this.name = 'FirewallError';
    this.code = code;
  }
}

export class FirewallExecutionError extends FirewallError {
  constructor(message: string, cause?: unknown) {
    super(message, cause, 'FIREWALL_EXECUTION_ERROR');
    this.name = 'FirewallExecutionError';
  }
}

