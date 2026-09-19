import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/utils/formatters.dart';
import '../../../devices/presentation/controllers/devices_controller.dart';
import '../../../settings/presentation/controllers/settings_controller.dart';
import '../controllers/dashboard_controller.dart';
import '../controllers/dashboard_state.dart';
import '../widgets/connection_status_badge.dart';
import '../widgets/isp_quota_gauge.dart';
import '../widgets/network_metric_card.dart';
import '../widgets/top_consumers_section.dart';

class DashboardScreen extends ConsumerWidget {
  final void Function(int tabIndex)? onNavigateTab;

  const DashboardScreen({super.key, this.onNavigateTab});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final dashboardState = ref.watch(dashboardControllerProvider);
    final settings = ref.watch(settingsControllerProvider);
    final devicesState = ref.watch(devicesControllerProvider);

    final activeCount = devicesState.devices.where((d) => d.enabled && !d.isBlocked).length;
    final blockedCount = devicesState.devices.where((d) => d.isBlocked || !d.enabled).length;

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'OpenWrt Quota Manager',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, letterSpacing: -0.5),
            ),
            Text(
              'Router Subsystem Dashboard',
              style: TextStyle(fontSize: 11, color: AppColors.textTertiary, fontWeight: FontWeight.w500),
            ),
          ],
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 16),
            child: ConnectionStatusBadge(
              isDemoMode: settings.isDemoMode,
              isOffline: dashboardState.isOffline,
              routerIp: settings.routerIp,
            ),
          ),
        ],
      ),
      body: RefreshIndicator(
        color: AppColors.primary,
        backgroundColor: AppColors.cardDark,
        onRefresh: () async {
          await Future.wait([
            ref.read(dashboardControllerProvider.notifier).loadData(),
            ref.read(devicesControllerProvider.notifier).loadDevices(forceRefresh: true),
          ]);
        },
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Offline or Warning Banner if applicable
              if (dashboardState.isOffline)
                Container(
                  margin: const EdgeInsets.only(bottom: 16),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: AppColors.warning.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppColors.warning.withValues(alpha: 0.4)),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.cloud_off, color: AppColors.warning, size: 18),
                      const SizedBox(width: 10),
                      const Expanded(
                        child: Text(
                          'Showing offline cached data from Isar DB. Trying to reconnect to OpenWrt...',
                          style: TextStyle(color: AppColors.warning, fontSize: 12, fontWeight: FontWeight.w500),
                        ),
                      ),
                    ],
                  ),
                ),

              // Loading State or Report Gauge
              if (dashboardState.status == DashboardStatus.loading && dashboardState.report == null)
                const SizedBox(
                  height: 280,
                  child: Center(
                    child: CircularProgressIndicator(color: AppColors.primary),
                  ),
                )
              else if (dashboardState.report != null) ...[
                IspQuotaGauge(report: dashboardState.report!),
                const SizedBox(height: 16),

                // Metrics Grid
                Row(
                  children: [
                    Expanded(
                      child: SizedBox(
                        height: 144,
                        child: NetworkMetricCard(
                          title: 'Active Devices',
                          value: '$activeCount',
                          subtitle: 'Connected & Allowed',
                          icon: Icons.devices,
                          iconColor: AppColors.success,
                          onTap: () => onNavigateTab?.call(1),
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: SizedBox(
                        height: 144,
                        child: NetworkMetricCard(
                          title: 'Blocked (nft)',
                          value: '$blockedCount',
                          subtitle: 'Firewall Dropped',
                          icon: Icons.block,
                          iconColor: AppColors.danger,
                          onTap: () => onNavigateTab?.call(1),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: SizedBox(
                        height: 144,
                        child: NetworkMetricCard(
                          title: 'Billing Cycle',
                          value: '${dashboardState.report!.cycleDaysRemaining} Days',
                          subtitle: 'Remaining till reset',
                          icon: Icons.date_range,
                          iconColor: AppColors.primary,
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: SizedBox(
                        height: 144,
                        child: NetworkMetricCard(
                          title: 'Auto-Refresh',
                          value: '${settings.refreshInterval}s',
                          subtitle: 'Live Polling active',
                          icon: Icons.autorenew,
                          iconColor: AppColors.accent,
                          onTap: () => onNavigateTab?.call(3),
                        ),
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: 16),

                // Top Consumers Section
                TopConsumersSection(
                  consumers: dashboardState.report!.topConsumers,
                  totalPackageGb: dashboardState.report!.packageTotalGb,
                ),
              ] else if (dashboardState.status == DashboardStatus.error) ...[
                Container(
                  padding: const EdgeInsets.all(24),
                  decoration: BoxDecoration(
                    color: AppColors.cardDark,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: AppColors.danger.withValues(alpha: 0.3)),
                  ),
                  child: Column(
                    children: [
                      const Icon(Icons.error_outline, color: AppColors.danger, size: 48),
                      const SizedBox(height: 12),
                      const Text(
                        'Failed to connect to OpenWrt Router',
                        style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16, color: AppColors.textPrimary),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        dashboardState.errorMessage ?? 'Connection timeout. Check router IP and Wi-Fi.',
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 13, color: AppColors.textSecondary),
                      ),
                      const SizedBox(height: 18),
                      ElevatedButton.icon(
                        onPressed: () {
                          ref.read(dashboardControllerProvider.notifier).loadData();
                        },
                        icon: const Icon(Icons.refresh),
                        label: const Text('Try Again'),
                      ),
                    ],
                  ),
                ),
              ],

              const SizedBox(height: 24),

              // Last sync timestamp
              Center(
                child: Text(
                  'Last updated: ${Formatters.timeAgo(dashboardState.lastUpdated)}',
                  style: const TextStyle(fontSize: 11, color: AppColors.textTertiary),
                ),
              ),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }
}
