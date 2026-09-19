import 'package:flutter/material.dart';

class AppColors {
  AppColors._();

  // Primary brand colors
  static const Color primary = Color(0xFF00D2FF);
  static const Color primaryDark = Color(0xFF0090B3);
  static const Color accent = Color(0xFF4361EE);

  // Status & indicators
  static const Color success = Color(0xFF10B981);
  static const Color warning = Color(0xFFF59E0B);
  static const Color danger = Color(0xFFEF4444);
  static const Color info = Color(0xFF38BDF8);

  // Dark theme surface hierarchy
  static const Color bgDark = Color(0xFF0A0E17);
  static const Color cardDark = Color(0xFF121927);
  static const Color cardBorderDark = Color(0xFF1E2A40);
  static const Color surfaceDark = Color(0xFF192235);
  static const Color surfaceElevated = Color(0xFF23304B);

  // Text
  static const Color textPrimary = Color(0xFFF8FAFC);
  static const Color textSecondary = Color(0xFF94A3B8);
  static const Color textTertiary = Color(0xFF64748B);

  // Gradients
  static const LinearGradient primaryGradient = LinearGradient(
    colors: [Color(0xFF00D2FF), Color(0xFF3A7BD5)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const LinearGradient quotaGaugeGradient = LinearGradient(
    colors: [Color(0xFF10B981), Color(0xFF00D2FF), Color(0xFFF59E0B), Color(0xFFEF4444)],
    stops: [0.0, 0.5, 0.8, 1.0],
  );

  static const LinearGradient cardGradient = LinearGradient(
    colors: [Color(0xFF151D2E), Color(0xFF111726)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const LinearGradient blockedCardGradient = LinearGradient(
    colors: [Color(0x33EF4444), Color(0xFF151D2E)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );
}
