import '../../../../features/devices/domain/models/device_model.dart';
import '../../storage/preferences_service.dart';
import '../openwrt_client.dart';
import 'adapter_registry.dart';
import 'connection_diagnostics.dart';
import 'quota_engine.dart';
import 'router_adapter.dart';
import 'router_capability.dart';
import 'router_discovery.dart';
import 'router_profile.dart';

/// Central coordinator for router operations in the Flutter application.
///
/// Dispatches calls to the currently active [RouterAdapter] based on dynamic
/// capability detection. Prevents invalid operations and decouples the UI
/// from specific router vendor internals.
class RouterService {
  final RouterAdapterRegistry _registry;
  final PreferencesService _preferencesService;
  final RouterDiscovery _discovery;
  final ConnectionDiagnostics _diagnostics;

  RouterAdapter _activeAdapter;
  RouterProfile _currentProfile;
  QuotaEngine _quotaEngine;

  RouterService({
    required RouterAdapterRegistry registry,
    required PreferencesService preferencesService,
    RouterDiscovery? discovery,
    ConnectionDiagnostics? diagnostics,
    RouterAdapter? initialAdapter,
  })  : _registry = registry,
        // ignore: prefer_initializing_formals
        _preferencesService = preferencesService,
        _discovery = discovery ?? RouterDiscovery(),
        _diagnostics = diagnostics ?? ConnectionDiagnostics(),
        _activeAdapter = initialAdapter ??
            registry.getAdapter('openwrt') ??
            registry.allAdapters.first,
        _currentProfile = RouterProfile.knownProfiles.firstWhere(
          (p) => p.vendor == RouterVendor.openwrt,
        ),
        _quotaEngine = QuotaEngine(
          initialAdapter ??
              registry.getAdapter('openwrt') ??
              registry.allAdapters.first,
        );

  RouterAdapter get activeAdapter => _activeAdapter;
  RouterCapabilities get capabilities => _activeAdapter.capabilities;
  RouterProfile get currentProfile => _currentProfile;
  QuotaEngine get quotaEngine => _quotaEngine;

  /// Current connection configuration derived from user preferences
  RouterConnectionConfig get currentConfig => RouterConnectionConfig(
        host: _preferencesService.routerIp,
        port: _preferencesService.routerPort,
        protocol: _preferencesService.routerProtocol,
        username: _preferencesService.routerUsername,
        password: _preferencesService.routerPassword,
        apiKey: _preferencesService.apiKey,
        isDemoMode: _preferencesService.isDemoMode,
      );

  /// Automatically discovers the router at the configured host, resolves the
  /// best adapter from the registry, and updates current capabilities.
  Future<RouterDiscoveryResult> autoDetectAndSelectAdapter() async {
    final result = await _discovery.discover(currentConfig);

    final bestAdapter = _registry.findBestAdapter(result.vendor);
    _activeAdapter = bestAdapter;
    _quotaEngine = QuotaEngine(_activeAdapter);
    _currentProfile = RouterProfile.findMatchingProfile(
      vendor: result.vendor,
      model: result.model,
      revision: result.hardwareRevision,
    );

    await _activeAdapter.connect(currentConfig);
    return result;
  }

  /// Manually switches the active adapter by its identifier.
  void setAdapter(String adapterId) {
    final adapter = _registry.getAdapter(adapterId);
    if (adapter != null) {
      _activeAdapter = adapter;
      _quotaEngine = QuotaEngine(adapter);
      _currentProfile = RouterProfile.findMatchingProfile(
        vendor: adapter.vendor,
      );
    }
  }

  /// Executes comprehensive multi-phase connection diagnostics.
  Future<ConnectionDiagnosticReport> runDiagnostics() async {
    return await _diagnostics.runDiagnostics(
      currentConfig,
      adapter: _activeAdapter,
    );
  }

  /// Backward-compatible connection test returning standard [ConnectionTestResultInfo].
  Future<ConnectionTestResultInfo> testConnection() async {
    final report = await runDiagnostics();
    if (report.overallPass) {
      return ConnectionTestResultInfo.success(
        responseTimeMs: report.totalDurationMs,
        details:
            '${report.profile.model} (${report.capabilities.enforcementLevel.title}) on ${currentConfig.baseUrl}',
      );
    } else {
      final failedStep = report.steps.firstWhere(
        (s) => s.status == DiagnosticStatus.fail,
        orElse: () => report.steps.first,
      );
      return ConnectionTestResultInfo.failure(
        status: ConnectionTestStatus.routerUnreachable,
        message: failedStep.message,
        details: failedStep.details,
      );
    }
  }

  // --- Forwarded Router Operations with Capability Guarding ---

  Future<RouterInfo> getRouterInfo() async {
    return await _activeAdapter.getRouterInfo();
  }

  Future<List<DeviceModel>> getDevices() async {
    if (!capabilities.devices) {
      throw UnsupportedCapabilityException('devices', capabilities.getReason('devices'));
    }
    return await _activeAdapter.getDevices();
  }

  Future<DeviceModel?> getDevice(String mac) async {
    if (!capabilities.devices) {
      throw UnsupportedCapabilityException('devices', capabilities.getReason('devices'));
    }
    return await _activeAdapter.getDevice(mac);
  }

  Future<void> registerDevice(DeviceModel device) async {
    await _activeAdapter.registerDevice(device);
  }

  Future<void> removeDevice(String mac) async {
    await _activeAdapter.removeDevice(mac);
  }

  Future<RouterTrafficStats> getUsage() async {
    if (!capabilities.usage) {
      throw UnsupportedCapabilityException('usage', capabilities.getReason('usage'));
    }
    return await _activeAdapter.getUsage();
  }

  Future<DeviceUsage?> getDeviceUsage(String mac) async {
    if (!capabilities.usage) {
      throw UnsupportedCapabilityException('usage', capabilities.getReason('usage'));
    }
    return await _activeAdapter.getDeviceUsage(mac);
  }

  Future<void> blockDevice(String mac) async {
    if (!capabilities.block) {
      throw UnsupportedCapabilityException('block', capabilities.getReason('block'));
    }
    await _activeAdapter.blockDevice(mac);
  }

  Future<void> unblockDevice(String mac) async {
    if (!capabilities.unblock) {
      throw UnsupportedCapabilityException('unblock', capabilities.getReason('unblock'));
    }
    await _activeAdapter.unblockDevice(mac);
  }

  Future<void> setQuota(String mac, double quotaGb, {bool enabled = true}) async {
    if (!capabilities.quota) {
      throw UnsupportedCapabilityException('quota', capabilities.getReason('quota'));
    }
    await _activeAdapter.setQuota(mac, quotaGb, enabled: enabled);
  }

  Future<double?> getQuota(String mac) async {
    if (!capabilities.quota) {
      throw UnsupportedCapabilityException('quota', capabilities.getReason('quota'));
    }
    return await _activeAdapter.getQuota(mac);
  }

  Future<void> resetQuota(String mac) async {
    if (!capabilities.quota) {
      throw UnsupportedCapabilityException('quota', capabilities.getReason('quota'));
    }
    await _activeAdapter.resetQuota(mac);
  }
}
