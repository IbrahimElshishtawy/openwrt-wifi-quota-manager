import 'router_capability.dart';

/// Router hardware vendor
enum RouterVendor {
  openwrt('OpenWrt', 'openwrt'),
  zte('ZTE', 'zte'),
  huawei('Huawei', 'huawei'),
  tplink('TP-Link', 'tplink'),
  generic('Generic Router', 'generic'),
  unknown('Unknown Vendor', 'unknown');

  final String displayName;
  final String identifier;

  const RouterVendor(this.displayName, this.identifier);

  static RouterVendor fromIdentifier(String id) {
    return RouterVendor.values.firstWhere(
      (v) => v.identifier == id.toLowerCase(),
      orElse: () => RouterVendor.unknown,
    );
  }
}

/// Metadata describing OpenWrt compatibility for non-OpenWrt OEM routers.
///
/// Ensures safe evaluation before any consideration of firmware installation:
/// - Explicit hardware revision checks (e.g. Archer C6 v2 vs v3)
/// - Flash and RAM size constraints
/// - Documented recovery mechanisms
class OpenWrtCompatibilityMetadata {
  final bool isSupported;
  final String targetArchitecture;
  final int flashSizeMb;
  final int ramMb;
  final List<String> supportedReleases;
  final String installMethod;
  final String recoveryMethod;
  final String hardwareRevisionNotes;

  const OpenWrtCompatibilityMetadata({
    required this.isSupported,
    required this.targetArchitecture,
    required this.flashSizeMb,
    required this.ramMb,
    required this.supportedReleases,
    required this.installMethod,
    required this.recoveryMethod,
    required this.hardwareRevisionNotes,
  });

  Map<String, dynamic> toJson() {
    return {
      'is_supported': isSupported,
      'target_architecture': targetArchitecture,
      'flash_size_mb': flashSizeMb,
      'ram_mb': ramMb,
      'supported_releases': supportedReleases,
      'install_method': installMethod,
      'recovery_method': recoveryMethod,
      'hardware_revision_notes': hardwareRevisionNotes,
    };
  }

  factory OpenWrtCompatibilityMetadata.fromJson(Map<String, dynamic> json) {
    return OpenWrtCompatibilityMetadata(
      isSupported: json['is_supported'] as bool? ?? false,
      targetArchitecture: json['target_architecture'] as String? ?? 'unknown',
      flashSizeMb: (json['flash_size_mb'] as num?)?.toInt() ?? 0,
      ramMb: (json['ram_mb'] as num?)?.toInt() ?? 0,
      supportedReleases: (json['supported_releases'] as List<dynamic>?)
              ?.map((e) => e.toString())
              .toList() ??
          const [],
      installMethod: json['install_method'] as String? ?? 'Manual via OEM UI or TFTP',
      recoveryMethod: json['recovery_method'] as String? ?? 'TFTP Recovery',
      hardwareRevisionNotes: json['hardware_revision_notes'] as String? ?? '',
    );
  }
}

/// Router Profile representing a recognized router model, its capabilities,
/// and whether it can run OpenWrt natively or should be paired with an External Gateway.
class RouterProfile {
  final RouterVendor vendor;
  final String model;
  final String hardwareRevision;
  final String firmwareVersion;
  final String adapterId;
  final int defaultPort;
  final RouterCapabilities capabilities;
  final OpenWrtCompatibilityMetadata? openWrtCompatibility;

  const RouterProfile({
    required this.vendor,
    required this.model,
    this.hardwareRevision = 'Unknown',
    this.firmwareVersion = 'Stock',
    required this.adapterId,
    this.defaultPort = 80,
    required this.capabilities,
    this.openWrtCompatibility,
  });

  bool get isOpenWrtCompatible => openWrtCompatibility?.isSupported ?? false;

  Map<String, dynamic> toJson() {
    return {
      'vendor': vendor.identifier,
      'model': model,
      'hardware_revision': hardwareRevision,
      'firmware_version': firmwareVersion,
      'adapter_id': adapterId,
      'default_port': defaultPort,
      'capabilities': capabilities.toJson(),
      'openwrt_compatibility': openWrtCompatibility?.toJson(),
    };
  }

  /// Known Router Profiles Catalog (Egyptian Market & Standard Routers)
  static final List<RouterProfile> knownProfiles = [
    // OpenWrt Full Gateway Implementation
    RouterProfile(
      vendor: RouterVendor.openwrt,
      model: 'OpenWrt Gateway / Router',
      hardwareRevision: 'Universal',
      firmwareVersion: '21.02+ / 22.03+ / 23.05+',
      adapterId: 'openwrt',
      defaultPort: 8080,
      capabilities: RouterCapabilities.openwrt(),
      openWrtCompatibility: const OpenWrtCompatibilityMetadata(
        isSupported: true,
        targetArchitecture: 'Native OpenWrt',
        flashSizeMb: 128,
        ramMb: 256,
        supportedReleases: ['21.02', '22.03', '23.05'],
        installMethod: 'Native OpenWrt Installation',
        recoveryMethod: 'Failsafe mode / TFTP',
        hardwareRevisionNotes: 'Active OpenWrt Gateway running Python REST API & nftables.',
      ),
    ),

    // ZTE ZXHN H108N (Common WE ADSL2+ Router)
    RouterProfile(
      vendor: RouterVendor.zte,
      model: 'ZXHN H108N',
      hardwareRevision: 'v2.x - v4.x',
      firmwareVersion: 'ISP Stock',
      adapterId: 'zte',
      defaultPort: 80,
      capabilities: RouterCapabilities.zte(supportsMacFilter: true),
      openWrtCompatibility: const OpenWrtCompatibilityMetadata(
        isSupported: false,
        targetArchitecture: 'Broadcom BCM6328 / TrendChip',
        flashSizeMb: 8,
        ramMb: 32,
        supportedReleases: [],
        installMethod: 'Not recommended or unsupported.',
        recoveryMethod: 'Serial/JTAG only.',
        hardwareRevisionNotes:
            'Insufficient RAM/Flash for modern OpenWrt. Use External Gateway Mode.',
      ),
    ),

    // ZTE ZXHN H168N (Common WE / Orange VDSL2 Gateway)
    RouterProfile(
      vendor: RouterVendor.zte,
      model: 'ZXHN H168N',
      hardwareRevision: 'v3.1 / v3.5',
      firmwareVersion: 'ISP Stock (WE/Orange/Vodafone)',
      adapterId: 'zte',
      defaultPort: 80,
      capabilities: RouterCapabilities.zte(supportsMacFilter: true),
      openWrtCompatibility: const OpenWrtCompatibilityMetadata(
        isSupported: false,
        targetArchitecture: 'Broadcom BCM63168 / RTL8676',
        flashSizeMb: 16,
        ramMb: 64,
        supportedReleases: [],
        installMethod: 'Proprietary VDSL drivers closed source. Not supported natively.',
        recoveryMethod: 'Serial recovery.',
        hardwareRevisionNotes:
            'DSL modem driver lacks open-source support. Deploy OpenWrt behind as Gateway.',
      ),
    ),

    // ZTE ZXHN H188A (WE Wi-Fi 6 VDSL Router)
    RouterProfile(
      vendor: RouterVendor.zte,
      model: 'ZXHN H188A',
      hardwareRevision: 'v1.0',
      firmwareVersion: 'ISP Stock',
      adapterId: 'zte',
      defaultPort: 80,
      capabilities: RouterCapabilities.zte(supportsMacFilter: true),
      openWrtCompatibility: const OpenWrtCompatibilityMetadata(
        isSupported: false,
        targetArchitecture: 'ZTE Proprietary / MTK',
        flashSizeMb: 128,
        ramMb: 256,
        supportedReleases: [],
        installMethod: 'Locked secure boot bootloader.',
        recoveryMethod: 'ISP OEM firmware only.',
        hardwareRevisionNotes: 'Secure boot prevents third-party firmware.',
      ),
    ),

    // Huawei EchoLife HG531 V1 / HG532e
    RouterProfile(
      vendor: RouterVendor.huawei,
      model: 'EchoLife HG531 V1 / HG532e',
      hardwareRevision: 'v1',
      firmwareVersion: 'ISP Stock',
      adapterId: 'huawei',
      defaultPort: 80,
      capabilities: RouterCapabilities.huawei(supportsMacFilter: true),
      openWrtCompatibility: const OpenWrtCompatibilityMetadata(
        isSupported: false,
        targetArchitecture: 'Ralink RT63365 / Broadcom',
        flashSizeMb: 4,
        ramMb: 32,
        supportedReleases: [],
        installMethod: 'Not supported due to 4MB flash limit.',
        recoveryMethod: 'Serial/TFTP OEM recovery.',
        hardwareRevisionNotes: '4MB flash size cannot accommodate OpenWrt kernel.',
      ),
    ),

    // Huawei HG658 V2 (Very widely used by WE / Vodafone in Egypt)
    RouterProfile(
      vendor: RouterVendor.huawei,
      model: 'HG658 V2',
      hardwareRevision: 'v2',
      firmwareVersion: 'ISP Stock (WE / Vodafone)',
      adapterId: 'huawei',
      defaultPort: 80,
      capabilities: RouterCapabilities.huawei(supportsMacFilter: true),
      openWrtCompatibility: const OpenWrtCompatibilityMetadata(
        isSupported: false,
        targetArchitecture: 'Broadcom BCM63168',
        flashSizeMb: 16,
        ramMb: 64,
        supportedReleases: [],
        installMethod: 'Proprietary BCM VDSL blobs not supported by OpenWrt mainline.',
        recoveryMethod: 'CFE web server recovery.',
        hardwareRevisionNotes:
            'Proprietary VDSL2 modem firmware. Recommended: OpenWrt External Gateway Mode.',
      ),
    ),

    // Huawei DN8245V (SuperVectoring / Fiber Gateway)
    RouterProfile(
      vendor: RouterVendor.huawei,
      model: 'DN8245V / EG8145V5',
      hardwareRevision: 'v1',
      firmwareVersion: 'ISP Stock',
      adapterId: 'huawei',
      defaultPort: 80,
      capabilities: RouterCapabilities.huawei(supportsMacFilter: true),
      openWrtCompatibility: const OpenWrtCompatibilityMetadata(
        isSupported: false,
        targetArchitecture: 'HiSilicon / Broadcom',
        flashSizeMb: 128,
        ramMb: 256,
        supportedReleases: [],
        installMethod: 'Carrier signed firmware enforcement.',
        recoveryMethod: 'Huawei ONT recovery.',
        hardwareRevisionNotes: 'Locked bootloader prevents third-party flashing.',
      ),
    ),

    // TP-Link Archer C6 v2 (OpenWrt Compatible!)
    RouterProfile(
      vendor: RouterVendor.tplink,
      model: 'Archer C6',
      hardwareRevision: 'v2 (EU/US/RU)',
      firmwareVersion: 'Stock OEM / OpenWrt Ready',
      adapterId: 'tplink',
      defaultPort: 80,
      capabilities: RouterCapabilities.tplinkStock(supportsMacFilter: true),
      openWrtCompatibility: const OpenWrtCompatibilityMetadata(
        isSupported: true,
        targetArchitecture: 'ramips/mt7621',
        flashSizeMb: 16,
        ramMb: 128,
        supportedReleases: ['21.02', '22.03', '23.05'],
        installMethod: 'OEM Web UI upgrade menu with factory.bin image, or TFTP recovery.',
        recoveryMethod:
            'TFTP Server on 192.168.0.66 serving ArcherC6v2_tp_recovery.bin during WPS boot.',
        hardwareRevisionNotes:
            'Hardware revision v2 is verified compatible! Note: Do NOT flash v3 images on v2 hardware.',
      ),
    ),

    // TP-Link Archer C6 v3 (OpenWrt Compatible with different SoC/image!)
    RouterProfile(
      vendor: RouterVendor.tplink,
      model: 'Archer C6',
      hardwareRevision: 'v3 (EU/US/RU)',
      firmwareVersion: 'Stock OEM / OpenWrt Ready',
      adapterId: 'tplink',
      defaultPort: 80,
      capabilities: RouterCapabilities.tplinkStock(supportsMacFilter: true),
      openWrtCompatibility: const OpenWrtCompatibilityMetadata(
        isSupported: true,
        targetArchitecture: 'ramips/mt7621 (MT7621DAT)',
        flashSizeMb: 16,
        ramMb: 128,
        supportedReleases: ['22.03', '23.05'],
        installMethod: 'OEM Web UI upgrade menu with factory.bin, or TFTP.',
        recoveryMethod:
            'TFTP Server on 192.168.0.66 serving ArcherC6v3_tp_recovery.bin on power toggle.',
        hardwareRevisionNotes:
            'Revision v3 uses integrated RAM SoC. Must use dedicated Archer C6 v3 firmware image!',
      ),
    ),

    // TP-Link TL-WR840N (Budget router, NOT compatible with modern OpenWrt due to 4MB flash)
    RouterProfile(
      vendor: RouterVendor.tplink,
      model: 'TL-WR840N',
      hardwareRevision: 'v4 - v6',
      firmwareVersion: 'Stock OEM',
      adapterId: 'tplink',
      defaultPort: 80,
      capabilities: RouterCapabilities.tplinkStock(supportsMacFilter: true),
      openWrtCompatibility: const OpenWrtCompatibilityMetadata(
        isSupported: false,
        targetArchitecture: 'MediaTek MT7628NN',
        flashSizeMb: 4,
        ramMb: 32,
        supportedReleases: [],
        installMethod: 'Unsupported due to 4MB flash limit.',
        recoveryMethod: 'TFTP recovery.',
        hardwareRevisionNotes:
            'Modern OpenWrt requires minimum 8MB flash and 64MB RAM. Use as dumb AP behind OpenWrt Gateway.',
      ),
    ),

    // Generic Fallback Router Profile
    RouterProfile(
      vendor: RouterVendor.generic,
      model: 'Standard LAN Router',
      hardwareRevision: 'Generic',
      firmwareVersion: 'Unknown',
      adapterId: 'generic',
      defaultPort: 80,
      capabilities: RouterCapabilities.generic(),
      openWrtCompatibility: const OpenWrtCompatibilityMetadata(
        isSupported: false,
        targetArchitecture: 'Unknown',
        flashSizeMb: 0,
        ramMb: 0,
        supportedReleases: [],
        installMethod: 'Compatibility unverified.',
        recoveryMethod: 'Refer to device manufacturer manual.',
        hardwareRevisionNotes:
            'Generic profile. Deploy an OpenWrt Gateway device on LAN for full quota management.',
      ),
    ),
  ];

  static RouterProfile findMatchingProfile({
    required RouterVendor vendor,
    String? model,
    String? revision,
  }) {
    if (vendor == RouterVendor.openwrt) {
      return knownProfiles.firstWhere((p) => p.vendor == RouterVendor.openwrt);
    }

    if (model != null && model.isNotEmpty) {
      final normalizedModel = model.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]'), '');
      for (final profile in knownProfiles) {
        final profileModel = profile.model.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]'), '');
        if (normalizedModel.contains(profileModel) || profileModel.contains(normalizedModel)) {
          if (revision != null && revision.isNotEmpty && revision != 'Unknown') {
            final normalizedRev = revision.toLowerCase();
            if (profile.hardwareRevision.toLowerCase().contains(normalizedRev)) {
              return profile;
            }
          }
          return profile;
        }
      }
    }

    // Vendor-level fallback
    return knownProfiles.firstWhere(
      (p) => p.vendor == vendor,
      orElse: () => knownProfiles.last, // generic
    );
  }
}
