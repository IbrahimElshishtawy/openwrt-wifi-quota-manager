class TopConsumer {
  final String mac;
  final String name;
  final double usageGb;

  const TopConsumer({
    required this.mac,
    required this.name,
    required this.usageGb,
  });

  factory TopConsumer.fromJson(Map<String, dynamic> json) {
    return TopConsumer(
      mac: (json['mac'] as String?)?.toUpperCase() ?? '00:00:00:00:00:00',
      name: json['name'] as String? ?? 'Device',
      usageGb: (json['usage_gb'] as num?)?.toDouble() ?? 0.0,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'mac': mac,
      'name': name,
      'usage_gb': usageGb,
    };
  }
}

class QuotaReport {
  final double totalBandwidthUsedGb;
  final double packageTotalGb;
  final double packageRemainingGb;
  final int cycleDaysRemaining;
  final List<TopConsumer> topConsumers;

  const QuotaReport({
    required this.totalBandwidthUsedGb,
    required this.packageTotalGb,
    required this.packageRemainingGb,
    required this.cycleDaysRemaining,
    required this.topConsumers,
  });

  double get usedRatio {
    if (packageTotalGb <= 0) return 0.0;
    return (totalBandwidthUsedGb / packageTotalGb).clamp(0.0, 1.0);
  }

  double get usedPercentage {
    return usedRatio * 100;
  }

  bool get isNearLimit => usedRatio >= 0.85;

  factory QuotaReport.fromJson(Map<String, dynamic> json) {
    final used = (json['total_bandwidth_used_gb'] as num?)?.toDouble() ?? 0.0;
    final total = (json['package_total_gb'] as num?)?.toDouble() ?? 250.0;
    final remaining = (json['package_remaining_gb'] as num?)?.toDouble() ?? (total - used).clamp(0, 9999).toDouble();
    final days = (json['cycle_days_remaining'] as num?)?.toInt() ?? 15;

    final consumersRaw = json['top_consumers'] as List<dynamic>? ?? [];
    final consumers = consumersRaw
        .map((c) => TopConsumer.fromJson(c as Map<String, dynamic>))
        .toList();

    return QuotaReport(
      totalBandwidthUsedGb: used,
      packageTotalGb: total,
      packageRemainingGb: remaining,
      cycleDaysRemaining: days,
      topConsumers: consumers,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'status': 'success',
      'total_bandwidth_used_gb': totalBandwidthUsedGb,
      'package_total_gb': packageTotalGb,
      'package_remaining_gb': packageRemainingGb,
      'cycle_days_remaining': cycleDaysRemaining,
      'top_consumers': topConsumers.map((c) => c.toJson()).toList(),
    };
  }
}
