import 'package:flutter/material.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/utils/device_icon_resolver.dart';
import '../../../../core/utils/formatters.dart';
import '../../domain/models/quota_report.dart';
import 'glass_card.dart';

class TopConsumersSection extends StatelessWidget {
  final List<TopConsumer> consumers;
  final double totalPackageGb;
  final VoidCallback? onViewAllTap;

  const TopConsumersSection({
    super.key,
    required this.consumers,
    required this.totalPackageGb,
    this.onViewAllTap,
  });

  static const List<LinearGradient> _rowGradients = [
    LinearGradient(colors: [Color(0xFFA855F7), Color(0xFF6366F1)]), // Purple
    LinearGradient(colors: [Color(0xFF00E5FF), Color(0xFF10B981)]), // Cyan/Teal
    LinearGradient(colors: [Color(0xFFC084FC), Color(0xFFA855F7)]), // Magenta
    LinearGradient(colors: [Color(0xFFFB923C), Color(0xFFF59E0B)]), // Orange
    LinearGradient(colors: [Color(0xFF38BDF8), Color(0xFF0284C7)]), // Sky Blue
  ];

  static const List<Color> _accentColors = [
    Color(0xFFA855F7),
    Color(0xFF00E5FF),
    Color(0xFFC084FC),
    Color(0xFFFB923C),
    Color(0xFF38BDF8),
  ];

  @override
  Widget build(BuildContext context) {
    if (consumers.isEmpty) {
      return const SizedBox.shrink();
    }

    // Sort by totalUsage DESC and take top 5
    final sortedConsumers = List<TopConsumer>.from(consumers)
      ..sort((a, b) => b.usageGb.compareTo(a.usageGb));
    final displayConsumers = sortedConsumers.take(5).toList();

    final maxUsage = displayConsumers.first.usageGb > 0
        ? displayConsumers.first.usageGb
        : 1.0;

    return GlassCard(
      glowColor: AppColors.neonPurple,
      glowRadius: 18,
      border: Border.all(
        color: AppColors.neonPurple.withValues(alpha: 0.25),
        width: 1,
      ),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Section Header
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Row(
                  children: const [
                    Text(
                      '🔥',
                      style: TextStyle(fontSize: 16),
                    ),
                    SizedBox(width: 8),
                    Flexible(
                      child: Text(
                        'Top Bandwidth Consumers',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: AppColors.textPrimary,
                          fontWeight: FontWeight.w700,
                          fontSize: 15,
                          letterSpacing: -0.3,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              InkWell(
                onTap: onViewAllTap,
                borderRadius: BorderRadius.circular(8),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: const [
                      Text(
                        'View All',
                        style: TextStyle(
                          color: AppColors.neonCyan,
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      SizedBox(width: 2),
                      Icon(
                        Icons.arrow_forward_rounded,
                        size: 14,
                        color: AppColors.neonCyan,
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),

          // Consumer rows
          ListView.separated(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: displayConsumers.length,
            separatorBuilder: (context, index) => const SizedBox(height: 14),
            itemBuilder: (context, index) {
              final consumer = displayConsumers[index];
              final gradient = _rowGradients[index % _rowGradients.length];
              final accentColor = _accentColors[index % _accentColors.length];
              final icon = DeviceIconResolver.resolveIcon(consumer.name);

              // Calculate percentage of total quota, or fallback to relative ratio
              final pct = consumer.percentage ??
                  (totalPackageGb > 0
                      ? (consumer.usageGb / totalPackageGb) * 100
                      : 0.0);

              final barRatio = (consumer.usageGb / maxUsage).clamp(0.05, 1.0);

              return Row(
                children: [
                  // Device Icon in Rounded Glass Container
                  Container(
                    width: 38,
                    height: 38,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: AppColors.surfaceDark.withValues(alpha: 0.8),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: accentColor.withValues(alpha: 0.25),
                        width: 0.8,
                      ),
                    ),
                    child: Icon(
                      icon,
                      color: accentColor,
                      size: 20,
                    ),
                  ),
                  const SizedBox(width: 12),

                  // Name, IP & Progress Bar
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          consumer.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: AppColors.textPrimary,
                            fontWeight: FontWeight.w600,
                            fontSize: 13,
                          ),
                        ),
                        const SizedBox(height: 1),
                        Text(
                          consumer.ip,
                          style: const TextStyle(
                            color: AppColors.textTertiary,
                            fontSize: 11,
                          ),
                        ),
                        const SizedBox(height: 6),
                        // Custom Gradient Progress Bar
                        LayoutBuilder(
                          builder: (context, constraints) {
                            final barWidth = constraints.maxWidth * barRatio;
                            return Container(
                              height: 6,
                              width: constraints.maxWidth,
                              decoration: BoxDecoration(
                                color: const Color(0xFF16233B),
                                borderRadius: BorderRadius.circular(3),
                              ),
                              child: Align(
                                alignment: Alignment.centerLeft,
                                child: Container(
                                  width: barWidth,
                                  height: 6,
                                  decoration: BoxDecoration(
                                    gradient: gradient,
                                    borderRadius: BorderRadius.circular(3),
                                  ),
                                ),
                              ),
                            );
                          },
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),

                  // Usage Text & Percentage Badge
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        Formatters.gigabytes(consumer.usageGb),
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontWeight: FontWeight.w700,
                          fontSize: 12,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 6, vertical: 3),
                        decoration: BoxDecoration(
                          color: accentColor.withValues(alpha: 0.16),
                          borderRadius: BorderRadius.circular(6),
                          border: Border.all(
                            color: accentColor.withValues(alpha: 0.35),
                            width: 0.8,
                          ),
                        ),
                        child: Text(
                          '${pct.toInt()}%',
                          style: TextStyle(
                            color: accentColor,
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}
