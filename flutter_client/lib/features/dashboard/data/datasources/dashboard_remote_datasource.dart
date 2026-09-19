import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';
import '../../domain/models/quota_report.dart';

abstract class DashboardRemoteDataSource {
  Future<QuotaReport> fetchQuotaReport();
}

class DashboardRemoteDataSourceImpl implements DashboardRemoteDataSource {
  final ApiClient _apiClient;

  DashboardRemoteDataSourceImpl(this._apiClient);

  @override
  Future<QuotaReport> fetchQuotaReport() async {
    final response = await _apiClient.get(ApiEndpoints.reports);
    return QuotaReport.fromJson(response as Map<String, dynamic>);
  }
}
