import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';
import '../../domain/models/device_model.dart';

abstract class DeviceRemoteDataSource {
  Future<List<DeviceModel>> fetchDevices();
  Future<void> updateDeviceQuota({
    required String mac,
    required double quotaGb,
    required bool enabled,
  });
}

class DeviceRemoteDataSourceImpl implements DeviceRemoteDataSource {
  final ApiClient _apiClient;

  DeviceRemoteDataSourceImpl(this._apiClient);

  @override
  Future<List<DeviceModel>> fetchDevices() async {
    final response = await _apiClient.get(ApiEndpoints.devices);
    final List<dynamic> devicesList = response['devices'] as List<dynamic>? ?? [];
    return devicesList.map((item) => DeviceModel.fromJson(item as Map<String, dynamic>)).toList();
  }

  @override
  Future<void> updateDeviceQuota({
    required String mac,
    required double quotaGb,
    required bool enabled,
  }) async {
    await _apiClient.post(
      ApiEndpoints.quota,
      {
        'mac': mac,
        'quota_gb': quotaGb,
        'enabled': enabled,
      },
    );
  }
}
