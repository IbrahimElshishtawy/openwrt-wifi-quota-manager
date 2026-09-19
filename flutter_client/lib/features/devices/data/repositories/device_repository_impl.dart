import '../../domain/models/device_model.dart';
import '../../domain/repositories/device_repository.dart';
import '../datasources/device_local_datasource.dart';
import '../datasources/device_remote_datasource.dart';

class DeviceRepositoryImpl implements DeviceRepository {
  final DeviceRemoteDataSource remoteDataSource;
  final DeviceLocalDataSource localDataSource;

  DeviceRepositoryImpl({
    required this.remoteDataSource,
    required this.localDataSource,
  });

  @override
  Future<List<DeviceModel>> getDevices({bool forceRefresh = false}) async {
    try {
      final remoteDevices = await remoteDataSource.fetchDevices();
      // Cache devices into Isar asynchronously
      await localDataSource.cacheDevices(remoteDevices);
      return remoteDevices;
    } catch (e) {
      // Offline-first fallback: Load from Isar database
      final cached = await localDataSource.getCachedDevices();
      if (cached.isNotEmpty) {
        return cached;
      }
      rethrow;
    }
  }

  @override
  Future<DeviceModel> updateQuota({
    required String mac,
    required double quotaGb,
    required bool enabled,
  }) async {
    await remoteDataSource.updateDeviceQuota(
      mac: mac,
      quotaGb: quotaGb,
      enabled: enabled,
    );

    // Fetch updated list or update existing cached item
    final cached = await localDataSource.getCachedDevices();
    final index = cached.indexWhere((d) => d.mac.toUpperCase() == mac.toUpperCase());
    DeviceModel updated;

    if (index != -1) {
      final old = cached[index];
      final isBlocked = !enabled || (old.usageGb >= quotaGb);
      updated = old.copyWith(
        quotaGb: quotaGb,
        enabled: enabled,
        remainingGb: (quotaGb - old.usageGb).clamp(0, 9999).toDouble(),
        isBlocked: isBlocked,
      );
      await localDataSource.updateCachedDevice(updated);
    } else {
      updated = DeviceModel(
        mac: mac,
        name: 'Updated Device',
        ip: '0.0.0.0',
        hostname: 'device',
        usageGb: 0.0,
        quotaGb: quotaGb,
        remainingGb: quotaGb,
        enabled: enabled,
        isBlocked: !enabled,
      );
      await localDataSource.updateCachedDevice(updated);
    }

    return updated;
  }

  @override
  Future<void> blockDevice(String mac) async {
    await remoteDataSource.blockDevice(mac);

    final cached = await localDataSource.getCachedDevices();
    final index = cached.indexWhere((d) => d.mac.toUpperCase() == mac.toUpperCase());
    if (index != -1) {
      final updated = cached[index].copyWith(
        isBlocked: true,
        enabled: false,
      );
      await localDataSource.updateCachedDevice(updated);
    }
  }

  @override
  Future<void> unblockDevice(String mac) async {
    await remoteDataSource.unblockDevice(mac);

    final cached = await localDataSource.getCachedDevices();
    final index = cached.indexWhere((d) => d.mac.toUpperCase() == mac.toUpperCase());
    if (index != -1) {
      final updated = cached[index].copyWith(
        isBlocked: false,
        enabled: true,
      );
      await localDataSource.updateCachedDevice(updated);
    }
  }

  @override
  Future<void> toggleDeviceBlock({required String mac, required bool block}) async {
    if (block) {
      await blockDevice(mac);
    } else {
      await unblockDevice(mac);
    }
  }
}
