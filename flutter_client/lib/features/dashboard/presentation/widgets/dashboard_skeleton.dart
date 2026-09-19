import 'package:flutter/material.dart';
import '../../../../core/constants/app_colors.dart';
import 'glass_card.dart';

class DashboardSkeleton extends StatelessWidget {
  const DashboardSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Quota Card Skeleton
        GlassCard(
          padding: const EdgeInsets.all(18),
          child: Row(
            children: [
              Container(
                width: 130,
                height: 130,
                decoration: const BoxDecoration(
                  color: Color(0xFF141F35),
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildBar(width: 100, height: 16),
                    const SizedBox(height: 14),
                    _buildBar(width: double.infinity, height: 26),
                    const SizedBox(height: 10),
                    _buildBar(width: double.infinity, height: 26),
                    const SizedBox(height: 10),
                    _buildBar(width: 120, height: 26),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),

        // 4 Metrics Cards Skeleton
        Row(
          children: List.generate(4, (index) {
            return Expanded(
              child: Padding(
                padding: EdgeInsets.only(
                  right: index < 3 ? 8.0 : 0.0,
                ),
                child: GlassCard(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        width: 26,
                        height: 26,
                        decoration: const BoxDecoration(
                          color: Color(0xFF141F35),
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(height: 10),
                      _buildBar(width: 32, height: 18),
                      const SizedBox(height: 6),
                      _buildBar(width: 50, height: 10),
                      const SizedBox(height: 4),
                      _buildBar(width: 38, height: 9),
                    ],
                  ),
                ),
              ),
            );
          }),
        ),
        const SizedBox(height: 16),

        // Top Consumers Skeleton
        GlassCard(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildBar(width: 180, height: 16),
              const SizedBox(height: 16),
              ...List.generate(3, (index) {
                return Padding(
                  padding: const EdgeInsets.only(bottom: 12.0),
                  child: Row(
                    children: [
                      Container(
                        width: 36,
                        height: 36,
                        decoration: BoxDecoration(
                          color: const Color(0xFF141F35),
                          borderRadius: BorderRadius.circular(10),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _buildBar(width: 110, height: 12),
                            const SizedBox(height: 6),
                            _buildBar(width: double.infinity, height: 6),
                          ],
                        ),
                      ),
                    ],
                  ),
                );
              }),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // Activity Skeleton
        GlassCard(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildBar(width: 140, height: 16),
              const SizedBox(height: 14),
              _buildBar(width: double.infinity, height: 28),
              const SizedBox(height: 8),
              _buildBar(width: double.infinity, height: 28),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildBar({required double width, required double height}) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: AppColors.surfaceDark.withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(4),
      ),
    );
  }
}
