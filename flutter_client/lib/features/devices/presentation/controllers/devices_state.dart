import '../../domain/models/device_model.dart';

enum DeviceFilter { all, active, blocked, nearQuota }

class DevicesState {
  final List<DeviceModel> devices;
  final bool isLoading;
  final String? errorMessage;
  final String searchQuery;
  final DeviceFilter filter;
  final bool isOffline;

  const DevicesState({
    this.devices = const [],
    this.isLoading = false,
    this.errorMessage,
    this.searchQuery = '',
    this.filter = DeviceFilter.all,
    this.isOffline = false,
  });

  List<DeviceModel> get filteredDevices {
    return devices.where((d) {
      // 1. Filter by category
      switch (filter) {
        case DeviceFilter.all:
          break;
        case DeviceFilter.active:
          if (!d.enabled || d.isBlocked) return false;
          break;
        case DeviceFilter.blocked:
          if (!d.isBlocked && d.enabled) return false;
          break;
        case DeviceFilter.nearQuota:
          if (d.usageRatio < 0.85) return false;
          break;
      }

      // 2. Filter by search query (name, IP, MAC, hostname)
      if (searchQuery.isNotEmpty) {
        final q = searchQuery.toLowerCase();
        final matchName = d.name.toLowerCase().contains(q);
        final matchIp = d.ip.toLowerCase().contains(q);
        final matchMac = d.mac.toLowerCase().contains(q);
        final matchHost = d.hostname.toLowerCase().contains(q);
        return matchName || matchIp || matchMac || matchHost;
      }

      return true;
    }).toList();
  }

  DevicesState copyWith({
    List<DeviceModel>? devices,
    bool? isLoading,
    String? errorMessage,
    String? searchQuery,
    DeviceFilter? filter,
    bool? isOffline,
  }) {
    return DevicesState(
      devices: devices ?? this.devices,
      isLoading: isLoading ?? this.isLoading,
      errorMessage: errorMessage ?? this.errorMessage,
      searchQuery: searchQuery ?? this.searchQuery,
      filter: filter ?? this.filter,
      isOffline: isOffline ?? this.isOffline,
    );
  }
}
