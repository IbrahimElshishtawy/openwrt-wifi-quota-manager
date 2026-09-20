/// Traffic enforcement levels representing the true technical capability
/// of a network device, from monitoring-only up to kernel-level packet filtering.
enum TrafficEnforcementLevel {
  level0MonitoringOnly(
    0,
    'Level 0: Monitoring Only',
    'Passive device detection without active state tracking.',
  ),
  level1DeviceDiscovery(
    1,
    'Level 1: Device Discovery',
    'Discovers active LAN clients via DHCP leases, ARP tables, or UPnP.',
  ),
  level2BlockUnblock(
    2,
    'Level 2: Block / Unblock',
    'Supports binary access blocking (e.g. Parental Control / MAC filtering).',
  ),
  level3UsageMonitoring(
    3,
    'Level 3: Usage Monitoring',
    'Passive bandwidth accounting per device without quota enforcement.',
  ),
  level4QuotaManagement(
    4,
    'Level 4: Quota Management',
    'Software or driver-level bandwidth limits with automated warnings.',
  ),
  level5FullEnforcement(
    5,
    'Level 5: Full Traffic Enforcement',
    'Hardware / kernel-grade packet filtering (nftables/iptables) + nlbwmon.',
  );

  final int level;
  final String title;
  final String description;

  const TrafficEnforcementLevel(this.level, this.title, this.description);
}

/// Dynamic capability matrix describing what a specific router adapter
/// is genuinely capable of executing.
///
/// Prevents "fake compatibility" by ensuring UI actions and engine operations
/// are only permitted when backed by real router mechanisms.
class RouterCapabilities {
  final bool devices;
  final bool usage;
  final bool block;
  final bool unblock;
  final bool quota;
  final bool trafficShaping;
  final bool dhcp;
  final bool firewall;
  final bool nlbwmon;
  final TrafficEnforcementLevel enforcementLevel;
  final Map<String, String> unsupportedReasons;

  const RouterCapabilities({
    required this.devices,
    required this.usage,
    required this.block,
    required this.unblock,
    required this.quota,
    required this.trafficShaping,
    required this.dhcp,
    required this.firewall,
    required this.nlbwmon,
    required this.enforcementLevel,
    this.unsupportedReasons = const {},
  });

  /// Factory for OpenWrt running Wi-Fi Quota Manager daemon (Level 5)
  factory RouterCapabilities.openwrt() {
    return const RouterCapabilities(
      devices: true,
      usage: true,
      block: true,
      unblock: true,
      quota: true,
      trafficShaping: true,
      dhcp: true,
      firewall: true,
      nlbwmon: true,
      enforcementLevel: TrafficEnforcementLevel.level5FullEnforcement,
      unsupportedReasons: {},
    );
  }

  /// Factory for standard ZTE Egyptian ISP routers (e.g. ZXHN H108N, H168N, H188A)
  factory RouterCapabilities.zte({bool supportsMacFilter = true}) {
    return RouterCapabilities(
      devices: true,
      usage: false,
      block: supportsMacFilter,
      unblock: supportsMacFilter,
      quota: false,
      trafficShaping: false,
      dhcp: true,
      firewall: false,
      nlbwmon: false,
      enforcementLevel: supportsMacFilter
          ? TrafficEnforcementLevel.level2BlockUnblock
          : TrafficEnforcementLevel.level1DeviceDiscovery,
      unsupportedReasons: {
        'usage': 'ZTE stock firmware does not expose per-device traffic accounting APIs.',
        'quota': 'ZTE stock firmware lacks quota management. Use External Gateway Mode for full quota control.',
        'traffic_shaping': 'Per-client bandwidth throttling is not supported on this ZTE model.',
        'firewall': 'Direct netfilter/firewall manipulation is locked by ISP firmware.',
        'nlbwmon': 'nlbwmon requires OpenWrt Linux kernel support.',
      },
    );
  }

  /// Factory for standard Huawei Egyptian ISP routers (e.g. HG531, HG658 V2, DN8245V)
  factory RouterCapabilities.huawei({bool supportsMacFilter = true}) {
    return RouterCapabilities(
      devices: true,
      usage: false,
      block: supportsMacFilter,
      unblock: supportsMacFilter,
      quota: false,
      trafficShaping: false,
      dhcp: true,
      firewall: false,
      nlbwmon: false,
      enforcementLevel: supportsMacFilter
          ? TrafficEnforcementLevel.level2BlockUnblock
          : TrafficEnforcementLevel.level1DeviceDiscovery,
      unsupportedReasons: {
        'usage': 'Huawei stock firmware does not expose bandwidth telemetry APIs.',
        'quota': 'Per-device quota enforcement requires OpenWrt or an external gateway.',
        'traffic_shaping': 'Bandwidth shaping requires OpenWrt SQM or tc.',
        'firewall': 'Custom firewall rule injection is restricted on ISP locked Huawei routers.',
        'nlbwmon': 'nlbwmon is unavailable on proprietary Huawei VOS/Linux builds.',
      },
    );
  }

  /// Factory for TP-Link routers running stock OEM firmware
  factory RouterCapabilities.tplinkStock({bool supportsMacFilter = true}) {
    return RouterCapabilities(
      devices: true,
      usage: false,
      block: supportsMacFilter,
      unblock: supportsMacFilter,
      quota: false,
      trafficShaping: false,
      dhcp: true,
      firewall: false,
      nlbwmon: false,
      enforcementLevel: supportsMacFilter
          ? TrafficEnforcementLevel.level2BlockUnblock
          : TrafficEnforcementLevel.level1DeviceDiscovery,
      unsupportedReasons: {
        'usage': 'TP-Link stock web management interface does not provide per-client traffic consumption metrics.',
        'quota': 'Stock TP-Link firmware lacks per-client data quotas. Consider flashing OpenWrt if model is compatible.',
        'traffic_shaping': 'Basic QoS only; precise per-device quota limiting unavailable.',
        'firewall': 'nftables hooks unavailable on stock firmware.',
        'nlbwmon': 'nlbwmon requires OpenWrt installation.',
      },
    );
  }

  /// Factory for generic / unrecognized router implementations
  factory RouterCapabilities.generic() {
    return const RouterCapabilities(
      devices: true,
      usage: false,
      block: false,
      unblock: false,
      quota: false,
      trafficShaping: false,
      dhcp: false,
      firewall: false,
      nlbwmon: false,
      enforcementLevel: TrafficEnforcementLevel.level1DeviceDiscovery,
      unsupportedReasons: {
        'usage': 'Unknown router model: Bandwidth accounting interface undetected.',
        'block': 'Unknown router model: MAC filtering endpoint undetected.',
        'unblock': 'Unknown router model: MAC filtering endpoint undetected.',
        'quota': 'Unknown router model: Quota management unavailable.',
        'traffic_shaping': 'Traffic shaping unavailable.',
        'firewall': 'Firewall control unavailable.',
        'nlbwmon': 'nlbwmon requires OpenWrt gateway.',
      },
    );
  }

  bool isSupported(String capabilityKey) {
    switch (capabilityKey) {
      case 'devices':
        return devices;
      case 'usage':
        return usage;
      case 'block':
        return block;
      case 'unblock':
        return unblock;
      case 'quota':
        return quota;
      case 'traffic_shaping':
        return trafficShaping;
      case 'dhcp':
        return dhcp;
      case 'firewall':
        return firewall;
      case 'nlbwmon':
        return nlbwmon;
      default:
        return false;
    }
  }

  String getReason(String capabilityKey) {
    return unsupportedReasons[capabilityKey] ??
        'This router does not expose a supported interface for this feature.';
  }

  Map<String, dynamic> toJson() {
    return {
      'devices': devices,
      'usage': usage,
      'block': block,
      'unblock': unblock,
      'quota': quota,
      'traffic_shaping': trafficShaping,
      'dhcp': dhcp,
      'firewall': firewall,
      'nlbwmon': nlbwmon,
      'enforcement_level': enforcementLevel.level,
      'unsupported_reasons': unsupportedReasons,
    };
  }

  factory RouterCapabilities.fromJson(Map<String, dynamic> json) {
    final levelInt = (json['enforcement_level'] as num?)?.toInt() ?? 1;
    final level = TrafficEnforcementLevel.values.firstWhere(
      (e) => e.level == levelInt,
      orElse: () => TrafficEnforcementLevel.level1DeviceDiscovery,
    );

    return RouterCapabilities(
      devices: json['devices'] as bool? ?? true,
      usage: json['usage'] as bool? ?? false,
      block: json['block'] as bool? ?? false,
      unblock: json['unblock'] as bool? ?? false,
      quota: json['quota'] as bool? ?? false,
      trafficShaping: json['traffic_shaping'] as bool? ?? false,
      dhcp: json['dhcp'] as bool? ?? false,
      firewall: json['firewall'] as bool? ?? false,
      nlbwmon: json['nlbwmon'] as bool? ?? false,
      enforcementLevel: level,
      unsupportedReasons: (json['unsupported_reasons'] as Map<String, dynamic>?)?.map(
            (k, v) => MapEntry(k, v.toString()),
          ) ??
          const {},
    );
  }
}
