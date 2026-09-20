// ignore_for_file: prefer_initializing_formals

import '../../../../features/devices/domain/models/device_model.dart';
import '../../../constants/api_endpoints.dart';
import '../../api_client.dart';
import '../../openwrt_client.dart';
import '../router_adapter.dart';
import '../router_capability.dart';
import '../router_profile.dart';

/// First-class implementation interacting with an OpenWrt Gateway running
/// the Python Wi-Fi Quota Manager daemon and nftables firewall.
///
/// Delivers Level 5 (Full Traffic Enforcement) capabilities.
class OpenWrtAdapter implements RouterAdapter {
  final OpenWrtClient _openWrtClient;
  final ApiClient? _apiClient;
  RouterConnectionConfig? _currentConfig;
  bool _isConnected = false;

  bool get isConnected => _isConnected;

  OpenWrtAdapter({required OpenWrtClient openWrtClient, ApiClient? apiClient})
    : _openWrtClient = openWrtClient,
      _apiClient = apiClient;

  @override
  String get id => 'openwrt';

  @override
  String get name => 'OpenWrt Gateway Adapter';

  @override
  RouterVendor get vendor => RouterVendor.openwrt;

  @override
  RouterCapabilities get capabilities => RouterCapabilities.openwrt();

  @override
  Future<void> connect(RouterConnectionConfig config) async {
    _currentConfig = config;
    _isConnected = true;
  }

  @override
  Future<void> disconnect() async {
    _isConnected = false;
    _currentConfig = null;
  }

  @override
  Future<RouterInfo> getRouterInfo() async {
    final sysInfo = await _openWrtClient.getSystemInfo();
    final host = _currentConfig?.host ?? ApiEndpoints.defaultRouterIp;
    return RouterInfo.fromOpenWrtSystemInfo(sysInfo, ip: host);
  }

  @override
  Future<List<DeviceModel>> getDevices() async {
    return await _openWrtClient.getConnectedDevices();
  }

  @override
  Future<DeviceModel?> getDevice(String mac) async {
    final devices = await getDevices();
    final normalized = mac.toUpperCase();
    for (final dev in devices) {
      if (dev.mac.toUpperCase() == normalized) {
        return dev;
      }
    }
    return null;
  }

  @override
  Future<void> registerDevice(DeviceModel device) async {
    if (_apiClient != null) {
      await _apiClient.post(
        ApiEndpoints.devices,
        data: {
          'mac': device.mac,
          'name': device.name,
          'quota_gb': device.quotaGb,
          'enabled': device.enabled,
        },
      );
    } else {
      await _openWrtClient.updateDeviceQuota(
        mac: device.mac,
        quotaGb: device.quotaGb,
        enabled: device.enabled,
      );
    }
  }

  @override
  Future<void> removeDevice(String mac) async {
    await _openWrtClient.deleteDevice(mac);
  }

  @override
  Future<RouterTrafficStats> getUsage() async {
    return await _openWrtClient.getTrafficStats();
  }

  @override
  Future<DeviceUsage?> getDeviceUsage(String mac) async {
    final dev = await getDevice(mac);
    if (dev == null) return null;

    final totalBytes = (dev.usageGb * 1024 * 1024 * 1024).toInt();
    final rx = (totalBytes * 0.8).toInt();
    final tx = (totalBytes * 0.2).toInt();

    return DeviceUsage.fromBytes(
      mac: dev.mac,
      ip: dev.ip,
      hostname: dev.hostname,
      rx: rx,
      tx: tx,
    );
  }

  @override
  Future<void> blockDevice(String mac) async {
    await _openWrtClient.blockDevice(mac);
  }

  @override
  Future<void> unblockDevice(String mac) async {
    await _openWrtClient.unblockDevice(mac);
  }

  @override
  Future<void> setQuota(
    String mac,
    double quotaGb, {
    bool enabled = true,
  }) async {
    await _openWrtClient.updateDeviceQuota(
      mac: mac,
      quotaGb: quotaGb,
      enabled: enabled,
    );
  }

  @override
  Future<double?> getQuota(String mac) async {
    final dev = await getDevice(mac);
    return dev?.quotaGb;
  }

  @override
  Future<void> resetQuota(String mac) async {
    if (_apiClient != null) {
      await _apiClient.post(ApiEndpoints.reset, data: {'mac': mac});
    }
  }
}
