// ignore_for_file: prefer_initializing_formals
import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/di/providers.dart';
import '../../../../core/network/mock_data_generator.dart';
import '../../../../core/network/openwrt_client.dart';
import '../../../devices/domain/models/device_model.dart';
import '../../../devices/domain/repositories/device_repository.dart';
import '../../../settings/presentation/controllers/settings_controller.dart';
import '../../domain/models/network_activity_event.dart';
import '../../domain/models/quota_report.dart';
import '../../domain/repositories/dashboard_repository.dart';
import 'dashboard_state.dart';

final dashboardControllerProvider =
    StateNotifierProvider<DashboardController, DashboardState>((ref) {
  final dashboardRepo = ref.watch(dashboardRepositoryProvider);
  final deviceRepo = ref.watch(deviceRepositoryProvider);
  final openWrtClient = ref.watch(openWrtClientProvider);
  final settings = ref.watch(settingsControllerProvider);

  final controller = DashboardController(
    dashboardRepository: dashboardRepo,
    deviceRepository: deviceRepo,
    openWrtClient: openWrtClient,
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
  final OpenWrtClient _openWrtClient;
  bool _isDemoMode;
  Timer? _pollingTimer;
  bool _isFetching = false;

  DashboardController({
    required DashboardRepository dashboardRepository,
    required DeviceRepository deviceRepository,
    required OpenWrtClient openWrtClient,
    int initialRefreshInterval = 15,
    bool isDemoMode = false,
  })  : _dashboardRepository = dashboardRepository,
        _deviceRepository = deviceRepository,
        _openWrtClient = openWrtClient,
        _isDemoMode = isDemoMode,
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
    // Never inject simulated mock activities if Demo Mode is disabled
    if (!_isDemoMode) {
      return const [];
    }
    return MockDataGenerator.mockActivities
        .map((a) => NetworkActivityEvent.fromJson(a))
        .toList();
  }

  Future<void> loadData({
    bool isBackground = false,
    bool forceRefresh = false,
  }) async {
    // Guard against overlapping concurrent requests (e.g. from 5s polling or manual refresh)
    if (_isFetching) return;
    _isFetching = true;

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
      final sysInfoFuture = _openWrtClient.getSystemInfo();

      final results = await Future.wait([reportFuture, devicesFuture, sysInfoFuture]);
      final report = results[0] as QuotaReport;
      final devices = results[1] as List<DeviceModel>;
      final sysInfo = results[2] as OpenWrtSystemInfo;

      final activeCount = devices.where((d) => d.enabled && !d.isBlocked).length;
      final blockedCount = devices.where((d) => d.isBlocked || !d.enabled).length;
      final nearLimitCount = devices.where((d) => d.isNearLimit).length;

      // Ensure top 5 consumers are calculated from real device traffic data
      List<TopConsumer> topConsumers = report.topConsumers;
      if (topConsumers.isEmpty && devices.isNotEmpty) {
        final sorted = List<DeviceModel>.from(devices)
          ..sort((a, b) => b.usageGb.compareTo(a.usageGb));
        topConsumers = sorted.take(5).map((d) {
          return TopConsumer(
            mac: d.mac,
            name: d.name,
            ip: d.ip,
            usageGb: d.usageGb,
            percentage: d.usageRatio * 100,
          );
        }).toList();
      }

      final enrichedReport = QuotaReport(
        totalBandwidthUsedGb: report.totalBandwidthUsedGb,
        packageTotalGb: report.packageTotalGb,
        packageRemainingGb: report.packageRemainingGb,
        cycleDaysRemaining: report.cycleDaysRemaining,
        topConsumers: topConsumers.take(5).toList(),
      );

      final connectionStatus = _isDemoMode
          ? DashboardConnectionStatus.demo
          : DashboardConnectionStatus.online;

      state = state.copyWith(
        status: DashboardStatus.success,
        connectionStatus: connectionStatus,
        report: enrichedReport,
        systemInfo: sysInfo,
        activeDevices: activeCount > 0 ? activeCount : enrichedReport.topConsumers.length,
        blockedDevices: blockedCount,
        nearLimitDevices: nearLimitCount,
        recentActivity: _generateRecentActivities(),
        errorMessage: null,
        lastUpdated: DateTime.now(),
      );
    } catch (e) {
      // Offline-First Fallback: retain Isar cached report
      if (state.report != null) {
        state = state.copyWith(
          connectionStatus: _isDemoMode
              ? DashboardConnectionStatus.demo
              : DashboardConnectionStatus.cached,
          errorMessage: 'Showing cached data from Isar DB',
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
    } finally {
      _isFetching = false;
    }
  }
}
