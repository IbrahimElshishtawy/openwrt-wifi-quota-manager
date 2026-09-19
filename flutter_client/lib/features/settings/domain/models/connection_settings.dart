class ConnectionSettings {
  final String routerIp;
  final int routerPort;
  final String apiKey;
  final bool isDemoMode;
  final int refreshInterval;
  final bool isDarkMode;

  const ConnectionSettings({
    required this.routerIp,
    required this.routerPort,
    required this.apiKey,
    required this.isDemoMode,
    required this.refreshInterval,
    required this.isDarkMode,
  });

  ConnectionSettings copyWith({
    String? routerIp,
    int? routerPort,
    String? apiKey,
    bool? isDemoMode,
    int? refreshInterval,
    bool? isDarkMode,
  }) {
    return ConnectionSettings(
      routerIp: routerIp ?? this.routerIp,
      routerPort: routerPort ?? this.routerPort,
      apiKey: apiKey ?? this.apiKey,
      isDemoMode: isDemoMode ?? this.isDemoMode,
      refreshInterval: refreshInterval ?? this.refreshInterval,
      isDarkMode: isDarkMode ?? this.isDarkMode,
    );
  }
}
