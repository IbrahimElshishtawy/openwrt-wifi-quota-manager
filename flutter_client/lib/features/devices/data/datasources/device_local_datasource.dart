import 'package:isar_community/isar.dart';
import '../../../../core/storage/entities/cached_device.dart';
import '../../../../core/storage/isar_service.dart';
import '../../domain/models/device_model.dart';

abstract class DeviceLocalDataSource {
  Future<List<DeviceModel>> getCachedDevices();
  Future<void> cacheDevices(List<DeviceModel> devices);
  Future<void> updateCachedDevice(DeviceModel device);
  Future<void> clearCache();
}

class DeviceLocalDataSourceImpl implements DeviceLocalDataSource {
  final IsarService _isarService;

  DeviceLocalDataSourceImpl(this._isarService);

  @override
  Future<List<DeviceModel>> getCachedDevices() async {
    final cached = await _isarService.devices.where().findAll();
    return cached
        .map(
          (c) => DeviceModel(
            mac: c.mac,
            name: c.name,
            ip: c.ip,
            hostname: c.hostname,
            usageGb: c.usageGb,
            quotaGb: c.quotaGb,
            remainingGb: c.remainingGb,
            enabled: c.enabled,
            isBlocked: c.isBlocked,
          ),
        )
        .toList();
  }

  @override
  Future<void> cacheDevices(List<DeviceModel> devices) async {
    final entities = devices.map((d) {
      final entity = CachedDevice()
        ..mac = d.mac
        ..name = d.name
        ..ip = d.ip
        ..hostname = d.hostname
        ..usageGb = d.usageGb
        ..quotaGb = d.quotaGb
        ..remainingGb = d.remainingGb
        ..enabled = d.enabled
        ..isBlocked = d.isBlocked
        ..lastUpdated = DateTime.now();
      return entity;
    }).toList();

    await _isarService.isar.writeTxn(() async {
      await _isarService.devices.putAllByMac(entities);
    });
  }

  @override
  Future<void> updateCachedDevice(DeviceModel device) async {
    await _isarService.isar.writeTxn(() async {
      final existing = await _isarService.devices.getByMac(device.mac);
      final entity = (existing ?? CachedDevice())
        ..mac = device.mac
        ..name = device.name
        ..ip = device.ip
        ..hostname = device.hostname
        ..usageGb = device.usageGb
        ..quotaGb = device.quotaGb
        ..remainingGb = device.remainingGb
        ..enabled = device.enabled
        ..isBlocked = device.isBlocked
        ..lastUpdated = DateTime.now();

      await _isarService.devices.putByMac(entity);
    });
  }

  @override
  Future<void> clearCache() async {
    await _isarService.isar.writeTxn(() async {
      await _isarService.devices.clear();
    });
  }
}
