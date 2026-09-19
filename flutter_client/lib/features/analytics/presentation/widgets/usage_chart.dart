import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../dashboard/presentation/widgets/glass_card.dart';
import '../../domain/models/usage_history_record.dart';

class UsageChart extends StatelessWidget {
  final List<UsageHistoryRecord> records;

  const UsageChart({super.key, required this.records});

  @override
  Widget build(BuildContext context) {
    if (records.isEmpty) {
      return const GlassCard(
        padding: EdgeInsets.all(24),
        child: Center(
          child: Text(
            'No historical usage data yet',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
          ),
        ),
      );
    }

    final spots = <FlSpot>[];
    for (int i = 0; i < records.length; i++) {
      spots.add(FlSpot(i.toDouble(), records[i].totalBandwidthUsedGb));
    }

    final maxUsage = records.map((r) => r.totalBandwidthUsedGb).reduce((a, b) => a > b ? a : b);
    final latestRecord = records.last;
    final firstRecord = records.first;
    final growth = latestRecord.totalBandwidthUsedGb - firstRecord.totalBandwidthUsedGb;

    // Calculate clean Y-axis bounds
    final maxY = ((maxUsage / 25).ceil() * 25).toDouble().clamp(50.0, 400.0);
    final yInterval = (maxY / 3).roundToDouble().clamp(20.0, 100.0);

    return GlassCard(
      borderRadius: 22,
      blur: 14,
      opacity: 0.75,
      glowColor: AppColors.primary,
      glowRadius: 20,
      padding: const EdgeInsets.all(18),
      border: Border.all(
        color: AppColors.primary.withValues(alpha: 0.25),
        width: 1.2,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header Row
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: AppColors.primary.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                          color: AppColors.primary.withValues(alpha: 0.25),
                        ),
                      ),
                      child: const Icon(
                        Icons.show_chart_rounded,
                        color: AppColors.primary,
                        size: 18,
                      ),
                    ),
                    const SizedBox(width: 10),
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '7-Day Consumption Curve',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w700,
                              color: AppColors.textPrimary,
                              letterSpacing: -0.2,
                            ),
                          ),
                          Text(
                            'Daily cumulative bandwidth',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 11,
                              color: AppColors.textTertiary,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(
                    color: AppColors.primary.withValues(alpha: 0.3),
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 6,
                      height: 6,
                      decoration: const BoxDecoration(
                        color: AppColors.primary,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 6),
                    const Text(
                      '7 Days',
                      style: TextStyle(
                        color: AppColors.primary,
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),

          const SizedBox(height: 14),

          // Key Stat Row
          Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 10,
            runSpacing: 6,
            children: [
              Text(
                '${latestRecord.totalBandwidthUsedGb.toStringAsFixed(1)} GB',
                style: const TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                  letterSpacing: -0.5,
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: (growth >= 0 ? AppColors.success : AppColors.info).withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: (growth >= 0 ? AppColors.success : AppColors.info).withValues(alpha: 0.3),
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      growth >= 0 ? Icons.trending_up_rounded : Icons.trending_flat_rounded,
                      size: 14,
                      color: growth >= 0 ? AppColors.success : AppColors.info,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      growth >= 0
                          ? '+${growth.toStringAsFixed(1)} GB this week'
                          : 'Stable trend',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: growth >= 0 ? AppColors.success : AppColors.info,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),

          const SizedBox(height: 14),

          // Subtle divider line
          Container(
            height: 1,
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  Colors.transparent,
                  AppColors.cardBorderDark.withValues(alpha: 0.8),
                  Colors.transparent,
                ],
              ),
            ),
          ),

          const SizedBox(height: 14),

          // The Line Chart
          SizedBox(
            height: 200,
            child: LineChart(
              LineChartData(
                gridData: FlGridData(
                  show: true,
                  drawVerticalLine: false,
                  horizontalInterval: yInterval,
                  getDrawingHorizontalLine: (value) => FlLine(
                    color: AppColors.cardBorderDark.withValues(alpha: 0.5),
                    strokeWidth: 1,
                    dashArray: const [5, 5],
                  ),
                ),
                titlesData: FlTitlesData(
                  show: true,
                  rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                  topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                  bottomTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      reservedSize: 34,
                      interval: 1,
                      getTitlesWidget: (value, meta) {
                        final index = value.toInt();
                        if (index >= 0 && index < records.length) {
                          final date = records[index].timestamp;
                          final isToday = index == records.length - 1;

                          if (isToday) {
                            return Padding(
                              padding: const EdgeInsets.only(top: 8.0),
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                                decoration: BoxDecoration(
                                  color: AppColors.primary.withValues(alpha: 0.2),
                                  borderRadius: BorderRadius.circular(6),
                                  border: Border.all(
                                    color: AppColors.primary.withValues(alpha: 0.45),
                                  ),
                                ),
                                child: const Text(
                                  'Today',
                                  style: TextStyle(
                                    color: AppColors.primary,
                                    fontSize: 10,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                            );
                          }

                          return Padding(
                            padding: const EdgeInsets.only(top: 8.0),
                            child: Text(
                              DateFormat('E').format(date),
                              style: const TextStyle(
                                color: AppColors.textSecondary,
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          );
                        }
                        return const SizedBox.shrink();
                      },
                    ),
                  ),
                  leftTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      interval: yInterval,
                      reservedSize: 44,
                      getTitlesWidget: (value, meta) {
                        return Padding(
                          padding: const EdgeInsets.only(right: 6.0),
                          child: Text(
                            '${value.toInt()}G',
                            style: const TextStyle(
                              color: AppColors.textTertiary,
                              fontSize: 10,
                              fontWeight: FontWeight.w600,
                            ),
                            textAlign: TextAlign.right,
                          ),
                        );
                      },
                    ),
                  ),
                ),
                borderData: FlBorderData(show: false),
                minX: 0,
                maxX: (records.length - 1).toDouble(),
                minY: 0,
                maxY: maxY,
                lineTouchData: LineTouchData(
                  handleBuiltInTouches: true,
                  getTouchedSpotIndicator: (LineChartBarData barData, List<int> spotIndexes) {
                    return spotIndexes.map((spotIndex) {
                      return TouchedSpotIndicatorData(
                        FlLine(
                          color: AppColors.neonCyan.withValues(alpha: 0.8),
                          strokeWidth: 1.5,
                          dashArray: const [4, 4],
                        ),
                        FlDotData(
                          getDotPainter: (spot, percent, barData, index) {
                            return FlDotCirclePainter(
                              radius: 6,
                              color: Colors.white,
                              strokeWidth: 3,
                              strokeColor: AppColors.neonCyan,
                            );
                          },
                        ),
                      );
                    }).toList();
                  },
                  touchTooltipData: LineTouchTooltipData(
                    getTooltipColor: (spot) => const Color(0xFF131D33),
                    tooltipBorder: BorderSide(
                      color: AppColors.primary.withValues(alpha: 0.5),
                      width: 1,
                    ),
                    tooltipRoundedRadius: 10,
                    tooltipPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    getTooltipItems: (touchedSpots) {
                      return touchedSpots.map((LineBarSpot touchedSpot) {
                        final index = touchedSpot.x.toInt();
                        final date = index >= 0 && index < records.length
                            ? DateFormat('EEEE, MMM d').format(records[index].timestamp)
                            : '';
                        return LineTooltipItem(
                          '$date\n',
                          const TextStyle(
                            color: AppColors.textSecondary,
                            fontSize: 11,
                            fontWeight: FontWeight.w500,
                          ),
                          children: [
                            TextSpan(
                              text: '${touchedSpot.y.toStringAsFixed(1)} GB',
                              style: const TextStyle(
                                color: AppColors.neonCyan,
                                fontSize: 14,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const TextSpan(
                              text: ' used',
                              style: TextStyle(
                                color: AppColors.textTertiary,
                                fontSize: 11,
                              ),
                            ),
                          ],
                        );
                      }).toList();
                    },
                  ),
                ),
                lineBarsData: [
                  LineChartBarData(
                    spots: spots,
                    isCurved: true,
                    curveSmoothness: 0.38,
                    preventCurveOverShooting: true,
                    isStrokeCapRound: true,
                    barWidth: 3.5,
                    shadow: const Shadow(
                      color: Color(0x6600E5FF),
                      blurRadius: 10,
                      offset: Offset(0, 3),
                    ),
                    gradient: const LinearGradient(
                      colors: [
                        AppColors.neonCyan,
                        AppColors.electricBlue,
                        AppColors.neonPurple,
                      ],
                      stops: [0.0, 0.55, 1.0],
                    ),
                    dotData: FlDotData(
                      show: true,
                      getDotPainter: (spot, percent, barData, index) {
                        final isToday = index == records.length - 1;
                        if (isToday) {
                          return FlDotCirclePainter(
                            radius: 5.5,
                            color: Colors.white,
                            strokeWidth: 3.0,
                            strokeColor: AppColors.neonCyan,
                          );
                        }
                        return FlDotCirclePainter(
                          radius: 3.5,
                          color: AppColors.bgDark,
                          strokeWidth: 2.2,
                          strokeColor: AppColors.neonCyan.withValues(alpha: 0.9),
                        );
                      },
                    ),
                    belowBarData: BarAreaData(
                      show: true,
                      gradient: LinearGradient(
                        colors: [
                          AppColors.neonCyan.withValues(alpha: 0.32),
                          AppColors.electricBlue.withValues(alpha: 0.10),
                          Colors.transparent,
                        ],
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        stops: const [0.0, 0.65, 1.0],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
