import '../models/usage_history_record.dart';

abstract class AnalyticsRepository {
  Future<List<UsageHistoryRecord>> getUsageHistory();
  Future<void> seedMockHistoryIfNeeded();
}
