import 'package:isar_community/isar.dart';
import '../../../../core/storage/entities/bandwidth_history_log.dart';
import '../../../../core/storage/isar_service.dart';
import '../../domain/models/usage_history_record.dart';
import '../../domain/repositories/analytics_repository.dart';

class AnalyticsRepositoryImpl implements AnalyticsRepository {
  final IsarService _isarService;

  AnalyticsRepositoryImpl(this._isarService);

  @override
  Future<List<UsageHistoryRecord>> getUsageHistory() async {
    await seedMockHistoryIfNeeded();

    final logs = await _isarService.historyLogs
        .where()
        .sortByTimestamp()
        .findAll();

    return logs
        .map(
          (l) => UsageHistoryRecord(
            timestamp: l.timestamp,
            totalBandwidthUsedGb: l.totalBandwidthUsedGb,
            packageTotalGb: l.packageTotalGb,
            packageRemainingGb: l.packageRemainingGb,
            activeDevicesCount: l.activeDevicesCount,
            blockedDevicesCount: l.blockedDevicesCount,
          ),
        )
        .toList();
  }

  @override
  Future<void> seedMockHistoryIfNeeded() async {
    final count = await _isarService.historyLogs.count();
    if (count > 0) return;

    // Seed realistic 7-day progression
    final now = DateTime.now();
    final logs = <BandwidthHistoryLog>[];

    final daysUsage = [45.0, 58.2, 71.0, 89.4, 102.1, 116.5, 128.0];
    for (int i = 6; i >= 0; i--) {
      final date = now.subtract(Duration(days: i));
      final usage = daysUsage[6 - i];
      final log = BandwidthHistoryLog()
        ..timestamp = date
        ..totalBandwidthUsedGb = usage
        ..packageTotalGb = 250.0
        ..packageRemainingGb = (250.0 - usage).clamp(0, 250).toDouble()
        ..activeDevicesCount = 4 + (i % 3)
        ..blockedDevicesCount = i == 0 ? 1 : 0;
      logs.add(log);
    }

    await _isarService.isar.writeTxn(() async {
      await _isarService.historyLogs.putAll(logs);
    });
  }
}
