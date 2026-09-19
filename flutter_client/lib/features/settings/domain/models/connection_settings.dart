class ConnectionSettings {
  final String routerIp;
  final int routerPort;
  final String protocol;
  final String username;
  final String password;
  final String apiKey;
  final bool isDemoMode;
  final int refreshInterval;
  final bool isDarkMode;

  const ConnectionSettings({
    required this.routerIp,
    required this.routerPort,
    this.protocol = 'http',
    this.username = 'root',
    this.password = '',
    required this.apiKey,
    required this.isDemoMode,
    required this.refreshInterval,
    required this.isDarkMode,
  });

  ConnectionSettings copyWith({
    String? routerIp,
    int? routerPort,
    String? protocol,
    String? username,
    String? password,
    String? apiKey,
    bool? isDemoMode,
    int? refreshInterval,
    bool? isDarkMode,
  }) {
    return ConnectionSettings(
      routerIp: routerIp ?? this.routerIp,
      routerPort: routerPort ?? this.routerPort,
      protocol: protocol ?? this.protocol,
      username: username ?? this.username,
      password: password ?? this.password,
      apiKey: apiKey ?? this.apiKey,
      isDemoMode: isDemoMode ?? this.isDemoMode,
      refreshInterval: refreshInterval ?? this.refreshInterval,
      isDarkMode: isDarkMode ?? this.isDarkMode,
    );
  }
}
