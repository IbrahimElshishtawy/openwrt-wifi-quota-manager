class DeviceModel {
  final String mac;
  final String name;
  final String ip;
  final String hostname;
  final double usageGb;
  final double quotaGb;
  final double remainingGb;
  final bool enabled;
  final bool isBlocked;

  const DeviceModel({
    required this.mac,
    required this.name,
    required this.ip,
    required this.hostname,
    required this.usageGb,
    required this.quotaGb,
    required this.remainingGb,
    required this.enabled,
    required this.isBlocked,
  });

  double get usageRatio {
    if (quotaGb <= 0) return 0.0;
    return (usageGb / quotaGb).clamp(0.0, 1.0);
  }

  bool get isOverQuota => usageGb >= quotaGb;

  bool get isNearLimit => usageRatio >= 0.85;

  factory DeviceModel.fromJson(Map<String, dynamic> json) {
    final usage = (json['usage_gb'] as num?)?.toDouble() ?? 0.0;
    final quota = (json['quota_gb'] as num?)?.toDouble() ?? 0.0;
    final remaining = (json['remaining_gb'] as num?)?.toDouble() ?? (quota - usage).clamp(0, 9999).toDouble();

    return DeviceModel(
      mac: (json['mac'] as String?)?.toUpperCase() ?? '00:00:00:00:00:00',
      name: json['name'] as String? ?? 'Unknown Device',
      ip: json['ip'] as String? ?? '0.0.0.0',
      hostname: json['hostname'] as String? ?? 'unknown',
      usageGb: usage,
      quotaGb: quota,
      remainingGb: remaining,
      enabled: json['enabled'] as bool? ?? true,
      isBlocked: json['is_blocked'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'mac': mac,
      'name': name,
      'ip': ip,
      'hostname': hostname,
      'usage_gb': usageGb,
      'quota_gb': quotaGb,
      'remaining_gb': remainingGb,
      'enabled': enabled,
      'is_blocked': isBlocked,
    };
  }

  DeviceModel copyWith({
    String? mac,
    String? name,
    String? ip,
    String? hostname,
    double? usageGb,
    double? quotaGb,
    double? remainingGb,
    bool? enabled,
    bool? isBlocked,
  }) {
    return DeviceModel(
      mac: mac ?? this.mac,
      name: name ?? this.name,
      ip: ip ?? this.ip,
      hostname: hostname ?? this.hostname,
      usageGb: usageGb ?? this.usageGb,
      quotaGb: quotaGb ?? this.quotaGb,
      remainingGb: remainingGb ?? this.remainingGb,
      enabled: enabled ?? this.enabled,
      isBlocked: isBlocked ?? this.isBlocked,
    );
  }
}
