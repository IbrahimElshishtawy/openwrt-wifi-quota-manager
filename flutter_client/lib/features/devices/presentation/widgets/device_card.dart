import 'package:flutter/material.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/network/router/router_capability.dart';
import '../../../../core/utils/formatters.dart';
import '../../domain/models/device_model.dart';
import 'edit_quota_modal.dart';

class DeviceCard extends StatelessWidget {
  final DeviceModel device;
  final ValueChanged<bool> onToggleBlock;
  final Future<void> Function(double newQuota, bool enabled) onSaveQuota;
  final RouterCapabilities? capabilities;

  const DeviceCard({
    super.key,
    required this.device,
    required this.onToggleBlock,
    required this.onSaveQuota,
    this.capabilities,
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
    final caps = capabilities ?? RouterCapabilities.openwrt();
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

              // Block / Allow Switch (Only if router supports block)
              if (caps.block)
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
                )
              else
                Tooltip(
                  message: caps.getReason('block'),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceDark,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: AppColors.cardBorderDark),
                    ),
                    child: const Text(
                      'Block N/A',
                      style: TextStyle(fontSize: 10, color: AppColors.textTertiary),
                    ),
                  ),
                ),
            ],
          ),

          const SizedBox(height: 14),

          // Usage & Quota Progress Bar (Only if usage capability exists)
          if (caps.usage) ...[
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
          ] else ...[
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: AppColors.surfaceDark,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: [
                  const Icon(Icons.info_outline, size: 14, color: AppColors.textTertiary),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      caps.getReason('usage'),
                      style: const TextStyle(fontSize: 11, color: AppColors.textTertiary),
                    ),
                  ),
                ],
              ),
            ),
          ],

          const SizedBox(height: 14),

          // Action Buttons: Edit Quota (Only if quota capability exists)
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                caps.quota
                    ? 'Remaining: ${Formatters.gigabytes(device.remainingGb)}'
                    : 'Quota: Unsupported',
                style: TextStyle(
                  fontSize: 11,
                  color: caps.quota && device.remainingGb > 0
                      ? AppColors.textTertiary
                      : AppColors.warning,
                  fontWeight: FontWeight.w500,
                ),
              ),
              if (caps.quota)
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
                    'Edit Quota',
                    style: TextStyle(fontSize: 12, color: AppColors.primary),
                  ),
                )
              else
                Tooltip(
                  message: caps.getReason('quota'),
                  child: const Text(
                    'Quota N/A',
                    style: TextStyle(fontSize: 11, color: AppColors.textTertiary),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
