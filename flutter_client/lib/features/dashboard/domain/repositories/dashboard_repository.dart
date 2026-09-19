import '../models/quota_report.dart';

abstract class DashboardRepository {
  Future<QuotaReport> getQuotaReport({bool forceRefresh = false});
}
