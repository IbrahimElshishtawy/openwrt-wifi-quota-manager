import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/di/providers.dart';
import '../../domain/models/usage_history_record.dart';
import '../../domain/repositories/analytics_repository.dart';

class AnalyticsState {
  final List<UsageHistoryRecord> history;
  final bool isLoading;
  final String? errorMessage;

  const AnalyticsState({
    this.history = const [],
    this.isLoading = false,
    this.errorMessage,
  });

  AnalyticsState copyWith({
    List<UsageHistoryRecord>? history,
    bool? isLoading,
    String? errorMessage,
  }) {
    return AnalyticsState(
      history: history ?? this.history,
      isLoading: isLoading ?? this.isLoading,
      errorMessage: errorMessage ?? this.errorMessage,
    );
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
      state = state.copyWith(history: records, isLoading: false);
    } catch (e) {
      state = state.copyWith(isLoading: false, errorMessage: e.toString());
    }
  }
}
