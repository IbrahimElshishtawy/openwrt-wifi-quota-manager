import 'dart:convert';
import 'package:isar_community/isar.dart';
import '../../../../core/storage/entities/bandwidth_history_log.dart';
import '../../../../core/storage/entities/cached_report.dart';
import '../../../../core/storage/isar_service.dart';
import '../../domain/models/quota_report.dart';

abstract class DashboardLocalDataSource {
  Future<QuotaReport?> getCachedReport();
  Future<void> cacheReport(QuotaReport report);
  Future<void> saveHistorySnapshot({
    required double totalBandwidthUsedGb,
    required double packageTotalGb,
    required double packageRemainingGb,
    required int activeDevicesCount,
    required int blockedDevicesCount,
  });
}

class DashboardLocalDataSourceImpl implements DashboardLocalDataSource {
  final IsarService _isarService;

  DashboardLocalDataSourceImpl(this._isarService);

  @override
  Future<QuotaReport?> getCachedReport() async {
    final cached = await _isarService.reports.where().findFirst();
    if (cached == null) return null;

    List<TopConsumer> consumers = [];
    try {
      if (cached.topConsumersJson.isNotEmpty) {
        final decoded = jsonDecode(cached.topConsumersJson) as List<dynamic>;
        consumers = decoded
            .map((c) => TopConsumer.fromJson(c as Map<String, dynamic>))
            .toList();
      }
    } catch (_) {}

    return QuotaReport(
      totalBandwidthUsedGb: cached.totalBandwidthUsedGb,
      packageTotalGb: cached.packageTotalGb,
      packageRemainingGb: cached.packageRemainingGb,
      cycleDaysRemaining: cached.cycleDaysRemaining,
      topConsumers: consumers,
    );
  }

  @override
  Future<void> cacheReport(QuotaReport report) async {
    final entity = CachedReport()
      ..totalBandwidthUsedGb = report.totalBandwidthUsedGb
      ..packageTotalGb = report.packageTotalGb
      ..packageRemainingGb = report.packageRemainingGb
      ..cycleDaysRemaining = report.cycleDaysRemaining
      ..lastUpdated = DateTime.now()
      ..topConsumersJson = jsonEncode(report.topConsumers.map((c) => c.toJson()).toList());

    await _isarService.isar.writeTxn(() async {
      await _isarService.reports.clear();
      await _isarService.reports.put(entity);
    });
  }

  @override
  Future<void> saveHistorySnapshot({
    required double totalBandwidthUsedGb,
    required double packageTotalGb,
    required double packageRemainingGb,
    required int activeDevicesCount,
    required int blockedDevicesCount,
  }) async {
    final log = BandwidthHistoryLog()
      ..timestamp = DateTime.now()
      ..totalBandwidthUsedGb = totalBandwidthUsedGb
      ..packageTotalGb = packageTotalGb
      ..packageRemainingGb = packageRemainingGb
      ..activeDevicesCount = activeDevicesCount
      ..blockedDevicesCount = blockedDevicesCount;

    await _isarService.isar.writeTxn(() async {
      await _isarService.historyLogs.put(log);
    });
  }
}
