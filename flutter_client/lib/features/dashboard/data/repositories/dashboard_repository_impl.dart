import '../../domain/models/quota_report.dart';
import '../../domain/repositories/dashboard_repository.dart';
import '../datasources/dashboard_local_datasource.dart';
import '../datasources/dashboard_remote_datasource.dart';

class DashboardRepositoryImpl implements DashboardRepository {
  final DashboardRemoteDataSource remoteDataSource;
  final DashboardLocalDataSource localDataSource;

  DashboardRepositoryImpl({
    required this.remoteDataSource,
    required this.localDataSource,
  });

  @override
  Future<QuotaReport> getQuotaReport({bool forceRefresh = false}) async {
    try {
      final remoteReport = await remoteDataSource.fetchQuotaReport();
      // Cache into Isar
      await localDataSource.cacheReport(remoteReport);
      // Also record snapshot for time-series analytics
      await localDataSource.saveHistorySnapshot(
        totalBandwidthUsedGb: remoteReport.totalBandwidthUsedGb,
        packageTotalGb: remoteReport.packageTotalGb,
        packageRemainingGb: remoteReport.packageRemainingGb,
        activeDevicesCount: 5,
        blockedDevicesCount: 1,
      );
      return remoteReport;
    } catch (e) {
      // Fallback to Isar offline cache
      final cached = await localDataSource.getCachedReport();
      if (cached != null) {
        return cached;
      }
      rethrow;
    }
  }
}
