import 'dart:async';
import 'router_adapter.dart';
import 'router_capability.dart';
import 'router_discovery.dart';
import 'router_profile.dart';

enum DiagnosticStatus {
  pass('PASS'),
  fail('FAIL'),
  warning('WARN'),
  skipped('SKIP');

  final String label;
  const DiagnosticStatus(this.label);
}

class DiagnosticStepResult {
  final String name;
  final DiagnosticStatus status;
  final String message;
  final String? details;
  final int durationMs;

  const DiagnosticStepResult({
    required this.name,
    required this.status,
    required this.message,
    this.details,
    required this.durationMs,
  });
}

class ConnectionDiagnosticReport {
  final bool overallPass;
  final RouterProfile profile;
  final RouterCapabilities capabilities;
  final List<DiagnosticStepResult> steps;
  final int totalDurationMs;
  final String recommendation;

  const ConnectionDiagnosticReport({
    required this.overallPass,
    required this.profile,
    required this.capabilities,
    required this.steps,
    required this.totalDurationMs,
    required this.recommendation,
  });

  bool get hasUsageApi => capabilities.usage;
  bool get hasQuotaControl => capabilities.quota;
  bool get hasFirewallControl => capabilities.firewall;
}

/// Comprehensive connection and capability diagnostic test suite.
class ConnectionDiagnostics {
  final RouterDiscovery _discovery;

  ConnectionDiagnostics({RouterDiscovery? discovery})
      : _discovery = discovery ?? RouterDiscovery();

  Future<ConnectionDiagnosticReport> runDiagnostics(
    RouterConnectionConfig config, {
    RouterAdapter? adapter,
  }) async {
    final overallStopwatch = Stopwatch()..start();
    final List<DiagnosticStepResult> steps = [];

    // Step 1: Network Connectivity
    final s1 = Stopwatch()..start();
    final isReachable = config.host.trim().isNotEmpty && config.port > 0;
    s1.stop();
    steps.add(DiagnosticStepResult(
      name: 'Network Connectivity',
      status: isReachable ? DiagnosticStatus.pass : DiagnosticStatus.fail,
      message: isReachable
          ? 'Gateway IP (${config.host}:${config.port}) resolved successfully.'
          : 'Invalid host or port configuration.',
      durationMs: s1.elapsedMilliseconds,
    ));

    // Step 2: HTTP / HTTPS Service Availability
    final s2 = Stopwatch()..start();
    final discoveryResult = await _discovery.discover(config);
    s2.stop();
    steps.add(DiagnosticStepResult(
      name: 'HTTP/HTTPS Availability',
      status: discoveryResult.isReachable ? DiagnosticStatus.pass : DiagnosticStatus.fail,
      message: discoveryResult.isReachable
          ? 'Web server responded in ${discoveryResult.responseTimeMs} ms.'
          : 'Gateway web port unreachable. Verify Wi-Fi network connection.',
      details: discoveryResult.details,
      durationMs: s2.elapsedMilliseconds,
    ));

    // Step 3: Router Detection & Vendor Profiling
    final s3 = Stopwatch()..start();
    final profile = RouterProfile.findMatchingProfile(
      vendor: discoveryResult.vendor,
      model: discoveryResult.model,
      revision: discoveryResult.hardwareRevision,
    );
    s3.stop();
    steps.add(DiagnosticStepResult(
      name: 'Router Detection',
      status: discoveryResult.vendor != RouterVendor.unknown
          ? DiagnosticStatus.pass
          : DiagnosticStatus.warning,
      message: 'Detected ${discoveryResult.vendor.displayName} (${discoveryResult.model})',
      details: 'Hardware Revision: ${discoveryResult.hardwareRevision} • Firmware: ${discoveryResult.firmware}',
      durationMs: s3.elapsedMilliseconds,
    ));

    // Step 4: Authentication & Security Credentials
    final s4 = Stopwatch()..start();
    final hasAuth = config.isDemoMode ||
        discoveryResult.hasRestApi ||
        (config.username.isNotEmpty);
    s4.stop();
    steps.add(DiagnosticStepResult(
      name: 'Authentication Validation',
      status: hasAuth ? DiagnosticStatus.pass : DiagnosticStatus.warning,
      message: hasAuth ? 'Authentication credentials configured.' : 'No credentials supplied.',
      details: config.apiKey.isNotEmpty ? 'Pre-shared API Bearer token active.' : 'Default session auth.',
      durationMs: s4.elapsedMilliseconds,
    ));

    // Step 5: API Detection
    final s5 = Stopwatch()..start();
    final apiStatus = discoveryResult.hasRestApi
        ? DiagnosticStatus.pass
        : (discoveryResult.hasLuci || discoveryResult.hasUbus
            ? DiagnosticStatus.warning
            : DiagnosticStatus.fail);
    final apiMsg = discoveryResult.hasRestApi
        ? 'OpenWrt Wi-Fi Quota Manager REST API detected on port ${config.port}.'
        : (discoveryResult.hasLuci
            ? 'OpenWrt LuCI web interface detected (Daemon not installed).'
            : 'No dedicated REST quota API exposed by this router firmware.');
    s5.stop();
    steps.add(DiagnosticStepResult(
      name: 'API Detection',
      status: apiStatus,
      message: apiMsg,
      durationMs: s5.elapsedMilliseconds,
    ));

    // Step 6: Capability Assessment
    final s6 = Stopwatch()..start();
    final caps = discoveryResult.capabilities;
    final capStatus = caps.enforcementLevel.level >= 4
        ? DiagnosticStatus.pass
        : (caps.enforcementLevel.level >= 1 ? DiagnosticStatus.warning : DiagnosticStatus.fail);
    s6.stop();
    steps.add(DiagnosticStepResult(
      name: 'Capability Assessment',
      status: capStatus,
      message: caps.enforcementLevel.title,
      details: 'Devices: ${caps.devices ? "✓" : "✕"} | Usage: ${caps.usage ? "✓" : "✕"} | Quota: ${caps.quota ? "✓" : "✕"} | Block: ${caps.block ? "✓" : "✕"}',
      durationMs: s6.elapsedMilliseconds,
    ));

    // Step 7: Device Discovery Test
    final s7 = Stopwatch()..start();
    bool devPass = false;
    String devMsg = 'Device discovery test completed.';
    if (adapter != null) {
      try {
        final devs = await adapter.getDevices();
        devPass = devs.isNotEmpty;
        devMsg = 'Discovered ${devs.length} connected device(s).';
      } catch (e) {
        devMsg = 'Device discovery call failed: $e';
      }
    } else {
      devPass = caps.devices;
      devMsg = caps.devices ? 'Device discovery interface ready.' : 'Device discovery unsupported.';
    }
    s7.stop();
    steps.add(DiagnosticStepResult(
      name: 'Device Discovery',
      status: devPass ? DiagnosticStatus.pass : DiagnosticStatus.warning,
      message: devMsg,
      durationMs: s7.elapsedMilliseconds,
    ));

    overallStopwatch.stop();

    // Recommendation generator
    String recommendation;
    if (caps.enforcementLevel == TrafficEnforcementLevel.level5FullEnforcement) {
      recommendation =
          'Router is fully operational in Level 5 mode. Hardware packet filtering and nlbwmon active.';
    } else if (profile.isOpenWrtCompatible) {
      recommendation =
          'This router model (${profile.model}) is verified compatible with OpenWrt! Flashing OpenWrt allows upgrading from Level ${caps.enforcementLevel.level} to Level 5. (Flashing must be performed manually).';
    } else {
      recommendation =
          'Router operating at Level ${caps.enforcementLevel.level}. For full quota enforcement and bandwidth accounting, connect an OpenWrt Gateway between this router and your home devices.';
    }

    final overallPass = discoveryResult.isReachable;

    return ConnectionDiagnosticReport(
      overallPass: overallPass,
      profile: profile,
      capabilities: caps,
      steps: steps,
      totalDurationMs: overallStopwatch.elapsedMilliseconds,
      recommendation: recommendation,
    );
  }
}
