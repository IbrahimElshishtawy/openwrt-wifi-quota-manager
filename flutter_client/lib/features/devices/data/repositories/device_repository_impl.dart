import '../../domain/models/device_model.dart';
import '../../domain/repositories/device_repository.dart';
import '../datasources/device_local_datasource.dart';
import '../datasources/device_remote_datasource.dart';

class DeviceRepositoryImpl implements DeviceRepository {
  final DeviceRemoteDataSource _remoteDataSource;
  final DeviceLocalDataSource _localDataSource;

  DeviceRepositoryImpl({
    required DeviceRemoteDataSource remoteDataSource,
    required DeviceLocalDataSource localDataSource,
  })  : _remoteDataSource = remoteDataSource,
        _localDataSource = localDataSource;

  @override
  Future<List<DeviceModel>> getDevices({bool forceRefresh = false}) async {
    try {
      final remoteDevices = await _remoteDataSource.fetchDevices();
      // Cache devices into Isar asynchronously
      await _localDataSource.cacheDevices(remoteDevices);
      return remoteDevices;
    } catch (e) {
      // Offline-first fallback: Load from Isar database
      final cached = await _localDataSource.getCachedDevices();
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
    await _remoteDataSource.updateDeviceQuota(
      mac: mac,
      quotaGb: quotaGb,
      enabled: enabled,
    );

    // Fetch updated list or update existing cached item
    final cached = await _localDataSource.getCachedDevices();
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
      await _localDataSource.updateCachedDevice(updated);
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
      await _localDataSource.updateCachedDevice(updated);
    }

    return updated;
  }

  @override
  Future<void> toggleDeviceBlock({required String mac, required bool block}) async {
    final cached = await _localDataSource.getCachedDevices();
    final index = cached.indexWhere((d) => d.mac.toUpperCase() == mac.toUpperCase());
    final currentQuota = index != -1 ? cached[index].quotaGb : 10.0;

    await updateQuota(
      mac: mac,
      quotaGb: currentQuota,
      enabled: !block,
    );
  }
}
