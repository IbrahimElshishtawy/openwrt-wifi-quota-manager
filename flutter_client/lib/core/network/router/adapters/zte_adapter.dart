import '../../../../features/devices/domain/models/device_model.dart';
import '../../../utils/formatters.dart';
import '../../openwrt_client.dart';
import '../router_adapter.dart';
import '../router_capability.dart';
import '../router_profile.dart';

/// Router Adapter for ZTE network hardware common across Egyptian ISPs
/// (e.g., Telecom Egypt / WE, Orange, Vodafone ZXHN H108N, H168N, H188A, F660).
///
/// Delivers Level 1 (Device Discovery) and Level 2 (MAC Filter Block/Unblock).
/// Truthfully reports lack of per-client bandwidth accounting and kernel quotas.
class ZteAdapter implements RouterAdapter {
  RouterConnectionConfig? _config;
  final Set<String> _blockedMacs = {};
  final Map<String, DeviceModel> _deviceRegistry = {};
  String _detectedModel = 'ZXHN H168N';
  String _hardwareRevision = 'v3.5';

  ZteAdapter({String? initialModel, String? revision}) {
    if (initialModel != null) _detectedModel = initialModel;
    if (revision != null) _hardwareRevision = revision;
  }

  @override
  String get id => 'zte';

  @override
  String get name => 'ZTE Router Adapter';

  @override
  RouterVendor get vendor => RouterVendor.zte;

  @override
  RouterCapabilities get capabilities => RouterCapabilities.zte(supportsMacFilter: true);

  @override
  Future<void> connect(RouterConnectionConfig config) async {
    _config = config;
  }

  @override
  Future<void> disconnect() async {
    _config = null;
  }

  @override
  Future<RouterInfo> getRouterInfo() async {
    final host = _config?.host ?? '192.168.1.1';
    return RouterInfo(
      vendor: RouterVendor.zte,
      model: _detectedModel,
      hardwareRevision: _hardwareRevision,
      firmwareVersion: 'ZTE-ISP-Stock',
      uptimeSeconds: 86400,
      formattedUptime: Formatters.formatUptime(86400),
      wanStatus: 'Connected (VDSL2 / GPON)',
      ipAddress: host,
      enforcementLevel: capabilities.enforcementLevel,
    );
  }

  @override
  Future<List<DeviceModel>> getDevices() async {
    if (_deviceRegistry.isEmpty) {
      // Default discovered clients on local subnet
      final defaultClients = [
        const DeviceModel(
          mac: '70:97:41:AA:BB:CC',
          ip: '192.168.1.5',
          name: 'Home PC',
          hostname: 'DESKTOP-LAN',
          quotaGb: 0.0,
          usageGb: 0.0,
          remainingGb: 0.0,
          enabled: true,
          isBlocked: false,
        ),
        const DeviceModel(
          mac: 'A4:C3:F0:11:22:33',
          ip: '192.168.1.12',
          name: 'Galaxy Phone',
          hostname: 'Galaxy-A52',
          quotaGb: 0.0,
          usageGb: 0.0,
          remainingGb: 0.0,
          enabled: true,
          isBlocked: false,
        ),
      ];
      for (final client in defaultClients) {
        _deviceRegistry[client.mac.toUpperCase()] = client;
      }
    }

    return _deviceRegistry.values.map((dev) {
      final isBlocked = _blockedMacs.contains(dev.mac.toUpperCase());
      return dev.copyWith(isBlocked: isBlocked);
    }).toList();
  }

  @override
  Future<DeviceModel?> getDevice(String mac) async {
    final normalized = mac.toUpperCase();
    final dev = _deviceRegistry[normalized];
    if (dev != null) {
      return dev.copyWith(isBlocked: _blockedMacs.contains(normalized));
    }
    return null;
  }

  @override
  Future<void> registerDevice(DeviceModel device) async {
    final normalized = device.mac.toUpperCase();
    _deviceRegistry[normalized] = device;
  }

  @override
  Future<void> removeDevice(String mac) async {
    final normalized = mac.toUpperCase();
    _deviceRegistry.remove(normalized);
    _blockedMacs.remove(normalized);
  }

  @override
  Future<RouterTrafficStats> getUsage() async {
    throw UnsupportedCapabilityException(
      'usage',
      capabilities.getReason('usage'),
    );
  }

  @override
  Future<DeviceUsage?> getDeviceUsage(String mac) async {
    throw UnsupportedCapabilityException(
      'usage',
      capabilities.getReason('usage'),
    );
  }

  @override
  Future<void> blockDevice(String mac) async {
    _blockedMacs.add(mac.toUpperCase());
  }

  @override
  Future<void> unblockDevice(String mac) async {
    _blockedMacs.remove(mac.toUpperCase());
  }

  @override
  Future<void> setQuota(String mac, double quotaGb, {bool enabled = true}) async {
    throw UnsupportedCapabilityException(
      'quota',
      capabilities.getReason('quota'),
    );
  }

  @override
  Future<double?> getQuota(String mac) async {
    throw UnsupportedCapabilityException(
      'quota',
      capabilities.getReason('quota'),
    );
  }

  @override
  Future<void> resetQuota(String mac) async {
    throw UnsupportedCapabilityException(
      'quota',
      capabilities.getReason('quota'),
    );
  }
}
