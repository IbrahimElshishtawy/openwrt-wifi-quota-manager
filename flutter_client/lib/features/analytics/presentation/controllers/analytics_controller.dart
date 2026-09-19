import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/di/providers.dart';
import '../../domain/models/usage_history_record.dart';
import '../../domain/repositories/analytics_repository.dart';

class AnalyticsState {
  final List<UsageHistoryRecord> history;
  final List<UsageHistoryRecord> dailyUsage;
  final bool isLoading;
  final String? errorMessage;

  const AnalyticsState({
    this.history = const [],
    this.dailyUsage = const [],
    this.isLoading = false,
    this.errorMessage,
  });

  AnalyticsState copyWith({
    List<UsageHistoryRecord>? history,
    List<UsageHistoryRecord>? dailyUsage,
    bool? isLoading,
    String? errorMessage,
  }) {
    return AnalyticsState(
      history: history ?? this.history,
      dailyUsage: dailyUsage ?? this.dailyUsage,
      isLoading: isLoading ?? this.isLoading,
      errorMessage: errorMessage ?? this.errorMessage,
    );
  }

  double get latestUsageGb {
    if (dailyUsage.isNotEmpty) return dailyUsage.last.totalBandwidthUsedGb;
    if (history.isNotEmpty) return history.last.totalBandwidthUsedGb;
    return 0.0;
  }

  double get weekPeakGb {
    if (dailyUsage.isEmpty) return latestUsageGb;
    return dailyUsage.map((e) => e.totalBandwidthUsedGb).reduce((a, b) => a > b ? a : b);
  }

  double get weekGrowthGb {
    if (dailyUsage.length < 2) return 0.0;
    final growth = dailyUsage.last.totalBandwidthUsedGb - dailyUsage.first.totalBandwidthUsedGb;
    return growth >= 0 ? growth : 0.0;
  }

  double get dailyAverageGb {
    if (dailyUsage.length < 2) return latestUsageGb > 0 ? (latestUsageGb / 7) : 0.0;
    final totalSpan = dailyUsage.last.totalBandwidthUsedGb - dailyUsage.first.totalBandwidthUsedGb;
    return totalSpan / (dailyUsage.length - 1);
  }
}

final analyticsControllerProvider = StateNotifierProvider<AnalyticsController, AnalyticsState>((ref) {
  final repo = ref.watch(analyticsRepositoryProvider);
  return AnalyticsController(repo);
});

class AnalyticsController extends StateNotifier<AnalyticsState> {
  final AnalyticsRepository _repository;

  AnalyticsController(this._repository) : super(const AnalyticsState()) {
    loadHistory();
  }

  Future<void> loadHistory() async {
    state = state.copyWith(isLoading: true, errorMessage: null);
    try {
      final records = await _repository.getUsageHistory();
      final daily = await _repository.getDailyUsageHistory(days: 7);
      state = state.copyWith(
        history: records,
        dailyUsage: daily,
        isLoading: false,
      );
    } catch (e) {
      state = state.copyWith(isLoading: false, errorMessage: e.toString());
    }
  }
}
