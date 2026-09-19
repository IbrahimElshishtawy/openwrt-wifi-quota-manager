import 'package:flutter/material.dart';

enum DeviceType {
  phone,
  tablet,
  laptop,
  desktop,
  tv,
  gameConsole,
  camera,
  router,
  unknown,
}

class DeviceIconResolver {
  DeviceIconResolver._();

  /// Resolves device type based on device name, hostname, or hints
  static DeviceType resolveType(String? name, [String? hostname]) {
    final query = '${name ?? ''} ${hostname ?? ''}'.toLowerCase();

    if (query.contains('tv') ||
        query.contains('webos') ||
        query.contains('roku') ||
        query.contains('firetv') ||
        query.contains('chromecast') ||
        query.contains('bravia')) {
      return DeviceType.tv;
    }

    if (query.contains('ps5') ||
        query.contains('ps4') ||
        query.contains('playstation') ||
        query.contains('xbox') ||
        query.contains('switch') ||
        query.contains('console')) {
      return DeviceType.gameConsole;
    }

    if (query.contains('cam') ||
        query.contains('camera') ||
        query.contains('cctv') ||
        query.contains('doorbell') ||
        query.contains('nvr') ||
        query.contains('ipc')) {
      return DeviceType.camera;
    }

    if (query.contains('macbook') ||
        query.contains('laptop') ||
        query.contains('thinkpad') ||
        query.contains('zenbook') ||
        query.contains('notebook')) {
      return DeviceType.laptop;
    }

    if (query.contains('ipad') ||
        query.contains('tablet') ||
        query.contains('tab')) {
      return DeviceType.tablet;
    }

    if (query.contains('iphone') ||
        query.contains('galaxy') ||
        query.contains('pixel') ||
        query.contains('phone') ||
        query.contains('android') ||
        query.contains('redmi') ||
        query.contains('xiaomi')) {
      return DeviceType.phone;
    }

    if (query.contains('desktop') ||
        query.contains('pc') ||
        query.contains('imac') ||
        query.contains('workstation')) {
      return DeviceType.desktop;
    }

    if (query.contains('router') ||
        query.contains('openwrt') ||
        query.contains('gateway') ||
        query.contains('ap')) {
      return DeviceType.router;
    }

    return DeviceType.unknown;
  }

  /// Returns standard Material icon for the resolved device
  static IconData resolveIcon(String? name, [String? hostname]) {
    final type = resolveType(name, hostname);
    return getIconForType(type);
  }

  /// Returns icon for a specific DeviceType
  static IconData getIconForType(DeviceType type) {
    switch (type) {
      case DeviceType.phone:
        return Icons.phone_iphone_rounded;
      case DeviceType.tablet:
        return Icons.tablet_mac_rounded;
      case DeviceType.laptop:
        return Icons.laptop_mac_rounded;
      case DeviceType.desktop:
        return Icons.desktop_windows_rounded;
      case DeviceType.tv:
        return Icons.tv_rounded;
      case DeviceType.gameConsole:
        return Icons.sports_esports_rounded;
      case DeviceType.camera:
        return Icons.videocam_rounded;
      case DeviceType.router:
        return Icons.router_rounded;
      case DeviceType.unknown:
        return Icons.devices_other_rounded;
    }
  }
}
