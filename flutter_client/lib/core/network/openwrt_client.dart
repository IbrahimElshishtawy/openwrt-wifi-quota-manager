// ignore_for_file: prefer_initializing_formals
import '../../features/dashboard/presentation/controllers/dashboard_state.dart';
import '../../features/devices/domain/models/device_model.dart';
import '../constants/api_endpoints.dart';
import '../errors/exceptions.dart';
import '../storage/preferences_service.dart';
import '../utils/formatters.dart';
import 'api_client.dart';

enum ConnectionTestStatus {
  connected,
  authenticationFailed,
  routerUnreachable,
  timeout,
  invalidConfiguration,
  unsupportedApi,
  unknownError,
}

class ConnectionTestResultInfo {
  final ConnectionTestStatus status;
  final bool isSuccess;
  final String message;
  final String? details;
  final int? responseTimeMs;

  const ConnectionTestResultInfo({
    required this.status,
    required this.isSuccess,
    required this.message,
    this.details,
    this.responseTimeMs,
  });

  factory ConnectionTestResultInfo.success({int? responseTimeMs, String? details}) {
    return ConnectionTestResultInfo(
      status: ConnectionTestStatus.connected,
      isSuccess: true,
      message: 'Connected successfully to OpenWrt Router!',
      details: details,
      responseTimeMs: responseTimeMs,
    );
  }

  factory ConnectionTestResultInfo.failure({
    required ConnectionTestStatus status,
    required String message,
    String? details,
  }) {
    return ConnectionTestResultInfo(
      status: status,
      isSuccess: false,
      message: message,
      details: details,
    );
  }
}

class OpenWrtSystemInfo {
  final String model;
  final String release;
  final int uptimeSeconds;
  final String formattedUptime;
  final List<double> loadAverage;
  final int memoryTotalBytes;
  final int memoryFreeBytes;
  final String wanStatus;

  const OpenWrtSystemInfo({
    required this.model,
    required this.release,
    required this.uptimeSeconds,
    required this.formattedUptime,
    this.loadAverage = const [0.1, 0.1, 0.05],
    this.memoryTotalBytes = 0,
    this.memoryFreeBytes = 0,
    this.wanStatus = 'Connected',
  });

  factory OpenWrtSystemInfo.fromJson(Map<String, dynamic> json) {
    final uptime = (json['uptime_seconds'] as num?)?.toInt() ?? 0;
    return OpenWrtSystemInfo(
      model: json['model'] as String? ?? 'OpenWrt Router',
      release: json['version'] as String? ?? json['release'] as String? ?? '1.0.0',
      uptimeSeconds: uptime,
      formattedUptime: Formatters.formatUptime(uptime),
      wanStatus: json['wan_status'] as String? ?? 'Connected',
    );
  }
}

class NetworkStatusInfo {
  final DashboardConnectionStatus status;
  final String wanStatus;
  final String lanStatus;
  final String wifiStatus;
  final String routerUptime;
  final DateTime timestamp;

  const NetworkStatusInfo({
    required this.status,
    this.wanStatus = 'Connected',
    this.lanStatus = 'Active',
    this.wifiStatus = 'Active',
    this.routerUptime = 'Unknown',
    required this.timestamp,
  });
}

class RouterTrafficStats {
  final int rxBytes;
  final int txBytes;
  final int totalBytes;
  final String rxFormatted;
  final String txFormatted;
  final String totalFormatted;

  const RouterTrafficStats({
    required this.rxBytes,
    required this.txBytes,
    required this.totalBytes,
    required this.rxFormatted,
    required this.txFormatted,
    required this.totalFormatted,
  });

  factory RouterTrafficStats.fromBytes({required int rx, required int tx}) {
    final total = rx + tx;
    return RouterTrafficStats(
      rxBytes: rx,
      txBytes: tx,
      totalBytes: total,
      rxFormatted: Formatters.formatBytes(rx),
      txFormatted: Formatters.formatBytes(tx),
      totalFormatted: Formatters.formatBytes(total),
    );
  }
}

/// Abstract contract for interacting with OpenWrt router interfaces
abstract class OpenWrtClient {
  Future<OpenWrtSystemInfo> getSystemInfo();
  Future<List<DeviceModel>> getConnectedDevices();
  Future<NetworkStatusInfo> getNetworkStatus();
  Future<RouterTrafficStats> getTrafficStats();
  Future<void> blockDevice(String macAddress);
  Future<void> unblockDevice(String macAddress);
  Future<void> updateDeviceQuota({
    required String mac,
    required double quotaGb,
    required bool enabled,
  });
  Future<void> deleteDevice(String macAddress);
  Future<ConnectionTestResultInfo> testConnection();
}

/// Production implementation communicating with OpenWrt REST API & LuCI RPC
class OpenWrtClientImpl implements OpenWrtClient {
  final ApiClient _apiClient;
  final PreferencesService _preferencesService;

  OpenWrtClientImpl({
    required ApiClient apiClient,
    required PreferencesService preferencesService,
  })  : _apiClient = apiClient,
        _preferencesService = preferencesService;

  @override
  Future<OpenWrtSystemInfo> getSystemInfo() async {
    try {
      final res = await _apiClient.get(ApiEndpoints.health);
      if (res is Map<String, dynamic>) {
        return OpenWrtSystemInfo.fromJson(res);
      }
      return const OpenWrtSystemInfo(
        model: 'OpenWrt Router',
        release: '1.0.0',
        uptimeSeconds: 0,
        formattedUptime: 'Unknown',
      );
    } catch (_) {
      return const OpenWrtSystemInfo(
        model: 'OpenWrt Router',
        release: '1.0.0',
        uptimeSeconds: 0,
        formattedUptime: 'Unknown',
      );
    }
  }

  @override
  Future<List<DeviceModel>> getConnectedDevices() async {
    final response = await _apiClient.get(ApiEndpoints.devices);
    if (response is Map<String, dynamic>) {
      final list = response['devices'] as List<dynamic>? ?? [];
      return list.map((item) => DeviceModel.fromJson(item as Map<String, dynamic>)).toList();
    }
    return [];
  }

  @override
  Future<NetworkStatusInfo> getNetworkStatus() async {
    try {
      final sysInfo = await getSystemInfo();
      return NetworkStatusInfo(
        status: DashboardConnectionStatus.online,
        wanStatus: sysInfo.wanStatus,
        lanStatus: 'Active',
        wifiStatus: 'Active',
        routerUptime: sysInfo.formattedUptime,
        timestamp: DateTime.now(),
      );
    } catch (_) {
      return NetworkStatusInfo(
        status: DashboardConnectionStatus.offline,
        wanStatus: 'Disconnected',
        lanStatus: 'Down',
        wifiStatus: 'Unknown',
        routerUptime: 'N/A',
        timestamp: DateTime.now(),
      );
    }
  }

  @override
  Future<RouterTrafficStats> getTrafficStats() async {
    final response = await _apiClient.get(ApiEndpoints.usage);
    int totalRx = 0;
    int totalTx = 0;

    if (response is Map<String, dynamic> && response['usage'] is Map<String, dynamic>) {
      final usageMap = response['usage'] as Map<String, dynamic>;
      for (final devUsage in usageMap.values) {
        if (devUsage is Map<String, dynamic>) {
          totalRx += (devUsage['rx_bytes'] as num?)?.toInt() ?? 0;
          totalTx += (devUsage['tx_bytes'] as num?)?.toInt() ?? 0;
        }
      }
    }

    return RouterTrafficStats.fromBytes(rx: totalRx, tx: totalTx);
  }

  @override
  Future<void> blockDevice(String macAddress) async {
    await _apiClient.post(
      ApiEndpoints.block,
      data: {'mac': macAddress},
    );
  }

  @override
  Future<void> unblockDevice(String macAddress) async {
    await _apiClient.post(
      ApiEndpoints.unblock,
      data: {'mac': macAddress},
    );
  }

  @override
  Future<void> updateDeviceQuota({
    required String mac,
    required double quotaGb,
    required bool enabled,
  }) async {
    await _apiClient.post(
      ApiEndpoints.quota,
      data: {
        'mac': mac,
        'quota_gb': quotaGb,
        'enabled': enabled,
      },
    );
  }

  @override
  Future<void> deleteDevice(String macAddress) async {
    await _apiClient.delete(
      ApiEndpoints.devices,
      queryParameters: {'mac': macAddress},
    );
  }

  @override
  Future<ConnectionTestResultInfo> testConnection() async {
    final ip = _preferencesService.routerIp.trim();
    final port = _preferencesService.routerPort;
    final protocol = _preferencesService.routerProtocol;

    if (ip.isEmpty) {
      return ConnectionTestResultInfo.failure(
        status: ConnectionTestStatus.invalidConfiguration,
        message: 'Router IP is empty. Please configure a valid IP address.',
      );
    }

    if (port <= 0 || port > 65535) {
      return ConnectionTestResultInfo.failure(
        status: ConnectionTestStatus.invalidConfiguration,
        message: 'Invalid port ($port). Must be between 1 and 65535.',
      );
    }

    final stopwatch = Stopwatch()..start();

    try {
      final res = await _apiClient.get(ApiEndpoints.health);
      stopwatch.stop();

      final version = (res is Map && res['version'] != null) ? res['version'].toString() : '1.0.0';
      return ConnectionTestResultInfo.success(
        responseTimeMs: stopwatch.elapsedMilliseconds,
        details: 'API version: $version on $protocol://$ip:$port',
      );
    } on OpenWrtAuthenticationException catch (e) {
      stopwatch.stop();
      return ConnectionTestResultInfo.failure(
        status: ConnectionTestStatus.authenticationFailed,
        message: 'Authentication failed. Verify OpenWrt credentials or API pre-shared token.',
        details: e.message,
      );
    } on OpenWrtTimeoutException catch (e) {
      stopwatch.stop();
      return ConnectionTestResultInfo.failure(
        status: ConnectionTestStatus.timeout,
        message: 'Connection timed out. OpenWrt router did not respond in 4 seconds.',
        details: e.message,
      );
    } on OpenWrtConnectionException catch (e) {
      stopwatch.stop();
      return ConnectionTestResultInfo.failure(
        status: ConnectionTestStatus.routerUnreachable,
        message: 'Router unreachable. Verify phone is on router Wi-Fi and IP ($ip:$port) is correct.',
        details: e.message,
      );
    } on OpenWrtUnsupportedException catch (e) {
      stopwatch.stop();
      return ConnectionTestResultInfo.failure(
        status: ConnectionTestStatus.unsupportedApi,
        message: 'API is not supported or required OpenWrt package is missing.',
        details: e.message,
      );
    } catch (e) {
      stopwatch.stop();
      return ConnectionTestResultInfo.failure(
        status: ConnectionTestStatus.unknownError,
        message: 'Connection failed due to unexpected error.',
        details: e.toString(),
      );
    }
  }
}
