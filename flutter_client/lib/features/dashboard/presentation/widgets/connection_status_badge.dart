import 'package:flutter/material.dart';
import '../../../../core/constants/app_colors.dart';

class ConnectionStatusBadge extends StatelessWidget {
  final bool isDemoMode;
  final bool isOffline;
  final String? routerIp;

  const ConnectionStatusBadge({
    super.key,
    required this.isDemoMode,
    required this.isOffline,
    this.routerIp,
  });

  @override
  Widget build(BuildContext context) {
    final Color badgeColor;
    final String label;
    final IconData icon;

    if (isDemoMode) {
      badgeColor = AppColors.info;
      label = 'Simulator (Demo)';
      icon = Icons.science_outlined;
    } else if (isOffline) {
      badgeColor = AppColors.warning;
      label = 'Cached (Offline)';
      icon = Icons.cloud_off_outlined;
    } else {
      badgeColor = AppColors.success;
      label = routerIp != null ? 'OpenWrt ($routerIp)' : 'Online';
      icon = Icons.router_outlined;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: badgeColor.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: badgeColor.withValues(alpha: 0.3), width: 1),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: badgeColor),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              color: badgeColor,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}
