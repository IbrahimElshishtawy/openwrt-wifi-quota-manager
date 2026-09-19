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
  static const Color bgDark = Color(0xFF070B13);
  static const Color cardDark = Color(0xFF0F172A);
  static const Color cardBorderDark = Color(0xFF1E2A40);
  static const Color surfaceDark = Color(0xFF141F32);
  static const Color surfaceElevated = Color(0xFF1E2C47);

  // Glassmorphic surfaces
  static const Color glassSurface = Color(0x990F172A);
  static const Color glassSurfaceLight = Color(0xB3141F35);
  static const Color glassBorder = Color(0x3338BDF8);
  static const Color glassBorderSubtle = Color(0x26334155);

  // Neon & Vivid Accents
  static const Color neonCyan = Color(0xFF00E5FF);
  static const Color neonGreen = Color(0xFF10B981);
  static const Color neonPurple = Color(0xFFA855F7);
  static const Color neonBlue = Color(0xFF3B82F6);
  static const Color neonOrange = Color(0xFFFF9800);
  static const Color neonPink = Color(0xFFF43F5E);

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

  static const LinearGradient gaugeGradient = LinearGradient(
    colors: [Color(0xFF10B981), Color(0xFF00E5FF), Color(0xFF3B82F6)],
    stops: [0.0, 0.5, 1.0],
  );

  static const LinearGradient purpleGradient = LinearGradient(
    colors: [Color(0xFFA855F7), Color(0xFF6366F1)],
    begin: Alignment.centerLeft,
    end: Alignment.centerRight,
  );

  static const LinearGradient cyanGradient = LinearGradient(
    colors: [Color(0xFF00E5FF), Color(0xFF10B981)],
    begin: Alignment.centerLeft,
    end: Alignment.centerRight,
  );

  static const LinearGradient orangeGradient = LinearGradient(
    colors: [Color(0xFFFB923C), Color(0xFFF59E0B)],
    begin: Alignment.centerLeft,
    end: Alignment.centerRight,
  );

  static const LinearGradient quotaGaugeGradient = LinearGradient(
    colors: [Color(0xFF10B981), Color(0xFF00D2FF), Color(0xFFF59E0B), Color(0xFFEF4444)],
    stops: [0.0, 0.5, 0.8, 1.0],
  );

  static const LinearGradient cardGradient = LinearGradient(
    colors: [Color(0xFF121B2D), Color(0xFF0B111F)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const LinearGradient glassCardGradient = LinearGradient(
    colors: [Color(0xCC0F192E), Color(0x990A1020)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const LinearGradient blockedCardGradient = LinearGradient(
    colors: [Color(0x33EF4444), Color(0xFF151D2E)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );
}
