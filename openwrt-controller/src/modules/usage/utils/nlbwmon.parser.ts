import {
  normalizeMac,
  compareIps,
} from '../../devices/utils/network.utils.js';
import {
  UsageFetchError,
  type DeviceUsage,
  type RawNlbwmonResponse,
} from '../types.js';

/**
 * Parses raw stdout from `nlbw -c json`, safely extracts the JSON payload,
 * validates table columns, filters invalid rows, aggregates byte metrics per device,
 * and sorts the result deterministically by IP.
 */
export function parseAndAggregateNlbwOutput(rawOutput: string): DeviceUsage[] {
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
  return Array.from(deviceMap.values()).sort((a, b) => compareIps(a.ip, b.ip));
}

export const nlbwmonParser = {
  parse: parseAndAggregateNlbwOutput,
};
