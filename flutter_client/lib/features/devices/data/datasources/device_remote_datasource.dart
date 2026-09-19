import '../../../../core/network/openwrt_client.dart';
import '../../domain/models/device_model.dart';

abstract class DeviceRemoteDataSource {
  Future<List<DeviceModel>> fetchDevices();
  Future<void> updateDeviceQuota({
    required String mac,
    required double quotaGb,
    required bool enabled,
  });
  Future<void> blockDevice(String mac);
  Future<void> unblockDevice(String mac);
}

class DeviceRemoteDataSourceImpl implements DeviceRemoteDataSource {
  final OpenWrtClient _openWrtClient;

  DeviceRemoteDataSourceImpl(this._openWrtClient);

  @override
  Future<List<DeviceModel>> fetchDevices() async {
    return await _openWrtClient.getConnectedDevices();
  }

  @override
  Future<void> updateDeviceQuota({
    required String mac,
    required double quotaGb,
    required bool enabled,
  }) async {
    await _openWrtClient.updateDeviceQuota(
      mac: mac,
      quotaGb: quotaGb,
      enabled: enabled,
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
}
