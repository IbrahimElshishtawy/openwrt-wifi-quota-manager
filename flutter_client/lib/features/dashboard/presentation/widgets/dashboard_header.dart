import 'package:flutter/material.dart';
import '../../../../core/constants/app_colors.dart';
import '../controllers/dashboard_state.dart';

class DashboardHeader extends StatelessWidget {
  final DashboardConnectionStatus connectionStatus;
  final VoidCallback? onMenuTap;
  final VoidCallback? onStatusTap;

  const DashboardHeader({
    super.key,
    required this.connectionStatus,
    this.onMenuTap,
    this.onStatusTap,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        // Menu Button
        InkWell(
          onTap: onMenuTap,
          borderRadius: BorderRadius.circular(12),
          child: Container(
            width: 42,
            height: 42,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.cardDark.withValues(alpha: 0.8),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: AppColors.cardBorderDark,
                width: 1,
              ),
            ),
            child: const Icon(
              Icons.menu_rounded,
              color: AppColors.textPrimary,
              size: 20,
            ),
          ),
        ),
        const SizedBox(width: 10),

        // Wi-Fi Icon & Title
        const Icon(
          Icons.wifi_rounded,
          color: AppColors.neonCyan,
          size: 26,
        ),
        const SizedBox(width: 8),

        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: const [
              Text(
                'Wi-Fi Quota Manager',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                  letterSpacing: -0.4,
                ),
              ),
              Text(
                'OpenWrt Router Control',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w500,
                  color: AppColors.textTertiary,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 8),

        // Status Pill
        _buildStatusPill(),
      ],
    );
  }

  Widget _buildStatusPill() {
    final Color color;
    final String title;
    final String subtitle;

    switch (connectionStatus) {
      case DashboardConnectionStatus.online:
        color = AppColors.neonGreen;
        title = 'Online';
        subtitle = 'Connected to OpenWrt';
        break;
      case DashboardConnectionStatus.cached:
        color = AppColors.warning;
        title = 'Cached';
        subtitle = 'Offline Cache';
        break;
      case DashboardConnectionStatus.demo:
        color = AppColors.neonCyan;
        title = 'Demo';
        subtitle = 'Simulated Router';
        break;
      case DashboardConnectionStatus.connecting:
        color = AppColors.neonBlue;
        title = 'Connecting';
        subtitle = 'Searching LAN...';
        break;
      case DashboardConnectionStatus.offline:
        color = AppColors.warning;
        title = 'Offline';
        subtitle = 'No Router Link';
        break;
      case DashboardConnectionStatus.error:
        color = AppColors.danger;
        title = 'Error';
        subtitle = 'Check Connection';
        break;
    }

    return InkWell(
      onTap: onStatusTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: color.withValues(alpha: 0.35),
            width: 1,
          ),
          boxShadow: [
            BoxShadow(
              color: color.withValues(alpha: 0.08),
              blurRadius: 10,
              spreadRadius: 0,
            ),
          ],
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(
                color: color,
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(
                    color: color.withValues(alpha: 0.6),
                    blurRadius: 6,
                    spreadRadius: 1,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: color,
                    height: 1.1,
                  ),
                ),
                Text(
                  subtitle,
                  style: TextStyle(
                    fontSize: 9,
                    fontWeight: FontWeight.w500,
                    color: color.withValues(alpha: 0.8),
                    height: 1.1,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
