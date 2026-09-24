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
import { normalizeMac } from '../devices/utils/network.utils.js';
import {
  UsageFetchError,
  type DeviceUsage,
  type RawNlbwmonResponse,
  type UsageApiResponse,
} from './types.js';
import { parseAndAggregateNlbwOutput } from './utils/nlbwmon.parser.js';

// Re-export error and utilities for public module consumers and tests
export { UsageFetchError, normalizeMac };
export type { DeviceUsage, RawNlbwmonResponse, UsageApiResponse };

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
   * Delegates parsing and aggregation of raw stdout from `nlbw -c json`
   * to the dedicated Nlbwmon parser engine.
   */
  public parseAndAggregateNlbwOutput(rawOutput: string): DeviceUsage[] {
    return parseAndAggregateNlbwOutput(rawOutput);
  }
}

export const usageService = new UsageService();
