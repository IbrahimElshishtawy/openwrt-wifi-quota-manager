export interface LanSubnet {
  network: string;
  mask: number;
  cidr: string;
}

export const MAC_REGEX = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;

/**
 * Normalizes a MAC address string to standard uppercase colon-separated format.
 * Throws an Error if the MAC format is invalid.
 */
export const normalizeMac = (mac: string): string => {
  const trimmed = mac.trim();
  if (!MAC_REGEX.test(trimmed)) {
    throw new Error(`Invalid MAC address format: "${mac}"`);
  }
  return trimmed.replace(/-/g, ':').toUpperCase();
};

/**
 * Converts an IPv4 address string to an unsigned 32-bit integer.
 */
export function ipToInt(ip: string): number {
  return ip
    .split('.')
    .reduce((acc, octet) => ((acc << 8) + parseInt(octet, 10)) >>> 0, 0);
}

/**
 * Converts an unsigned 32-bit integer to an IPv4 address string.
 */
export function intToIp(int: number): string {
  return [
    (int >>> 24) & 255,
    (int >>> 16) & 255,
    (int >>> 8) & 255,
    int & 255,
  ].join('.');
}

/**
 * Converts a CIDR prefix length (0-32) to an unsigned 32-bit subnet mask.
 */
export function maskToInt(mask: number): number {
  return mask === 0 ? 0 : (~0 << (32 - mask)) >>> 0;
}

/**
 * Calculates network address and CIDR from an IP and prefix mask.
 */
export function calculateSubnet(address: string, mask: number): LanSubnet {
  const ipInt = ipToInt(address);
  const maskInt = maskToInt(mask);
  const netInt = (ipInt & maskInt) >>> 0;
  const network = intToIp(netInt);
  return {
    network,
    mask,
    cidr: `${network}/${mask}`,
  };
}

/**
 * Checks whether an IPv4 address falls within a given network and mask.
 */
export function isIpInSubnet(ip: string, network: string, mask: number): boolean {
  try {
    const ipInt = ipToInt(ip);
    const netInt = ipToInt(network);
    const maskInt = maskToInt(mask);
    return (ipInt & maskInt) === (netInt & maskInt);
  } catch {
    return false;
  }
}

/**
 * Compares two IPv4 addresses numerically for deterministic sorting.
 */
export function compareIps(ipA: string | null, ipB: string | null): number {
  if (!ipA) return 1;
  if (!ipB) return -1;
  const partsA = ipA.split('.').map((p) => parseInt(p, 10));
  const partsB = ipB.split('.').map((p) => parseInt(p, 10));
  for (let i = 0; i < 4; i++) {
    const a = partsA[i] ?? 0;
    const b = partsB[i] ?? 0;
    if (a !== b) return a - b;
  }
  return 0;
}
