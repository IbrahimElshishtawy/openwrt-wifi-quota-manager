import {
  sshClient,
  type ISshClient,
} from '../../infrastructure/openwrt/SshClient.js';
import {
  OpenWrtNotConfiguredError,
  OpenWrtConnectionError,
} from '../../infrastructure/openwrt/UbusClient.js';
import {
  devicesService,
  DevicesService,
} from '../devices/DevicesService.js';
import type { DeviceUsage, RawNlbwmonResponse } from './types.js';

export class UsageFetchError extends Error {
  public readonly statusCode = 502;
  public readonly code = 'USAGE_FETCH_ERROR';

  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'UsageFetchError';
  }
}

const MAC_REGEX = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;

export const normalizeMac = (mac: string): string => {
  const trimmed = mac.trim();
  if (!MAC_REGEX.test(trimmed)) {
    throw new Error(`Invalid MAC address format: "${mac}"`);
  }
  return trimmed.replace(/-/g, ':').toUpperCase();
};

export class UsageService {
  constructor(
    private readonly ssh: ISshClient = sshClient,
    private readonly devices: DevicesService = devicesService
  ) {}

  /**
   * Fetches real-time bandwidth consumption per device by executing `nlbw -c json`
   * on the OpenWrt router, parsing the tabular data, aggregating usage by device,
   * and filtering out infrastructure/router/host/libvirt addresses to return ONLY
   * real LAN client devices.
   */
  public async getDeviceUsage(): Promise<DeviceUsage[]> {
    if (!this.ssh.isConfigured()) {
      throw new OpenWrtNotConfiguredError(
        'OpenWrt router host or credentials are not configured. Please check OPENWRT_HOST and credentials.'
      );
    }

    let commandResult;
    try {
      commandResult = await this.ssh.executeCommand('nlbw -c json');
    } catch (err: unknown) {
      if (err instanceof OpenWrtNotConfiguredError || err instanceof OpenWrtConnectionError) {
        throw err;
      }
      throw new UsageFetchError(
        `Failed to execute nlbwmon query on OpenWrt: ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }

    const aggregated = this.parseAndAggregateNlbwOutput(commandResult.stdout);
    return this.filterRealClientUsage(aggregated);
  }

  /**
   * Filters out infrastructure, router, host, and libvirt addresses from the aggregated
   * usage metrics, retaining only valid real LAN clients.
   * Leverages DevicesService as the single source of truth for topology discovery.
   */
  public async filterRealClientUsage(usageList: DeviceUsage[]): Promise<DeviceUsage[]> {
    if (usageList.length === 0) {
      return [];
    }

    const [infra, knownDevices] = await Promise.all([
      this.devices.detectInfrastructure().catch(() => this.devices.getBaselineInfrastructure()),
      this.devices.getConnectedDevices().catch(() => []),
    ]);

    const effectiveInfra = infra ?? this.devices.getBaselineInfrastructure();
    const effectiveDevices = knownDevices ?? [];

    return usageList.filter((device) =>
      this.devices.isRealLanClient(
        { mac: device.mac, ip: device.ip },
        effectiveInfra,
        effectiveDevices
      )
    );
  }

  /**
   * Parses raw stdout from `nlbw -c json`, safely extracts the JSON payload,
   * validates table columns, filters invalid rows, and aggregates byte metrics per device.
   */
  public parseAndAggregateNlbwOutput(rawOutput: string): DeviceUsage[] {
    const trimmed = rawOutput.trim();
    if (!trimmed) {
      return [];
    }

    let parsed: RawNlbwmonResponse;
    try {
      // First attempt direct parse
      parsed = JSON.parse(trimmed) as RawNlbwmonResponse;
    } catch {
      // Extract possible embedded JSON object if banner text precedes it
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start !== -1 && end > start) {
        try {
          parsed = JSON.parse(trimmed.slice(start, end + 1)) as RawNlbwmonResponse;
        } catch (innerErr) {
          throw new UsageFetchError('Failed to parse nlbwmon response: invalid JSON', innerErr);
        }
      } else {
        throw new UsageFetchError('Failed to parse nlbwmon response: invalid JSON');
      }
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new UsageFetchError('Invalid nlbwmon response format: expected a JSON object');
    }

    // Handle empty response or missing data array
    if (!Array.isArray(parsed.data) || parsed.data.length === 0) {
      return [];
    }

    if (!Array.isArray(parsed.columns)) {
      throw new UsageFetchError('nlbwmon response missing columns array');
    }

    const macIndex = parsed.columns.indexOf('mac');
    const ipIndex = parsed.columns.indexOf('ip');
    const rxBytesIndex = parsed.columns.indexOf('rx_bytes');
    const txBytesIndex = parsed.columns.indexOf('tx_bytes');

    if (macIndex === -1 || ipIndex === -1 || rxBytesIndex === -1 || txBytesIndex === -1) {
      throw new UsageFetchError(
        'nlbwmon response columns missing required fields (mac, ip, rx_bytes, tx_bytes)'
      );
    }

    const deviceMap = new Map<string, DeviceUsage>();

    for (const row of parsed.data) {
      if (!Array.isArray(row)) {
        continue;
      }

      const rawMac = row[macIndex];
      const rawIp = row[ipIndex];
      const rawRx = row[rxBytesIndex];
      const rawTx = row[txBytesIndex];

      // Missing or non-string MAC or IP
      if (typeof rawMac !== 'string' || !rawMac.trim()) {
        continue;
      }
      if (typeof rawIp !== 'string' || !rawIp.trim()) {
        continue;
      }

      let normalizedMac: string;
      try {
        normalizedMac = normalizeMac(rawMac);
      } catch {
        // Skip invalid MAC address formats
        continue;
      }

      const ip = rawIp.trim();
      if (!ip || ip === '0.0.0.0') {
        continue;
      }

      const rxBytes = typeof rawRx === 'number' ? rawRx : Number(rawRx);
      const txBytes = typeof rawTx === 'number' ? rawTx : Number(rawTx);

      // Validate numeric byte counters
      if (isNaN(rxBytes) || rxBytes < 0 || isNaN(txBytes) || txBytes < 0) {
        continue;
      }

      const existing = deviceMap.get(normalizedMac);
      if (existing) {
        existing.downloadBytes += rxBytes;
        existing.uploadBytes += txBytes;
        existing.totalBytes += (rxBytes + txBytes);
        if (!existing.ip && ip) {
          existing.ip = ip;
        }
      } else {
        deviceMap.set(normalizedMac, {
          mac: normalizedMac,
          ip,
          downloadBytes: rxBytes,
          uploadBytes: txBytes,
          totalBytes: rxBytes + txBytes,
        });
      }
    }

    // Sort stably by IP address
    return Array.from(deviceMap.values()).sort((a, b) => this.compareIps(a.ip, b.ip));
  }

  private compareIps(ipA: string, ipB: string): number {
    const partsA = ipA.split('.').map((p) => parseInt(p, 10));
    const partsB = ipB.split('.').map((p) => parseInt(p, 10));
    for (let i = 0; i < 4; i++) {
      const a = partsA[i] ?? 0;
      const b = partsB[i] ?? 0;
      if (a !== b) return a - b;
    }
    return 0;
  }
}

export const usageService = new UsageService();
