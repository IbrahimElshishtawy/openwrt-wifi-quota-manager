import 'package:flutter/material.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/utils/formatters.dart';
import '../../domain/models/quota_report.dart';

class IspQuotaGauge extends StatelessWidget {
  final QuotaReport report;

  const IspQuotaGauge({super.key, required this.report});

  @override
  Widget build(BuildContext context) {
    final ratio = report.usedRatio;
    final percentage = (ratio * 100).clamp(0, 100);

    // Color transition based on threshold
    final Color progressColor;
    if (ratio >= 0.9) {
      progressColor = AppColors.danger;
    } else if (ratio >= 0.75) {
      progressColor = AppColors.warning;
    } else {
      progressColor = AppColors.primary;
    }

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppColors.cardDark,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: AppColors.cardBorderDark),
        boxShadow: [
          BoxShadow(
            color: progressColor.withValues(alpha: 0.08),
            blurRadius: 24,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: AppColors.primary.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Icon(Icons.wifi_tethering, color: AppColors.primary, size: 20),
                  ),
                  const SizedBox(width: 10),
                  const Text(
                    'ISP Monthly Quota',
                    style: TextStyle(
                      color: AppColors.textPrimary,
                      fontWeight: FontWeight.w700,
                      fontSize: 16,
                    ),
                  ),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: AppColors.surfaceElevated,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.cardBorderDark),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.calendar_month_outlined, size: 14, color: AppColors.textSecondary),
                    const SizedBox(width: 4),
                    Text(
                      '${report.cycleDaysRemaining}d left',
                      style: const TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),

          // Central Circular Progress Gauge
          SizedBox(
            width: 170,
            height: 170,
            child: Stack(
              alignment: Alignment.center,
              children: [
                // Background Track
                SizedBox(
                  width: 160,
                  height: 160,
                  child: CircularProgressIndicator(
                    value: 1.0,
                    strokeWidth: 14,
                    color: AppColors.surfaceDark,
                  ),
                ),
                // Active Progress
                SizedBox(
                  width: 160,
                  height: 160,
                  child: TweenAnimationBuilder<double>(
                    tween: Tween<double>(begin: 0, end: ratio),
                    duration: const Duration(milliseconds: 900),
                    curve: Curves.easeOutCubic,
                    builder: (context, value, _) {
                      return CircularProgressIndicator(
                        value: value,
                        strokeWidth: 14,
                        strokeCap: StrokeCap.round,
                        valueColor: AlwaysStoppedAnimation<Color>(progressColor),
                      );
                    },
                  ),
                ),
                // Inner Content
                Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      '${percentage.toStringAsFixed(1)}%',
                      style: const TextStyle(
                        fontSize: 32,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                        letterSpacing: -1,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Consumed',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                        color: AppColors.textTertiary,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),

          const SizedBox(height: 24),

          // Stats row
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: AppColors.surfaceDark,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildStatItem('Total Used', Formatters.gigabytes(report.totalBandwidthUsedGb), progressColor),
                Container(height: 28, width: 1, color: AppColors.cardBorderDark),
                _buildStatItem('Package Limit', Formatters.gigabytes(report.packageTotalGb), AppColors.textPrimary),
                Container(height: 28, width: 1, color: AppColors.cardBorderDark),
                _buildStatItem('Remaining', Formatters.gigabytes(report.packageRemainingGb), AppColors.success),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatItem(String label, String value, Color valueColor) {
    return Column(
      children: [
        Text(
          label,
          style: const TextStyle(
            fontSize: 11,
            color: AppColors.textTertiary,
            fontWeight: FontWeight.w500,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          value,
          style: TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w700,
            color: valueColor,
          ),
        ),
      ],
    );
  }
}
