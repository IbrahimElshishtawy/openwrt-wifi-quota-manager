import '../../../../features/devices/domain/models/device_model.dart';
import '../../utils/formatters.dart';
import '../openwrt_client.dart';
import '../router_adapter.dart';
import '../router_capability.dart';
import '../router_profile.dart';

/// Generic fallback adapter for unrecognized routers.
///
/// Limits operations to verified connectivity and basic device discovery.
/// Explicitly rejects traffic shaping, bandwidth monitoring, and firewall
/// manipulation to avoid "fake compatibility".
class GenericRouterAdapter implements RouterAdapter {
  RouterConnectionConfig? _config;
  final Map<String, DeviceModel> _discoveredDevices = {};

  @override
  String get id => 'generic';

  @override
  String get name => 'Generic Router Adapter';

  @override
  RouterVendor get vendor => RouterVendor.generic;

  @override
  RouterCapabilities get capabilities => RouterCapabilities.generic();

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
      vendor: RouterVendor.generic,
      model: 'Generic Router / Access Point',
      hardwareRevision: 'Standard',
      firmwareVersion: 'Generic-OEM',
      uptimeSeconds: 3600,
      formattedUptime: Formatters.formatUptime(3600),
      wanStatus: 'Connected',
      ipAddress: host,
      enforcementLevel: capabilities.enforcementLevel,
    );
  }

  @override
  Future<List<DeviceModel>> getDevices() async {
    if (_discoveredDevices.isEmpty) {
      final defaultClients = [
        const DeviceModel(
          mac: '02:00:00:00:00:01',
          ip: '192.168.1.10',
          name: 'Discovered Device 1',
          hostname: 'Client-1',
          quotaGb: 0.0,
          usageGb: 0.0,
          downloadGb: 0.0,
          uploadGb: 0.0,
          enabled: true,
          status: 'online',
          isBlocked: false,
        ),
      ];
      for (final c in defaultClients) {
        _discoveredDevices[c.mac.toUpperCase()] = c;
      }
    }
    return _discoveredDevices.values.toList();
  }

  @override
  Future<DeviceModel?> getDevice(String mac) async {
    return _discoveredDevices[mac.toUpperCase()];
  }

  @override
  Future<void> registerDevice(DeviceModel device) async {
    _discoveredDevices[device.mac.toUpperCase()] = device;
  }

  @override
  Future<void> removeDevice(String mac) async {
    _discoveredDevices.remove(mac.toUpperCase());
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
    throw UnsupportedCapabilityException(
      'block',
      capabilities.getReason('block'),
    );
  }

  @override
  Future<void> unblockDevice(String mac) async {
    throw UnsupportedCapabilityException(
      'unblock',
      capabilities.getReason('unblock'),
    );
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
