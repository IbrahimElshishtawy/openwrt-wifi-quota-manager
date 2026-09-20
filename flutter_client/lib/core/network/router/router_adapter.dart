import '../../../features/devices/domain/models/device_model.dart';
import '../../utils/formatters.dart';
import '../openwrt_client.dart';
import 'router_capability.dart';
import 'router_profile.dart';

/// Thrown when an operation is requested on a router adapter that lacks
/// the corresponding hardware or software capability.
class UnsupportedCapabilityException implements Exception {
  final String capability;
  final String reason;

  const UnsupportedCapabilityException(
    this.capability, [
    this.reason = 'This capability is not supported by the router.',
  ]);

  @override
  String toString() => 'UnsupportedCapabilityException($capability): $reason';
}

/// Generic connection configuration for router communication.
class RouterConnectionConfig {
  final String host;
  final int port;
  final String protocol;
  final String username;
  final String password;
  final String apiKey;
  final Duration timeout;
  final bool isDemoMode;

  const RouterConnectionConfig({
    required this.host,
    required this.port,
    this.protocol = 'http',
    this.username = 'root',
    this.password = '',
    this.apiKey = '',
    this.timeout = const Duration(seconds: 4),
    this.isDemoMode = false,
  });

  String get baseUrl => '$protocol://$host:$port';
}

/// Normalized router system information.
class RouterInfo {
  final RouterVendor vendor;
  final String model;
  final String hardwareRevision;
  final String firmwareVersion;
  final int uptimeSeconds;
  final String formattedUptime;
  final String wanStatus;
  final String ipAddress;
  final TrafficEnforcementLevel enforcementLevel;

  const RouterInfo({
    required this.vendor,
    required this.model,
    this.hardwareRevision = 'Unknown',
    required this.firmwareVersion,
    required this.uptimeSeconds,
    required this.formattedUptime,
    this.wanStatus = 'Connected',
    required this.ipAddress,
    required this.enforcementLevel,
  });

  factory RouterInfo.fromOpenWrtSystemInfo(
    OpenWrtSystemInfo info, {
    required String ip,
    String revision = 'Universal',
  }) {
    return RouterInfo(
      vendor: RouterVendor.openwrt,
      model: info.model,
      hardwareRevision: revision,
      firmwareVersion: info.release,
      uptimeSeconds: info.uptimeSeconds,
      formattedUptime: info.formattedUptime,
      wanStatus: info.wanStatus,
      ipAddress: ip,
      enforcementLevel: TrafficEnforcementLevel.level5FullEnforcement,
    );
  }
}

/// Bandwidth consumption details for an individual LAN device.
class DeviceUsage {
  final String mac;
  final String ip;
  final String hostname;
  final int rxBytes;
  final int txBytes;
  final int totalBytes;
  final String formattedTotal;

  const DeviceUsage({
    required this.mac,
    required this.ip,
    required this.hostname,
    required this.rxBytes,
    required this.txBytes,
    required this.totalBytes,
    required this.formattedTotal,
  });

  factory DeviceUsage.fromBytes({
    required String mac,
    required String ip,
    required String hostname,
    required int rx,
    required int tx,
  }) {
    final total = rx + tx;
    return DeviceUsage(
      mac: mac,
      ip: ip,
      hostname: hostname,
      rxBytes: rx,
      txBytes: tx,
      totalBytes: total,
      formattedTotal: Formatters.formatBytes(total),
    );
  }
}

/// Unified abstraction contract for interacting with network routers.
///
/// Adapters implement this interface according to their verified real capabilities.
/// Any operation not backed by real router support MUST throw [UnsupportedCapabilityException]
/// rather than silently returning mock or fabricated data.
abstract class RouterAdapter {
  /// Unique identifier of the adapter (e.g. 'openwrt', 'zte', 'huawei', 'tplink', 'generic')
  String get id;

  /// User-friendly name
  String get name;

  /// Vendor associated with this adapter
  RouterVendor get vendor;

  /// Dynamic capabilities supported by this adapter instance
  RouterCapabilities get capabilities;

  /// Establishes communication session with the router
  Future<void> connect(RouterConnectionConfig config);

  /// Closes active communication session
  Future<void> disconnect();

  /// Retrieves router hardware/firmware details
  Future<RouterInfo> getRouterInfo();

  /// Retrieves connected devices
  Future<List<DeviceModel>> getDevices();

  /// Retrieves a specific device by its MAC address
  Future<DeviceModel?> getDevice(String mac);

  /// Registers or persists device metadata
  Future<void> registerDevice(DeviceModel device);

  /// Removes a registered device
  Future<void> removeDevice(String mac);

  /// Retrieves aggregate router traffic statistics
  Future<RouterTrafficStats> getUsage();

  /// Retrieves real-time bandwidth consumption for a specific MAC
  Future<DeviceUsage?> getDeviceUsage(String mac);

  /// Blocks internet transit for the specified MAC address
  Future<void> blockDevice(String mac);

  /// Unblocks internet transit for the specified MAC address
  Future<void> unblockDevice(String mac);

  /// Configures data quota limit for a device
  Future<void> setQuota(String mac, double quotaGb, {bool enabled = true});

  /// Retrieves configured quota limit for a device
  Future<double?> getQuota(String mac);

  /// Resets quota consumption counters for a device
  Future<void> resetQuota(String mac);
}
