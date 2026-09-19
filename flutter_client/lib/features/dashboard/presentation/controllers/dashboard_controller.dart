import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/di/providers.dart';
import '../../domain/repositories/dashboard_repository.dart';
import 'dashboard_state.dart';

final dashboardControllerProvider = StateNotifierProvider<DashboardController, DashboardState>((ref) {
  final repo = ref.watch(dashboardRepositoryProvider);
  final controller = DashboardController(repo);
  ref.onDispose(() => controller.disposeTimer());
  return controller;
});

class DashboardController extends StateNotifier<DashboardState> {
  final DashboardRepository _repository;
  Timer? _pollingTimer;

  DashboardController(this._repository)
      : super(DashboardState(lastUpdated: DateTime.now())) {
    loadData();
    startPolling(intervalSeconds: 10);
  }

  void startPolling({int intervalSeconds = 10}) {
    _pollingTimer?.cancel();
    _pollingTimer = Timer.periodic(Duration(seconds: intervalSeconds), (_) {
      loadData(isBackground: true);
    });
  }

  void disposeTimer() {
    _pollingTimer?.cancel();
  }

  Future<void> loadData({bool isBackground = false}) async {
    if (!isBackground && state.status != DashboardStatus.success) {
      state = state.copyWith(status: DashboardStatus.loading);
    }

    try {
      final report = await _repository.getQuotaReport(forceRefresh: !isBackground);
      state = state.copyWith(
        status: DashboardStatus.success,
        report: report,
        isOffline: false,
        errorMessage: null,
        lastUpdated: DateTime.now(),
      );
    } catch (e) {
      // If we already had a report (e.g. from cache or previous fetch)
      if (state.report != null) {
        state = state.copyWith(
          isOffline: true,
          errorMessage: 'Offline: Showing cached data',
          lastUpdated: DateTime.now(),
        );
      } else {
        state = state.copyWith(
          status: DashboardStatus.error,
          errorMessage: e.toString(),
          isOffline: true,
          lastUpdated: DateTime.now(),
        );
      }
    }
  }
}
