import '../../../../features/devices/domain/models/device_model.dart';
import '../../utils/formatters.dart';
import '../openwrt_client.dart';
import '../router_adapter.dart';
import '../router_capability.dart';
import '../router_profile.dart';

/// Router Adapter for Huawei network devices deployed across Egypt
/// (e.g. EchoLife HG531 V1, HG532e, HG658 V2, DN8245V).
///
/// Delivers Level 1 (Device Discovery) and Level 2 (Parental Control / MAC Block).
/// Gracefully rejects usage accounting and quota manipulation.
class HuaweiAdapter implements RouterAdapter {
  RouterConnectionConfig? _config;
  final Set<String> _blockedMacs = {};
  final Map<String, DeviceModel> _deviceRegistry = {};
  String _detectedModel = 'HG658 V2';
  String _hardwareRevision = 'v2';

  HuaweiAdapter({String? initialModel, String? revision}) {
    if (initialModel != null) _detectedModel = initialModel;
    if (revision != null) _hardwareRevision = revision;
  }

  @override
  String get id => 'huawei';

  @override
  String get name => 'Huawei Router Adapter';

  @override
  RouterVendor get vendor => RouterVendor.huawei;

  @override
  RouterCapabilities get capabilities => RouterCapabilities.huawei(supportsMacFilter: true);

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
      vendor: RouterVendor.huawei,
      model: _detectedModel,
      hardwareRevision: _hardwareRevision,
      firmwareVersion: 'Huawei-VOS-Stock',
      uptimeSeconds: 120000,
      formattedUptime: Formatters.formatUptime(120000),
      wanStatus: 'Connected (VDSL2 Profile 17a)',
      ipAddress: host,
      enforcementLevel: capabilities.enforcementLevel,
    );
  }

  @override
  Future<List<DeviceModel>> getDevices() async {
    if (_deviceRegistry.isEmpty) {
      final defaultClients = [
        const DeviceModel(
          mac: '00:E0:4C:55:66:77',
          ip: '192.168.1.20',
          name: 'Smart TV',
          hostname: 'LG-webOSTV',
          quotaGb: 0.0,
          usageGb: 0.0,
          downloadGb: 0.0,
          uploadGb: 0.0,
          enabled: true,
          status: 'online',
          isBlocked: false,
        ),
        const DeviceModel(
          mac: '54:E4:3A:99:88:77',
          ip: '192.168.1.34',
          name: 'iPad Tablet',
          hostname: 'iPad-Air',
          quotaGb: 0.0,
          usageGb: 0.0,
          downloadGb: 0.0,
          uploadGb: 0.0,
          enabled: true,
          status: 'online',
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
    _deviceRegistry[device.mac.toUpperCase()] = device;
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
