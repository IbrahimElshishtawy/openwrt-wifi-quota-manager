import '../../domain/models/network_activity_event.dart';
import '../../domain/models/quota_report.dart';

enum DashboardStatus { initial, loading, success, error }

enum DashboardConnectionStatus {
  online,
  offline,
  cached,
  demo,
  connecting,
  error,
}

class DashboardState {
  final DashboardStatus status;
  final DashboardConnectionStatus connectionStatus;
  final QuotaReport? report;
  final String? errorMessage;
  final int activeDevices;
  final int blockedDevices;
  final int nearLimitDevices;
  final int refreshInterval;
  final List<NetworkActivityEvent> recentActivity;
  final DateTime lastUpdated;

  const DashboardState({
    this.status = DashboardStatus.initial,
    this.connectionStatus = DashboardConnectionStatus.connecting,
    this.report,
    this.errorMessage,
    this.activeDevices = 0,
    this.blockedDevices = 0,
    this.nearLimitDevices = 0,
    this.refreshInterval = 15,
    this.recentActivity = const [],
    required this.lastUpdated,
  });

  bool get isOffline =>
      connectionStatus == DashboardConnectionStatus.offline ||
      connectionStatus == DashboardConnectionStatus.cached;

  bool get isDemoMode => connectionStatus == DashboardConnectionStatus.demo;

  double get totalQuota => report?.packageTotalGb ?? 100.0;
  double get usedQuota => report?.totalBandwidthUsedGb ?? 0.0;
  double get remainingQuota =>
      report?.packageRemainingGb ?? (totalQuota - usedQuota).clamp(0.0, 9999.0);
  double get usagePercentage => report?.usedPercentage ?? 0.0;
  int get daysRemaining => report?.cycleDaysRemaining ?? 0;
  List<TopConsumer> get topConsumers => report?.topConsumers ?? const [];

  DashboardState copyWith({
    DashboardStatus? status,
    DashboardConnectionStatus? connectionStatus,
    QuotaReport? report,
    String? errorMessage,
    int? activeDevices,
    int? blockedDevices,
    int? nearLimitDevices,
    int? refreshInterval,
    List<NetworkActivityEvent>? recentActivity,
    DateTime? lastUpdated,
  }) {
    return DashboardState(
      status: status ?? this.status,
      connectionStatus: connectionStatus ?? this.connectionStatus,
      report: report ?? this.report,
      errorMessage: errorMessage ?? this.errorMessage,
      activeDevices: activeDevices ?? this.activeDevices,
      blockedDevices: blockedDevices ?? this.blockedDevices,
      nearLimitDevices: nearLimitDevices ?? this.nearLimitDevices,
      refreshInterval: refreshInterval ?? this.refreshInterval,
      recentActivity: recentActivity ?? this.recentActivity,
      lastUpdated: lastUpdated ?? this.lastUpdated,
    );
  }
}
