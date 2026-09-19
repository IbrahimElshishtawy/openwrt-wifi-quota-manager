import 'package:intl/intl.dart';
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
  Future<List<UsageHistoryRecord>> getDailyUsageHistory({int days = 7}) async {
    await seedMockHistoryIfNeeded();

    final allLogs = await _isarService.historyLogs
        .where()
        .sortByTimestamp()
        .findAll();

    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final dayFormat = DateFormat('yyyy-MM-dd');

    // Group logs by day and keep the latest log for each day
    final Map<String, BandwidthHistoryLog> mapByDay = {};
    for (final log in allLogs) {
      final key = dayFormat.format(log.timestamp);
      mapByDay[key] = log;
    }

    final result = <UsageHistoryRecord>[];
    final latestRecord = allLogs.isNotEmpty ? allLogs.last : null;
    final latestUsage = latestRecord?.totalBandwidthUsedGb ?? 128.0;
    final totalPackage = latestRecord?.packageTotalGb ?? 250.0;

    for (int i = days - 1; i >= 0; i--) {
      final targetDate = today.subtract(Duration(days: i));
      final key = dayFormat.format(targetDate);

      if (mapByDay.containsKey(key)) {
        final l = mapByDay[key]!;
        result.add(UsageHistoryRecord(
          timestamp: targetDate,
          totalBandwidthUsedGb: l.totalBandwidthUsedGb,
          packageTotalGb: l.packageTotalGb,
          packageRemainingGb: l.packageRemainingGb,
          activeDevicesCount: l.activeDevicesCount,
          blockedDevicesCount: l.blockedDevicesCount,
        ));
      } else {
        final progress = (days - i) / days;
        final startUsage = (latestUsage * 0.45).clamp(20.0, latestUsage);
        final estimated = startUsage + (latestUsage - startUsage) * progress;
        final rounded = double.parse(estimated.toStringAsFixed(1));

        result.add(UsageHistoryRecord(
          timestamp: targetDate,
          totalBandwidthUsedGb: rounded,
          packageTotalGb: totalPackage,
          packageRemainingGb: (totalPackage - rounded).clamp(0, totalPackage).toDouble(),
          activeDevicesCount: 5,
          blockedDevicesCount: 1,
        ));
      }
    }

    // Ensure non-decreasing cumulative curve for quota consumption
    for (int i = 1; i < result.length; i++) {
      if (result[i].totalBandwidthUsedGb < result[i - 1].totalBandwidthUsedGb) {
        result[i] = UsageHistoryRecord(
          timestamp: result[i].timestamp,
          totalBandwidthUsedGb: result[i - 1].totalBandwidthUsedGb,
          packageTotalGb: result[i].packageTotalGb,
          packageRemainingGb: result[i].packageRemainingGb,
          activeDevicesCount: result[i].activeDevicesCount,
          blockedDevicesCount: result[i].blockedDevicesCount,
        );
      }
    }

    return result;
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
