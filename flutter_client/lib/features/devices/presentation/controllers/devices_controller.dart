import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/di/providers.dart';
import '../../domain/repositories/device_repository.dart';
import 'devices_state.dart';

final devicesControllerProvider = StateNotifierProvider<DevicesController, DevicesState>((ref) {
  final repo = ref.watch(deviceRepositoryProvider);
  return DevicesController(repo);
});

class DevicesController extends StateNotifier<DevicesState> {
  final DeviceRepository _repository;

  DevicesController(this._repository) : super(const DevicesState()) {
    loadDevices();
  }

  Future<void> loadDevices({bool forceRefresh = false}) async {
    state = state.copyWith(isLoading: true, errorMessage: null);

    try {
      final devices = await _repository.getDevices(forceRefresh: forceRefresh);
      state = state.copyWith(
        devices: devices,
        isLoading: false,
        isOffline: false,
      );
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        isOffline: true,
        errorMessage: e.toString(),
      );
    }
  }

  void setSearchQuery(String query) {
    state = state.copyWith(searchQuery: query);
  }

  void setFilter(DeviceFilter filter) {
    state = state.copyWith(filter: filter);
  }

  Future<void> updateQuota({
    required String mac,
    required double quotaGb,
    required bool enabled,
  }) async {
    try {
      final updatedDevice = await _repository.updateQuota(
        mac: mac,
        quotaGb: quotaGb,
        enabled: enabled,
      );

      final updatedList = state.devices.map((d) {
        if (d.mac.toUpperCase() == mac.toUpperCase()) {
          return updatedDevice;
        }
        return d;
      }).toList();

      state = state.copyWith(devices: updatedList);
    } catch (e) {
      state = state.copyWith(errorMessage: 'Failed to update quota: $e');
    }
  }

  Future<void> toggleBlock({required String mac, required bool block}) async {
    try {
      await _repository.toggleDeviceBlock(mac: mac, block: block);

      final updatedList = state.devices.map((d) {
        if (d.mac.toUpperCase() == mac.toUpperCase()) {
          final isBlocked = block;
          return d.copyWith(
            enabled: !block,
            isBlocked: isBlocked,
          );
        }
        return d;
      }).toList();

      state = state.copyWith(devices: updatedList);
    } catch (e) {
      state = state.copyWith(errorMessage: 'Failed to toggle access: $e');
    }
  }
}
