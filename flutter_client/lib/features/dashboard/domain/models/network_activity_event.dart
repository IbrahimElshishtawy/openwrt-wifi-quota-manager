import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../../core/constants/app_colors.dart';

enum ActivityEventType {
  unblocked,
  quotaUpdated,
  blocked,
  connected,
}

class NetworkActivityEvent {
  final String id;
  final String title;
  final String deviceDescription;
  final DateTime timestamp;
  final ActivityEventType type;

  const NetworkActivityEvent({
    required this.id,
    required this.title,
    required this.deviceDescription,
    required this.timestamp,
    required this.type,
  });

  Color get indicatorColor {
    switch (type) {
      case ActivityEventType.unblocked:
        return AppColors.success;
      case ActivityEventType.quotaUpdated:
        return AppColors.neonCyan;
      case ActivityEventType.blocked:
        return AppColors.danger;
      case ActivityEventType.connected:
        return AppColors.neonGreen;
    }
  }

  IconData get iconData {
    switch (type) {
      case ActivityEventType.unblocked:
        return Icons.lock_open_rounded;
      case ActivityEventType.quotaUpdated:
        return Icons.data_saver_on_rounded;
      case ActivityEventType.blocked:
        return Icons.block_rounded;
      case ActivityEventType.connected:
        return Icons.wifi_tethering_rounded;
    }
  }

  String get formattedTime {
    return DateFormat('h:mm a').format(timestamp);
  }

  factory NetworkActivityEvent.fromJson(Map<String, dynamic> json) {
    ActivityEventType parseType(String? val) {
      switch (val) {
        case 'unblocked':
          return ActivityEventType.unblocked;
        case 'quotaUpdated':
          return ActivityEventType.quotaUpdated;
        case 'blocked':
          return ActivityEventType.blocked;
        case 'connected':
        default:
          return ActivityEventType.connected;
      }
    }

    return NetworkActivityEvent(
      id: json['id'] as String? ?? UniqueKey().toString(),
      title: json['title'] as String? ?? 'Network Event',
      deviceDescription: json['device_description'] as String? ?? '',
      timestamp: json['timestamp'] != null
          ? DateTime.tryParse(json['timestamp'] as String) ?? DateTime.now()
          : DateTime.now(),
      type: parseType(json['type'] as String?),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'title': title,
      'device_description': deviceDescription,
      'timestamp': timestamp.toIso8601String(),
      'type': type.name,
    };
  }
}
