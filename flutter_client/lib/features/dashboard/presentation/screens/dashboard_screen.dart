import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/utils/greeting_helper.dart';
import '../../../devices/presentation/controllers/devices_controller.dart';
import '../controllers/dashboard_controller.dart';
import '../controllers/dashboard_state.dart';
import '../widgets/dashboard_header.dart';
import '../widgets/dashboard_metric_card.dart';
import '../widgets/dashboard_skeleton.dart';
import '../widgets/glass_card.dart';
import '../widgets/quota_overview_card.dart';
import '../widgets/recent_activity_section.dart';
import '../widgets/top_consumers_section.dart';

class DashboardScreen extends ConsumerWidget {
  final void Function(int tabIndex)? onNavigateTab;

  const DashboardScreen({super.key, this.onNavigateTab});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final dashboardState = ref.watch(dashboardControllerProvider);
    final now = DateTime.now();
    final formattedDate = DateFormat('MMM d, yyyy').format(now);
    final formattedTime = DateFormat('hh:mm a').format(now);

    return Scaffold(
      backgroundColor: AppColors.bgDark,
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          color: AppColors.neonCyan,
          backgroundColor: AppColors.cardDark,
          onRefresh: () async {
            await Future.wait([
              ref.read(dashboardControllerProvider.notifier).loadData(forceRefresh: true),
              ref.read(devicesControllerProvider.notifier).loadDevices(forceRefresh: true),
            ]);
          },
          child: SingleChildScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // 1. Dashboard Header (Menu, Wi-Fi title, Online pill)
                DashboardHeader(
                  connectionStatus: dashboardState.connectionStatus,
                  onMenuTap: () => onNavigateTab?.call(3),
                  onStatusTap: () => onNavigateTab?.call(3),
                ),
                const SizedBox(height: 18),

                // 2. Greeting Section with Date/Time Badge
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            GreetingHelper.getGreeting(),
                            style: const TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.w800,
                              color: AppColors.textPrimary,
                              letterSpacing: -0.4,
                            ),
                          ),
                          const SizedBox(height: 2),
                          const Text(
                            "Here's what's happening with your network today",
                            style: TextStyle(
                              fontSize: 11.5,
                              fontWeight: FontWeight.w500,
                              color: AppColors.textSecondary,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    // Date & Time Glass Badge
                    GlassCard(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      borderRadius: 12,
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(
                            Icons.calendar_today_outlined,
                            size: 14,
                            color: AppColors.textSecondary,
                          ),
                          const SizedBox(width: 6),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(
                                formattedDate,
                                style: const TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.w600,
                                  color: AppColors.textPrimary,
                                  height: 1.1,
                                ),
                              ),
                              Text(
                                formattedTime,
                                style: const TextStyle(
                                  fontSize: 9,
                                  fontWeight: FontWeight.w500,
                                  color: AppColors.textTertiary,
                                  height: 1.1,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 18),

                // Offline / Cache Notification Banner
                if (dashboardState.isOffline && dashboardState.report != null)
                  Container(
                    margin: const EdgeInsets.only(bottom: 16),
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    decoration: BoxDecoration(
                      color: AppColors.warning.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(
                        color: AppColors.warning.withValues(alpha: 0.35),
                        width: 1,
                      ),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.cloud_off_rounded, color: AppColors.warning, size: 18),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            dashboardState.connectionStatus == DashboardConnectionStatus.cached
                                ? 'Showing cached data from Isar DB. Reconnecting to OpenWrt...'
                                : 'Offline mode: Showing cached network snapshot.',
                            style: const TextStyle(
                              color: AppColors.warning,
                              fontSize: 12,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ),
                        TextButton(
                          onPressed: () {
                            ref.read(dashboardControllerProvider.notifier).loadData(forceRefresh: true);
                          },
                          child: const Text('Retry', style: TextStyle(color: AppColors.warning, fontSize: 12)),
                        ),
                      ],
                    ),
                  ),

                // 3. Primary Dashboard Content or Loading Skeleton
                if (dashboardState.status == DashboardStatus.loading && dashboardState.report == null)
                  const DashboardSkeleton()
                else if (dashboardState.report != null) ...[
                  // 3a. Primary Card: QuotaOverviewCard
                  QuotaOverviewCard(
                    totalQuotaGb: dashboardState.totalQuota,
                    usedQuotaGb: dashboardState.usedQuota,
                    remainingQuotaGb: dashboardState.remainingQuota,
                    usagePercentage: dashboardState.usagePercentage,
                    daysRemaining: dashboardState.daysRemaining,
                    lastUpdated: dashboardState.lastUpdated,
                    onTap: () => onNavigateTab?.call(2), // analytics tab
                  ),
                  const SizedBox(height: 14),

                  // 3b. 4 Compact Statistics Cards
                  Row(
                    children: [
                      // Active Devices
                      Expanded(
                        child: DashboardMetricCard(
                          title: 'Active Devices',
                          value: '${dashboardState.activeDevices}',
                          subtitle: '↑ 2 new',
                          icon: Icons.wifi_rounded,
                          accentColor: AppColors.neonGreen,
                          onTap: () => onNavigateTab?.call(1),
                        ),
                      ),
                      const SizedBox(width: 8),

                      // Blocked Devices
                      Expanded(
                        child: DashboardMetricCard(
                          title: 'Blocked Devices',
                          value: '${dashboardState.blockedDevices}',
                          subtitle: '↓ 1',
                          icon: Icons.block_rounded,
                          accentColor: AppColors.danger,
                          onTap: () => onNavigateTab?.call(1),
                        ),
                      ),
                      const SizedBox(width: 8),

                      // Near Limit
                      Expanded(
                        child: DashboardMetricCard(
                          title: 'Near Limit',
                          value: '${dashboardState.nearLimitDevices}',
                          subtitle: '> 90% usage',
                          icon: Icons.warning_amber_rounded,
                          accentColor: AppColors.warning,
                          onTap: () => onNavigateTab?.call(1),
                        ),
                      ),
                      const SizedBox(width: 8),

                      // Auto Refresh
                      Expanded(
                        child: DashboardMetricCard(
                          title: 'Auto Refresh',
                          value: '${dashboardState.refreshInterval}s',
                          subtitle: 'Interval',
                          icon: Icons.sync_rounded,
                          accentColor: AppColors.neonCyan,
                          onTap: () => onNavigateTab?.call(3),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),

                  // 3c. Top Bandwidth Consumers Section
                  TopConsumersSection(
                    consumers: dashboardState.topConsumers,
                    totalPackageGb: dashboardState.totalQuota,
                    onViewAllTap: () => onNavigateTab?.call(1),
                  ),
                  const SizedBox(height: 16),

                  // 3d. Recent Activity Section
                  RecentActivitySection(
                    events: dashboardState.recentActivity,
                    onViewAllTap: () => onNavigateTab?.call(1),
                  ),
                ] else if (dashboardState.status == DashboardStatus.error) ...[
                  // Error State Container with Retry
                  GlassCard(
                    glowColor: AppColors.danger,
                    glowRadius: 20,
                    border: Border.all(
                      color: AppColors.danger.withValues(alpha: 0.35),
                      width: 1.2,
                    ),
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      children: [
                        const Icon(
                          Icons.error_outline_rounded,
                          color: AppColors.danger,
                          size: 48,
                        ),
                        const SizedBox(height: 14),
                        const Text(
                          'Unable to connect to OpenWrt',
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 16,
                            color: AppColors.textPrimary,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          dashboardState.errorMessage ??
                              'Connection timeout. Check router IP and Wi-Fi connection.',
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            fontSize: 13,
                            color: AppColors.textSecondary,
                          ),
                        ),
                        const SizedBox(height: 20),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            OutlinedButton.icon(
                              onPressed: () => onNavigateTab?.call(3),
                              icon: const Icon(Icons.settings_outlined, size: 16),
                              label: const Text('Check Settings'),
                            ),
                            const SizedBox(width: 12),
                            ElevatedButton.icon(
                              onPressed: () {
                                ref
                                    .read(dashboardControllerProvider.notifier)
                                    .loadData(forceRefresh: true);
                              },
                              icon: const Icon(Icons.refresh_rounded, size: 16),
                              label: const Text('Retry'),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],

                const SizedBox(height: 20),

                // Subtle bottom safe space for bottom navigation bar
                const SizedBox(height: 70),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
