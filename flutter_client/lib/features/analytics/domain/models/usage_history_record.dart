class UsageHistoryRecord {
  final DateTime timestamp;
  final double totalBandwidthUsedGb;
  final double packageTotalGb;
  final double packageRemainingGb;
  final int activeDevicesCount;
  final int blockedDevicesCount;

  const UsageHistoryRecord({
    required this.timestamp,
    required this.totalBandwidthUsedGb,
    required this.packageTotalGb,
    required this.packageRemainingGb,
    required this.activeDevicesCount,
    required this.blockedDevicesCount,
  });
}
