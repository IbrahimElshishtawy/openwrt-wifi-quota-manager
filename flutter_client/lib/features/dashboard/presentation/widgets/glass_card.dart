import 'dart:ui';
import 'package:flutter/material.dart';
import '../../../../core/constants/app_colors.dart';

class GlassCard extends StatelessWidget {
  final Widget child;
  final double borderRadius;
  final double blur;
  final double opacity;
  final BoxBorder? border;
  final Gradient? gradient;
  final EdgeInsetsGeometry? padding;
  final EdgeInsetsGeometry? margin;
  final Color? glowColor;
  final double glowRadius;
  final VoidCallback? onTap;

  const GlassCard({
    super.key,
    required this.child,
    this.borderRadius = 22,
    this.blur = 10,
    this.opacity = 0.7,
    this.border,
    this.gradient,
    this.padding,
    this.margin,
    this.glowColor,
    this.glowRadius = 16,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final effectiveBorder = border ??
        Border.all(
          color: glowColor != null
              ? glowColor!.withValues(alpha: 0.35)
              : AppColors.glassBorderSubtle,
          width: 1,
        );

    final effectiveGradient = gradient ??
        LinearGradient(
          colors: [
            const Color(0xFF0F172A).withValues(alpha: opacity),
            const Color(0xFF0A101D).withValues(alpha: opacity * 0.9),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        );

    Widget cardContent = ClipRRect(
      borderRadius: BorderRadius.circular(borderRadius),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: blur, sigmaY: blur),
        child: Container(
          padding: padding ?? const EdgeInsets.all(16),
          decoration: BoxDecoration(
            gradient: effectiveGradient,
            borderRadius: BorderRadius.circular(borderRadius),
            border: effectiveBorder,
            boxShadow: glowColor != null
                ? [
                    BoxShadow(
                      color: glowColor!.withValues(alpha: 0.12),
                      blurRadius: glowRadius,
                      spreadRadius: 0,
                    ),
                  ]
                : null,
          ),
          child: child,
        ),
      ),
    );

    if (margin != null) {
      cardContent = Padding(padding: margin!, child: cardContent);
    }

    if (onTap != null) {
      return InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(borderRadius),
        child: cardContent,
      );
    }

    return cardContent;
  }
}
