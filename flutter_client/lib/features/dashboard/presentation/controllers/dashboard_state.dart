import '../../domain/models/quota_report.dart';

enum DashboardStatus { initial, loading, success, error }

class DashboardState {
  final DashboardStatus status;
  final QuotaReport? report;
  final String? errorMessage;
  final bool isOffline;
  final DateTime lastUpdated;

  const DashboardState({
    this.status = DashboardStatus.initial,
    this.report,
    this.errorMessage,
    this.isOffline = false,
    required this.lastUpdated,
  });

  DashboardState copyWith({
    DashboardStatus? status,
    QuotaReport? report,
    String? errorMessage,
    bool? isOffline,
    DateTime? lastUpdated,
  }) {
    return DashboardState(
      status: status ?? this.status,
      report: report ?? this.report,
      errorMessage: errorMessage ?? this.errorMessage,
      isOffline: isOffline ?? this.isOffline,
      lastUpdated: lastUpdated ?? this.lastUpdated,
    );
  }
}
