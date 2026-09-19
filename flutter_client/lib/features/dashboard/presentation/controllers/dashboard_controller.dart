import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/di/providers.dart';
import '../../../../core/network/mock_data_generator.dart';
import '../../../devices/domain/repositories/device_repository.dart';
import '../../../settings/presentation/controllers/settings_controller.dart';
import '../../domain/models/network_activity_event.dart';
import '../../domain/repositories/dashboard_repository.dart';
import 'dashboard_state.dart';

final dashboardControllerProvider =
    StateNotifierProvider<DashboardController, DashboardState>((ref) {
  final dashboardRepo = ref.watch(dashboardRepositoryProvider);
  final deviceRepo = ref.watch(deviceRepositoryProvider);
  final settings = ref.watch(settingsControllerProvider);

  final controller = DashboardController(
    dashboardRepository: dashboardRepo,
    deviceRepository: deviceRepo,
    initialRefreshInterval: settings.refreshInterval,
    isDemoMode: settings.isDemoMode,
  );

  // Reactively adjust polling interval when user adjusts slider in Settings
  ref.listen(settingsControllerProvider.select((s) => s.refreshInterval),
      (prev, next) {
    if (next != prev) {
      controller.updateRefreshInterval(next);
    }
  });

  // Reload data when demo mode toggles
  ref.listen(settingsControllerProvider.select((s) => s.isDemoMode),
      (prev, next) {
    if (next != prev) {
      controller.setDemoMode(next);
    }
  });

  ref.onDispose(() => controller.disposeTimer());
  return controller;
});

class DashboardController extends StateNotifier<DashboardState> {
  final DashboardRepository _dashboardRepository;
  final DeviceRepository _deviceRepository;
  bool _isDemoMode;
  Timer? _pollingTimer;

  DashboardController({
    required this._dashboardRepository,
    required this._deviceRepository,
    int initialRefreshInterval = 15,
    bool isDemoMode = false,
  })  : _isDemoMode = isDemoMode,
        super(DashboardState(
          refreshInterval: initialRefreshInterval,
          connectionStatus: isDemoMode
              ? DashboardConnectionStatus.demo
              : DashboardConnectionStatus.connecting,
          lastUpdated: DateTime.now(),
        )) {
    loadData();
    startPolling(intervalSeconds: initialRefreshInterval);
  }

  void updateRefreshInterval(int seconds) {
    state = state.copyWith(refreshInterval: seconds);
    startPolling(intervalSeconds: seconds);
  }

  void setDemoMode(bool isDemo) {
    _isDemoMode = isDemo;
    state = state.copyWith(
      connectionStatus: isDemo
          ? DashboardConnectionStatus.demo
          : DashboardConnectionStatus.connecting,
    );
    loadData(forceRefresh: true);
  }

  void startPolling({int? intervalSeconds}) {
    final interval = intervalSeconds ?? state.refreshInterval;
    _pollingTimer?.cancel();
    _pollingTimer = Timer.periodic(Duration(seconds: interval), (_) {
      loadData(isBackground: true);
    });
  }

  void disposeTimer() {
    _pollingTimer?.cancel();
  }

  List<NetworkActivityEvent> _generateRecentActivities() {
    return MockDataGenerator.mockActivities
        .map((a) => NetworkActivityEvent.fromJson(a))
        .toList();
  }

  Future<void> loadData({
    bool isBackground = false,
    bool forceRefresh = false,
  }) async {
    if (!isBackground && state.status != DashboardStatus.success && state.report == null) {
      state = state.copyWith(status: DashboardStatus.loading);
    }

    try {
      final reportFuture = _dashboardRepository.getQuotaReport(
        forceRefresh: forceRefresh || !isBackground,
      );
      final devicesFuture = _deviceRepository.getDevices(
        forceRefresh: forceRefresh || !isBackground,
      );

      final results = await Future.wait([reportFuture, devicesFuture]);
      final report = results[0] as dynamic;
      final devices = results[1] as List<dynamic>;

      final activeCount = devices.where((d) => d.enabled && !d.isBlocked).length;
      final blockedCount = devices.where((d) => d.isBlocked || !d.enabled).length;
      final nearLimitCount = devices.where((d) => d.isNearLimit).length;

      final connectionStatus = _isDemoMode
          ? DashboardConnectionStatus.demo
          : DashboardConnectionStatus.online;

      state = state.copyWith(
        status: DashboardStatus.success,
        connectionStatus: connectionStatus,
        report: report,
        activeDevices: activeCount > 0 ? activeCount : (report?.topConsumers.length ?? 0),
        blockedDevices: blockedCount,
        nearLimitDevices: nearLimitCount,
        recentActivity: _generateRecentActivities(),
        errorMessage: null,
        lastUpdated: DateTime.now(),
      );
    } catch (e) {
      // Fallback: If cache already exists or we can load local fallback
      if (state.report != null) {
        state = state.copyWith(
          connectionStatus: _isDemoMode
              ? DashboardConnectionStatus.demo
              : DashboardConnectionStatus.cached,
          errorMessage: 'Showing cached data',
          lastUpdated: DateTime.now(),
        );
      } else {
        state = state.copyWith(
          status: DashboardStatus.error,
          connectionStatus: _isDemoMode
              ? DashboardConnectionStatus.demo
              : DashboardConnectionStatus.error,
          errorMessage: e.toString(),
          lastUpdated: DateTime.now(),
        );
      }
    }
  }
}
