import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/utils/formatters.dart';
import '../../../dashboard/presentation/widgets/glass_card.dart';
import '../controllers/analytics_controller.dart';
import '../widgets/usage_chart.dart';

class AnalyticsScreen extends ConsumerWidget {
  const AnalyticsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(analyticsControllerProvider);
    final controller = ref.read(analyticsControllerProvider.notifier);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Bandwidth Analytics'),
        actions: [
          IconButton(
            tooltip: 'Refresh History',
            onPressed: controller.loadHistory,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: state.isLoading
          ? const Center(child: CircularProgressIndicator(color: AppColors.primary))
          : RefreshIndicator(
              color: AppColors.primary,
              backgroundColor: AppColors.cardDark,
              onRefresh: controller.loadHistory,
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Offline Cache Glass Pill
                    GlassCard(
                      borderRadius: 14,
                      blur: 10,
                      opacity: 0.6,
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                      border: Border.all(
                        color: AppColors.primary.withValues(alpha: 0.2),
                      ),
                      child: Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.all(5),
                            decoration: BoxDecoration(
                              color: AppColors.primary.withValues(alpha: 0.15),
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(
                              Icons.storage_rounded,
                              size: 14,
                              color: AppColors.primary,
                            ),
                          ),
                          const SizedBox(width: 8),
                          const Expanded(
                            child: Text(
                              'Isar NoSQL offline database telemetry cache',
                              style: TextStyle(
                                color: AppColors.textSecondary,
                                fontSize: 11,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                            decoration: BoxDecoration(
                              color: AppColors.success.withValues(alpha: 0.15),
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(
                                color: AppColors.success.withValues(alpha: 0.35),
                              ),
                            ),
                            child: const Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.circle, size: 6, color: AppColors.success),
                                SizedBox(width: 4),
                                Text(
                                  'SYNCED',
                                  style: TextStyle(
                                    color: AppColors.success,
                                    fontSize: 9,
                                    fontWeight: FontWeight.w700,
                                    letterSpacing: 0.5,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),

                    const SizedBox(height: 14),

                    // 3 KPI Quick Metric Cards
                    Row(
                      children: [
                        _AnalyticsKpiCard(
                          icon: Icons.insights_rounded,
                          accentColor: AppColors.neonCyan,
                          label: 'Week Peak',
                          value: '${state.weekPeakGb.toStringAsFixed(1)} GB',
                        ),
                        const SizedBox(width: 8),
                        _AnalyticsKpiCard(
                          icon: Icons.speed_rounded,
                          accentColor: AppColors.electricBlue,
                          label: 'Daily Avg',
                          value: '${state.dailyAverageGb.toStringAsFixed(1)} GB/d',
                        ),
                        const SizedBox(width: 8),
                        _AnalyticsKpiCard(
                          icon: Icons.devices_rounded,
                          accentColor: AppColors.neonGreen,
                          label: 'Active Fleet',
                          value: state.dailyUsage.isNotEmpty
                              ? '${state.dailyUsage.last.activeDevicesCount} Devices'
                              : '5 Devices',
                        ),
                      ],
                    ),

                    const SizedBox(height: 16),

                    // Upgraded 7-Day Consumption Chart
                    UsageChart(
                      records: state.dailyUsage.isNotEmpty
                          ? state.dailyUsage
                          : state.history,
                    ),

                    const SizedBox(height: 24),

                    // Section Title
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Expanded(
                          child: Text(
                            'Telemetry Snapshots',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                              color: AppColors.textPrimary,
                              letterSpacing: -0.2,
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: AppColors.surfaceElevated,
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: AppColors.cardBorderDark),
                          ),
                          child: Text(
                            '${state.history.length} snapshots',
                            style: const TextStyle(
                              color: AppColors.textTertiary,
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ),

                    const SizedBox(height: 12),

                    // Snapshots List
                    if (state.history.isEmpty)
                      const GlassCard(
                        padding: EdgeInsets.all(20),
                        child: Center(
                          child: Text(
                            'No snapshots recorded yet',
                            style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
                          ),
                        ),
                      )
                    else
                      ListView.separated(
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        itemCount: state.history.reversed.length.clamp(0, 20),
                        separatorBuilder: (context, index) => const SizedBox(height: 8),
                        itemBuilder: (context, index) {
                          final item = state.history.reversed.toList()[index];
                          final quotaPct = item.packageTotalGb > 0
                              ? ((item.totalBandwidthUsedGb / item.packageTotalGb) * 100).clamp(0, 100)
                              : 0.0;

                          return GlassCard(
                            borderRadius: 16,
                            blur: 10,
                            opacity: 0.6,
                            padding: const EdgeInsets.all(12),
                            border: Border.all(color: AppColors.glassBorderSubtle),
                            child: Row(
                              children: [
                                Container(
                                  padding: const EdgeInsets.all(8),
                                  decoration: BoxDecoration(
                                    gradient: LinearGradient(
                                      colors: [
                                        AppColors.primary.withValues(alpha: 0.18),
                                        AppColors.accent.withValues(alpha: 0.08),
                                      ],
                                      begin: Alignment.topLeft,
                                      end: Alignment.bottomRight,
                                    ),
                                    borderRadius: BorderRadius.circular(10),
                                    border: Border.all(
                                      color: AppColors.primary.withValues(alpha: 0.25),
                                    ),
                                  ),
                                  child: const Icon(
                                    Icons.history_rounded,
                                    color: AppColors.primary,
                                    size: 18,
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        DateFormat('EEEE, MMM d • h:mm a').format(item.timestamp),
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: const TextStyle(
                                          fontSize: 13,
                                          fontWeight: FontWeight.w600,
                                          color: AppColors.textPrimary,
                                        ),
                                      ),
                                      const SizedBox(height: 4),
                                      Wrap(
                                        spacing: 8,
                                        runSpacing: 4,
                                        crossAxisAlignment: WrapCrossAlignment.center,
                                        children: [
                                          Row(
                                            mainAxisSize: MainAxisSize.min,
                                            children: [
                                              Container(
                                                width: 6,
                                                height: 6,
                                                decoration: const BoxDecoration(
                                                  color: AppColors.success,
                                                  shape: BoxShape.circle,
                                                ),
                                              ),
                                              const SizedBox(width: 4),
                                              Text(
                                                '${item.activeDevicesCount} active',
                                                style: const TextStyle(
                                                  fontSize: 11,
                                                  color: AppColors.textTertiary,
                                                  fontWeight: FontWeight.w500,
                                                ),
                                              ),
                                            ],
                                          ),
                                          if (item.blockedDevicesCount > 0)
                                            Row(
                                              mainAxisSize: MainAxisSize.min,
                                              children: [
                                                Container(
                                                  width: 6,
                                                  height: 6,
                                                  decoration: const BoxDecoration(
                                                    color: AppColors.danger,
                                                    shape: BoxShape.circle,
                                                  ),
                                                ),
                                                const SizedBox(width: 4),
                                                Text(
                                                  '${item.blockedDevicesCount} blocked',
                                                  style: const TextStyle(
                                                    fontSize: 11,
                                                    color: AppColors.danger,
                                                    fontWeight: FontWeight.w500,
                                                  ),
                                                ),
                                              ],
                                            ),
                                        ],
                                      ),
                                    ],
                                  ),
                                ),
                                Column(
                                  crossAxisAlignment: CrossAxisAlignment.end,
                                  children: [
                                    Text(
                                      Formatters.gigabytes(item.totalBandwidthUsedGb),
                                      style: const TextStyle(
                                        fontSize: 14,
                                        fontWeight: FontWeight.w800,
                                        color: AppColors.neonCyan,
                                      ),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      '${quotaPct.toStringAsFixed(1)}% quota',
                                      style: const TextStyle(
                                        fontSize: 10,
                                        color: AppColors.textTertiary,
                                        fontWeight: FontWeight.w500,
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          );
                        },
                      ),
                  ],
                ),
              ),
            ),
    );
  }
}

class _AnalyticsKpiCard extends StatelessWidget {
  final IconData icon;
  final Color accentColor;
  final String label;
  final String value;

  const _AnalyticsKpiCard({
    required this.icon,
    required this.accentColor,
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: GlassCard(
        borderRadius: 16,
        blur: 10,
        opacity: 0.65,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
        border: Border.all(
          color: accentColor.withValues(alpha: 0.25),
          width: 1,
        ),
        glowColor: accentColor,
        glowRadius: 10,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(5),
                  decoration: BoxDecoration(
                    color: accentColor.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(icon, size: 14, color: accentColor),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textTertiary,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(
                value,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                  letterSpacing: -0.3,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

