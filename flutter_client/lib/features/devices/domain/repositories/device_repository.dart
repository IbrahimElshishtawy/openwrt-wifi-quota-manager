import '../models/device_model.dart';

abstract class DeviceRepository {
  Future<List<DeviceModel>> getDevices({bool forceRefresh = false});
  Future<DeviceModel> updateQuota({
    required String mac,
    required double quotaGb,
    required bool enabled,
  });
  Future<void> toggleDeviceBlock({required String mac, required bool block});
  Future<void> blockDevice(String mac);
  Future<void> unblockDevice(String mac);
}
