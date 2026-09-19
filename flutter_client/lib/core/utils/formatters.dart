import 'package:intl/intl.dart';

class Formatters {
  Formatters._();

  static String gigabytes(double value, {int decimals = 1}) {
    return '${value.toStringAsFixed(decimals)} GB';
  }

  static String bandwidth(double gb) {
    if (gb >= 1.0) {
      return '${gb.toStringAsFixed(2)} GB';
    } else {
      final mb = gb * 1024;
      return '${mb.toStringAsFixed(1)} MB';
    }
  }

  static String percentage(double used, double total) {
    if (total <= 0) return '0%';
    final pct = (used / total) * 100;
    return '${pct.clamp(0, 100).toStringAsFixed(1)}%';
  }

  static double percentageRatio(double used, double total) {
    if (total <= 0) return 0.0;
    return (used / total).clamp(0.0, 1.0);
  }

  static String normalizeMac(String mac) {
    return mac.trim().toUpperCase();
  }

  static String timeAgo(DateTime dateTime) {
    final diff = DateTime.now().difference(dateTime);
    if (diff.inSeconds < 30) {
      return 'Just now';
    } else if (diff.inMinutes < 1) {
      return '${diff.inSeconds}s ago';
    } else if (diff.inHours < 1) {
      return '${diff.inMinutes}m ago';
    } else if (diff.inDays < 1) {
      return '${diff.inHours}h ago';
    } else {
      return DateFormat('MMM d, HH:mm').format(dateTime);
    }
  }
}
