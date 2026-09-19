import 'package:flutter/material.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/utils/formatters.dart';
import '../../domain/models/device_model.dart';
import 'edit_quota_modal.dart';

class DeviceCard extends StatelessWidget {
  final DeviceModel device;
  final ValueChanged<bool> onToggleBlock;
  final Future<void> Function(double newQuota, bool enabled) onSaveQuota;

  const DeviceCard({
    super.key,
    required this.device,
    required this.onToggleBlock,
    required this.onSaveQuota,
  });

  IconData _getDeviceIcon(String name, String hostname) {
    final combined = '$name $hostname'.toLowerCase();
    if (combined.contains('phone') || combined.contains('iphone') || combined.contains('android')) {
      return Icons.phone_iphone;
    } else if (combined.contains('tv') || combined.contains('webos') || combined.contains('screen')) {
      return Icons.tv;
    } else if (combined.contains('macbook') || combined.contains('laptop') || combined.contains('thinkpad') || combined.contains('pc')) {
      return Icons.laptop_mac;
    } else if (combined.contains('ps5') || combined.contains('playstation') || combined.contains('xbox') || combined.contains('switch')) {
      return Icons.sports_esports;
    } else if (combined.contains('cam') || combined.contains('camera')) {
      return Icons.videocam_outlined;
    }
    return Icons.devices;
  }

  @override
  Widget build(BuildContext context) {
    final isBlocked = device.isBlocked || !device.enabled;
    final ratio = device.usageRatio;
    final icon = _getDeviceIcon(device.name, device.hostname);

    final Color statusColor;
    if (isBlocked) {
      statusColor = AppColors.danger;
    } else if (device.isNearLimit) {
      statusColor = AppColors.warning;
    } else {
      statusColor = AppColors.success;
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.cardDark,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: isBlocked ? AppColors.danger.withValues(alpha: 0.3) : AppColors.cardBorderDark,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header Row: Icon, Name, IP, MAC, Status Pill & Toggle
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: isBlocked
                      ? AppColors.danger.withValues(alpha: 0.12)
                      : AppColors.primary.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  icon,
                  color: isBlocked ? AppColors.danger : AppColors.primary,
                  size: 22,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      device.name,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Row(
                      children: [
                        Text(
                          device.ip,
                          style: const TextStyle(
                            fontSize: 12,
                            color: AppColors.textSecondary,
                            fontFamily: 'monospace',
                          ),
                        ),
                        const Text(' • ', style: TextStyle(color: AppColors.textTertiary)),
                        Expanded(
                          child: Text(
                            device.mac,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 11,
                              color: AppColors.textTertiary,
                              fontFamily: 'monospace',
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),

              // Block / Allow Switch
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Switch(
                    value: !isBlocked,
                    activeThumbColor: Colors.white,
                    activeTrackColor: AppColors.success,
                    inactiveThumbColor: AppColors.textSecondary,
                    inactiveTrackColor: AppColors.surfaceDark,
                    onChanged: (allowed) {
                      onToggleBlock(!allowed);
                    },
                  ),
                  Text(
                    isBlocked ? 'Blocked' : 'Allowed',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      color: isBlocked ? AppColors.danger : AppColors.success,
                    ),
                  ),
                ],
              ),
            ],
          ),

          const SizedBox(height: 14),

          // Usage & Quota Progress Bar
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Used: ${Formatters.gigabytes(device.usageGb)} / ${Formatters.gigabytes(device.quotaGb)}',
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textSecondary,
                ),
              ),
              Text(
                '${(ratio * 100).toStringAsFixed(1)}%',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: statusColor,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: LinearProgressIndicator(
              value: ratio,
              minHeight: 8,
              backgroundColor: AppColors.surfaceDark,
              valueColor: AlwaysStoppedAnimation<Color>(statusColor),
            ),
          ),

          const SizedBox(height: 14),

          // Action Buttons: Edit Quota
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Remaining: ${Formatters.gigabytes(device.remainingGb)}',
                style: TextStyle(
                  fontSize: 11,
                  color: device.remainingGb > 0 ? AppColors.textTertiary : AppColors.danger,
                  fontWeight: FontWeight.w500,
                ),
              ),
              OutlinedButton.icon(
                onPressed: () {
                  showModalBottomSheet(
                    context: context,
                    isScrollControlled: true,
                    builder: (_) => EditQuotaModal(
                      device: device,
                      onSave: onSaveQuota,
                    ),
                  );
                },
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  side: const BorderSide(color: AppColors.cardBorderDark),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
                icon: const Icon(Icons.edit, size: 14, color: AppColors.primary),
                label: const Text(
                  'Adjust Quota',
                  style: TextStyle(fontSize: 12, color: AppColors.primary),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
