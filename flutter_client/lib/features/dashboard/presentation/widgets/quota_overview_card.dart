import 'package:flutter/material.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/utils/formatters.dart';
import 'circular_quota_indicator.dart';
import 'glass_card.dart';

class QuotaOverviewCard extends StatelessWidget {
  final double totalQuotaGb;
  final double usedQuotaGb;
  final double remainingQuotaGb;
  final double usagePercentage;
  final int daysRemaining;
  final DateTime lastUpdated;
  final VoidCallback? onTap;

  const QuotaOverviewCard({
    super.key,
    required this.totalQuotaGb,
    required this.usedQuotaGb,
    required this.remainingQuotaGb,
    required this.usagePercentage,
    required this.daysRemaining,
    required this.lastUpdated,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GlassCard(
      onTap: onTap,
      glowColor: AppColors.neonCyan,
      glowRadius: 24,
      border: Border.all(
        color: AppColors.neonCyan.withValues(alpha: 0.3),
        width: 1.2,
      ),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          // Left: Circular Quota Indicator & Total Usage
          CircularQuotaIndicator(
            usedGb: usedQuotaGb,
            totalGb: totalQuotaGb,
            percentage: usagePercentage,
            size: 138,
          ),
          const SizedBox(width: 16),

          // Right: ISP Package Info & Quota Details
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                // Header: Router Icon + Title + Chevron
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(7),
                      decoration: BoxDecoration(
                        color: AppColors.neonCyan.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                          color: AppColors.neonCyan.withValues(alpha: 0.25),
                          width: 0.8,
                        ),
                      ),
                      child: const Icon(
                        Icons.router_rounded,
                        color: AppColors.neonCyan,
                        size: 18,
                      ),
                    ),
                    const SizedBox(width: 8),
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'ISP Package',
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
                              color: AppColors.textPrimary,
                            ),
                          ),
                          Text(
                            'Monthly Quota',
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w500,
                              color: AppColors.textSecondary,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const Icon(
                      Icons.chevron_right_rounded,
                      color: AppColors.textSecondary,
                      size: 20,
                    ),
                  ],
                ),
                const SizedBox(height: 14),

                // Detail 1: Remaining
                _buildDetailRow(
                  icon: Icons.data_usage_rounded,
                  label: 'Remaining',
                  value: Formatters.gigabytes(remainingQuotaGb, decimals: remainingQuotaGb % 1 == 0 ? 0 : 1),
                  valueColor: AppColors.neonCyan,
                ),
                const SizedBox(height: 10),

                // Detail 2: Days Remaining
                _buildDetailRow(
                  icon: Icons.calendar_today_rounded,
                  label: 'Days Remaining',
                  value: '$daysRemaining Days',
                  valueColor: AppColors.neonCyan,
                ),
                const SizedBox(height: 10),

                // Detail 3: Last Refresh
                _buildDetailRow(
                  icon: Icons.sync_rounded,
                  label: 'Last Refresh',
                  value: Formatters.timeAgo(lastUpdated),
                  valueColor: AppColors.textSecondary,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDetailRow({
    required IconData icon,
    required String label,
    required String value,
    required Color valueColor,
  }) {
    return Row(
      children: [
        Container(
          width: 32,
          height: 32,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: AppColors.surfaceDark.withValues(alpha: 0.8),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: AppColors.cardBorderDark,
              width: 0.8,
            ),
          ),
          child: Icon(icon, size: 16, color: AppColors.neonCyan),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                label,
                style: const TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w500,
                  color: AppColors.textTertiary,
                ),
              ),
              FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: Text(
                  value,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: valueColor,
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
