import '../models/usage_history_record.dart';

abstract class AnalyticsRepository {
  Future<List<UsageHistoryRecord>> getUsageHistory();
  Future<List<UsageHistoryRecord>> getDailyUsageHistory({int days = 7});
  Future<void> seedMockHistoryIfNeeded();
}
