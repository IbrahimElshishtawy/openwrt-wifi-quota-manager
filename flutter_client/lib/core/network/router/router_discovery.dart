import 'dart:async';
import 'package:dio/dio.dart';

import 'router_adapter.dart';
import 'router_capability.dart';
import 'router_profile.dart';

/// Result of probing and fingerprinting a router device.
class RouterDiscoveryResult {
  final bool isReachable;
  final RouterVendor vendor;
  final String model;
  final String hardwareRevision;
  final String firmware;
  final bool isOpenWrt;
  final bool hasLuci;
  final bool hasUbus;
  final bool hasRestApi;
  final String adapterId;
  final RouterCapabilities capabilities;
  final OpenWrtCompatibilityMetadata? openWrtCompatibility;
  final int responseTimeMs;
  final String? details;

  const RouterDiscoveryResult({
    required this.isReachable,
    required this.vendor,
    required this.model,
    this.hardwareRevision = 'Unknown',
    required this.firmware,
    required this.isOpenWrt,
    required this.hasLuci,
    required this.hasUbus,
    required this.hasRestApi,
    required this.adapterId,
    required this.capabilities,
    this.openWrtCompatibility,
    required this.responseTimeMs,
    this.details,
  });

  Map<String, dynamic> toJson() {
    return {
      'is_reachable': isReachable,
      'vendor': vendor.identifier,
      'model': model,
      'hardware_revision': hardwareRevision,
      'firmware': firmware,
      'is_openwrt': isOpenWrt,
      'has_luci': hasLuci,
      'has_ubus': hasUbus,
      'has_rest_api': hasRestApi,
      'adapter_id': adapterId,
      'capabilities': capabilities.toJson(),
      'openwrt_compatibility': openWrtCompatibility?.toJson(),
      'response_time_ms': responseTimeMs,
      'details': details,
    };
  }
}

/// Multi-method discovery and detection engine for network routers.
///
/// Discovers device characteristics without assuming OpenWrt is running.
/// Inspects HTTP headers, LuCI endpoints, ubus RPC, REST APIs, and vendor HTML fingerprints.
class RouterDiscovery {
  final Dio _dio;

  RouterDiscovery({Dio? dio})
      : _dio = dio ??
            Dio(
              BaseOptions(
                connectTimeout: const Duration(seconds: 3),
                receiveTimeout: const Duration(seconds: 3),
                validateStatus: (status) => status != null && status < 500,
              ),
            );

  /// Performs full discovery and fingerprinting against the router IP/port.
  Future<RouterDiscoveryResult> discover(RouterConnectionConfig config) async {
    final stopwatch = Stopwatch()..start();

    if (config.isDemoMode) {
      stopwatch.stop();
      return RouterDiscoveryResult(
        isReachable: true,
        vendor: RouterVendor.openwrt,
        model: 'OpenWrt Virtual Gateway (Simulator)',
        hardwareRevision: 'Demo-v1',
        firmware: '23.05.2 (Simulated)',
        isOpenWrt: true,
        hasLuci: true,
        hasUbus: true,
        hasRestApi: true,
        adapterId: 'openwrt',
        capabilities: RouterCapabilities.openwrt(),
        openWrtCompatibility: const OpenWrtCompatibilityMetadata(
          isSupported: true,
          targetArchitecture: 'Virtual x86_64',
          flashSizeMb: 128,
          ramMb: 512,
          supportedReleases: ['21.02', '22.03', '23.05'],
          installMethod: 'Pre-installed Virtual Image',
          recoveryMethod: 'Reset preferences',
          hardwareRevisionNotes: 'Simulator environment.',
        ),
        responseTimeMs: stopwatch.elapsedMilliseconds,
        details: 'Running in offline simulation mode.',
      );
    }

    final host = config.host;
    final port = config.port;
    final protocol = config.protocol;
    final baseUrl = '$protocol://$host:$port';

    // Step 1: Probe REST API (Quota Manager daemon on port 8080 or specified port)
    bool hasRestApi = false;
    String apiVersion = '';
    try {
      final res = await _dio.get('$baseUrl/health');
      if (res.statusCode == 200 && res.data is Map) {
        final data = res.data as Map;
        final svc = data['service']?.toString() ?? '';
        if (svc.contains('OpenWrt Wi-Fi Quota Manager') || svc.contains('Quota Manager')) {
          hasRestApi = true;
          apiVersion = data['version']?.toString() ?? '1.0.0';
        }
      }
    } catch (_) {}

    // If REST API responded directly, we have verified OpenWrt with Quota Manager!
    if (hasRestApi) {
      stopwatch.stop();
      final profile = RouterProfile.knownProfiles.firstWhere(
        (p) => p.vendor == RouterVendor.openwrt,
      );
      return RouterDiscoveryResult(
        isReachable: true,
        vendor: RouterVendor.openwrt,
        model: 'OpenWrt Gateway',
        hardwareRevision: 'Active Quota Gateway',
        firmware: 'OpenWrt ($apiVersion)',
        isOpenWrt: true,
        hasLuci: true,
        hasUbus: true,
        hasRestApi: true,
        adapterId: 'openwrt',
        capabilities: RouterCapabilities.openwrt(),
        openWrtCompatibility: profile.openWrtCompatibility,
        responseTimeMs: stopwatch.elapsedMilliseconds,
        details: 'Verified OpenWrt Quota Manager REST API on $baseUrl',
      );
    }

    // Step 2: Multi-method OpenWrt & Web Server probe (port 80 or baseUrl)
    final webUrl = port == 8080 ? '$protocol://$host:80' : baseUrl;
    bool hasLuci = false;
    bool hasUbus = false;
    String responseBody = '';
    Map<String, List<String>> responseHeaders = {};

    try {
      final res = await _dio.get(webUrl);
      responseBody = res.data?.toString() ?? '';
      responseHeaders = res.headers.map;
    } catch (_) {}

    // Check LuCI
    try {
      final luciRes = await _dio.get('$webUrl/cgi-bin/luci');
      final luciBody = luciRes.data?.toString() ?? '';
      if (luciBody.contains('LuCI') ||
          luciBody.contains('luci.css') ||
          luciRes.headers.value('server')?.contains('uhttpd') == true) {
        hasLuci = true;
      }
    } catch (_) {}

    // Check ubus RPC
    try {
      final ubusRes = await _dio.post(
        '$webUrl/ubus',
        data: {
          'jsonrpc': '2.0',
          'method': 'call',
          'params': ['00000000000000000000000000000000', 'system', 'info', {}],
        },
      );
      if (ubusRes.statusCode == 200) {
        hasUbus = true;
      }
    } catch (_) {}

    final serverHeader = responseHeaders['server']?.join(' ') ?? '';

    // If LuCI or ubus or uhttpd detected, it is OpenWrt
    if (hasLuci || hasUbus || serverHeader.toLowerCase().contains('uhttpd')) {
      stopwatch.stop();
      return RouterDiscoveryResult(
        isReachable: true,
        vendor: RouterVendor.openwrt,
        model: 'OpenWrt Router (Stock/Custom)',
        hardwareRevision: 'OpenWrt OS',
        firmware: 'OpenWrt (LuCI / ubus active)',
        isOpenWrt: true,
        hasLuci: hasLuci,
        hasUbus: hasUbus,
        hasRestApi: hasRestApi,
        adapterId: 'openwrt',
        capabilities: RouterCapabilities.openwrt(),
        openWrtCompatibility: const OpenWrtCompatibilityMetadata(
          isSupported: true,
          targetArchitecture: 'OpenWrt native',
          flashSizeMb: 64,
          ramMb: 128,
          supportedReleases: ['21.02', '22.03', '23.05'],
          installMethod: 'Installed',
          recoveryMethod: 'LuCI / Failsafe',
          hardwareRevisionNotes: 'OpenWrt detected. Install quota-manager daemon for Level 5 enforcement.',
        ),
        responseTimeMs: stopwatch.elapsedMilliseconds,
        details: 'OpenWrt detected via LuCI / uhttpd on $webUrl',
      );
    }

    // Step 3: Fingerprint Non-OpenWrt Vendors (ZTE, Huawei, TP-Link, Generic)
    final combinedFingerprint = '$serverHeader $responseBody'.toLowerCase();

    // Check ZTE
    if (combinedFingerprint.contains('zxhn') ||
        combinedFingerprint.contains('zte') ||
        combinedFingerprint.contains('h108n') ||
        combinedFingerprint.contains('h168n') ||
        combinedFingerprint.contains('h188a') ||
        combinedFingerprint.contains('f660') ||
        combinedFingerprint.contains('f670')) {
      stopwatch.stop();

      String model = 'ZXHN H168N';
      String rev = 'v3.5';
      if (combinedFingerprint.contains('h108n')) {
        model = 'ZXHN H108N';
        rev = 'v2.x';
      } else if (combinedFingerprint.contains('h188a')) {
        model = 'ZXHN H188A';
        rev = 'v1.0';
      } else if (combinedFingerprint.contains('f660')) {
        model = 'ZXHN F660';
        rev = 'GPON ONT';
      }

      final profile = RouterProfile.findMatchingProfile(
        vendor: RouterVendor.zte,
        model: model,
        revision: rev,
      );

      return RouterDiscoveryResult(
        isReachable: true,
        vendor: RouterVendor.zte,
        model: profile.model,
        hardwareRevision: profile.hardwareRevision,
        firmware: 'ZTE Stock ISP Firmware',
        isOpenWrt: false,
        hasLuci: false,
        hasUbus: false,
        hasRestApi: false,
        adapterId: 'zte',
        capabilities: profile.capabilities,
        openWrtCompatibility: profile.openWrtCompatibility,
        responseTimeMs: stopwatch.elapsedMilliseconds,
        details: 'ZTE router detected. Level 1/2 support (device discovery & MAC filter).',
      );
    }

    // Check Huawei
    if (combinedFingerprint.contains('huawei') ||
        combinedFingerprint.contains('hg531') ||
        combinedFingerprint.contains('hg532') ||
        combinedFingerprint.contains('hg658') ||
        combinedFingerprint.contains('dn8245') ||
        combinedFingerprint.contains('echolife')) {
      stopwatch.stop();

      String model = 'HG658 V2';
      String rev = 'v2';
      if (combinedFingerprint.contains('hg531') || combinedFingerprint.contains('hg532')) {
        model = 'EchoLife HG531 V1 / HG532e';
        rev = 'v1';
      } else if (combinedFingerprint.contains('dn8245')) {
        model = 'DN8245V / EG8145V5';
        rev = 'v1';
      }

      final profile = RouterProfile.findMatchingProfile(
        vendor: RouterVendor.huawei,
        model: model,
        revision: rev,
      );

      return RouterDiscoveryResult(
        isReachable: true,
        vendor: RouterVendor.huawei,
        model: profile.model,
        hardwareRevision: profile.hardwareRevision,
        firmware: 'Huawei Stock VOS Firmware',
        isOpenWrt: false,
        hasLuci: false,
        hasUbus: false,
        hasRestApi: false,
        adapterId: 'huawei',
        capabilities: profile.capabilities,
        openWrtCompatibility: profile.openWrtCompatibility,
        responseTimeMs: stopwatch.elapsedMilliseconds,
        details: 'Huawei router detected. Level 1/2 support (device discovery & MAC filter).',
      );
    }

    // Check TP-Link
    if (combinedFingerprint.contains('tp-link') ||
        combinedFingerprint.contains('tplink') ||
        combinedFingerprint.contains('archer') ||
        combinedFingerprint.contains('wr840n')) {
      stopwatch.stop();

      String model = 'Archer C6';
      String rev = 'v2 (EU/US/RU)';
      if (combinedFingerprint.contains('wr840n')) {
        model = 'TL-WR840N';
        rev = 'v5';
      } else if (combinedFingerprint.contains('v3')) {
        rev = 'v3 (EU/US/RU)';
      }

      final profile = RouterProfile.findMatchingProfile(
        vendor: RouterVendor.tplink,
        model: model,
        revision: rev,
      );

      return RouterDiscoveryResult(
        isReachable: true,
        vendor: RouterVendor.tplink,
        model: profile.model,
        hardwareRevision: profile.hardwareRevision,
        firmware: 'TP-Link Stock OEM Firmware',
        isOpenWrt: false,
        hasLuci: false,
        hasUbus: false,
        hasRestApi: false,
        adapterId: 'tplink',
        capabilities: profile.capabilities,
        openWrtCompatibility: profile.openWrtCompatibility,
        responseTimeMs: stopwatch.elapsedMilliseconds,
        details: 'TP-Link router detected. OpenWrt compatible: ${profile.isOpenWrtCompatible}',
      );
    }

    // Fallback: Generic Router
    stopwatch.stop();
    final isReachable = responseBody.isNotEmpty || responseHeaders.isNotEmpty;
    return RouterDiscoveryResult(
      isReachable: isReachable,
      vendor: RouterVendor.generic,
      model: 'Standard Network Gateway',
      hardwareRevision: 'Generic',
      firmware: serverHeader.isNotEmpty ? serverHeader : 'Generic Web Server',
      isOpenWrt: false,
      hasLuci: false,
      hasUbus: false,
      hasRestApi: false,
      adapterId: 'generic',
      capabilities: RouterCapabilities.generic(),
      openWrtCompatibility: const OpenWrtCompatibilityMetadata(
        isSupported: false,
        targetArchitecture: 'Unknown',
        flashSizeMb: 0,
        ramMb: 0,
        supportedReleases: [],
        installMethod: 'Not verified',
        recoveryMethod: 'Manufacturer default',
        hardwareRevisionNotes:
            'Unrecognized router. Use External Gateway Mode for full quota management.',
      ),
      responseTimeMs: stopwatch.elapsedMilliseconds,
      details: isReachable
          ? 'Connected to generic router at $webUrl'
          : 'Host unreachable or did not respond on HTTP ports.',
    );
  }
}
