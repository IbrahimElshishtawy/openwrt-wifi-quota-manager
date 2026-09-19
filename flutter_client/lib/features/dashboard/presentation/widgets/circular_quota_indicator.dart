import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/utils/formatters.dart';

class CircularQuotaIndicator extends StatelessWidget {
  final double usedGb;
  final double totalGb;
  final double percentage;
  final double size;

  const CircularQuotaIndicator({
    super.key,
    required this.usedGb,
    required this.totalGb,
    required this.percentage,
    this.size = 145,
  });

  @override
  Widget build(BuildContext context) {
    final ratio = (percentage / 100.0).clamp(0.0, 1.0);

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          width: size,
          height: size,
          child: TweenAnimationBuilder<double>(
            tween: Tween<double>(begin: 0.0, end: ratio),
            duration: const Duration(milliseconds: 1000),
            curve: Curves.easeOutCubic,
            builder: (context, animatedRatio, child) {
              final animatedPercent = (animatedRatio * 100).clamp(0, 100);
              return Stack(
                alignment: Alignment.center,
                children: [
                  CustomPaint(
                    size: Size(size, size),
                    painter: _CircularGaugePainter(
                      progress: animatedRatio,
                      strokeWidth: 12,
                    ),
                  ),
                  Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        '${animatedPercent.toInt()}%',
                        style: const TextStyle(
                          fontSize: 28,
                          fontWeight: FontWeight.w800,
                          color: AppColors.textPrimary,
                          letterSpacing: -0.8,
                          height: 1.1,
                        ),
                      ),
                      const SizedBox(height: 2),
                      const Text(
                        'Used',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textSecondary,
                          letterSpacing: 0.2,
                        ),
                      ),
                    ],
                  ),
                ],
              );
            },
          ),
        ),
        const SizedBox(height: 12),
        RichText(
          text: TextSpan(
            children: [
              TextSpan(
                text: '${Formatters.gigabytes(usedGb, decimals: usedGb % 1 == 0 ? 0 : 1)} ',
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
              const TextSpan(
                text: '/ ',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                  color: AppColors.textTertiary,
                ),
              ),
              TextSpan(
                text: Formatters.gigabytes(totalGb, decimals: totalGb % 1 == 0 ? 0 : 1),
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textSecondary,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _CircularGaugePainter extends CustomPainter {
  final double progress;
  final double strokeWidth;

  _CircularGaugePainter({
    required this.progress,
    required this.strokeWidth,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = (size.width - strokeWidth) / 2;

    // 1. Background Track
    final trackPaint = Paint()
      ..color = const Color(0xFF131D31)
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.round;

    canvas.drawCircle(center, radius, trackPaint);

    if (progress <= 0.001) return;

    final sweepAngle = 2 * math.pi * progress;
    const startAngle = -math.pi / 2;
    final rect = Rect.fromCircle(center: center, radius: radius);

    // 2. Glow Shadow Behind Active Arc
    final glowPaint = Paint()
      ..color = AppColors.neonCyan.withValues(alpha: 0.35)
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth + 4
      ..strokeCap = StrokeCap.round
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 6);

    canvas.drawArc(rect, startAngle, sweepAngle, false, glowPaint);

    // 3. Vibrant Gradient Arc
    final gradient = SweepGradient(
      startAngle: 0.0,
      endAngle: 2 * math.pi,
      colors: const [
        Color(0xFF10B981), // Neon Green
        Color(0xFF00E5FF), // Neon Cyan
        Color(0xFF3B82F6), // Electric Blue
        Color(0xFF10B981), // Loop back
      ],
      transform: const GradientRotation(startAngle),
    );

    final progressPaint = Paint()
      ..shader = gradient.createShader(rect)
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.round;

    canvas.drawArc(rect, startAngle, sweepAngle, false, progressPaint);
  }

  @override
  bool shouldRepaint(covariant _CircularGaugePainter oldDelegate) {
    return oldDelegate.progress != progress ||
        oldDelegate.strokeWidth != strokeWidth;
  }
}
