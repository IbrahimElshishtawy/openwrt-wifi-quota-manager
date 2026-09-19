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

  static String formatBytes(int bytes) {
    if (bytes < 1024) {
      return '$bytes B';
    } else if (bytes < 1024 * 1024) {
      final kb = bytes / 1024;
      return '${kb.toStringAsFixed(1)} KB';
    } else if (bytes < 1024 * 1024 * 1024) {
      final mb = bytes / (1024 * 1024);
      return '${mb.toStringAsFixed(2)} MB';
    } else {
      final gb = bytes / (1024 * 1024 * 1024);
      return '${gb.toStringAsFixed(2)} GB';
    }
  }

  static String formatUptime(int uptimeSeconds) {
    if (uptimeSeconds <= 0) return '0m';
    final days = uptimeSeconds ~/ 86400;
    final hours = (uptimeSeconds % 86400) ~/ 3600;
    final minutes = (uptimeSeconds % 3600) ~/ 60;

    if (days > 0) {
      return '${days}d ${hours}h ${minutes}m';
    } else if (hours > 0) {
      return '${hours}h ${minutes}m';
    } else {
      return '${minutes}m';
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
