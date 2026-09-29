enum AppEnvironment {
  development,
  production,
}

class AppConfig {
  final AppEnvironment environment;
  final String defaultHost;
  final int defaultPort;
  final String defaultProtocol;
  final Duration connectTimeout;
  final Duration receiveTimeout;
  final Duration sendTimeout;
  final Duration defaultPollingInterval;
  final Duration minPollingInterval;
  final Duration maxPollingInterval;

  const AppConfig({
    required this.environment,
    required this.defaultHost,
    required this.defaultPort,
    this.defaultProtocol = 'http',
    this.connectTimeout = const Duration(seconds: 5),
    this.receiveTimeout = const Duration(seconds: 5),
    this.sendTimeout = const Duration(seconds: 5),
    this.defaultPollingInterval = const Duration(seconds: 5),
    this.minPollingInterval = const Duration(seconds: 5),
    this.maxPollingInterval = const Duration(seconds: 30),
  });

  bool get isProduction => environment == AppEnvironment.production;
  bool get isDevelopment => environment == AppEnvironment.development;

  static const AppConfig development = AppConfig(
    environment: AppEnvironment.development,
    defaultHost: '127.0.0.1',
    defaultPort: 3050,
    defaultProtocol: 'http',
    connectTimeout: Duration(seconds: 5),
    receiveTimeout: Duration(seconds: 5),
    sendTimeout: Duration(seconds: 5),
    defaultPollingInterval: Duration(seconds: 5),
  );

  static const AppConfig production = AppConfig(
    environment: AppEnvironment.production,
    defaultHost: '192.168.50.1',
    defaultPort: 3000,
    defaultProtocol: 'https',
    connectTimeout: Duration(seconds: 5),
    receiveTimeout: Duration(seconds: 5),
    sendTimeout: Duration(seconds: 5),
    defaultPollingInterval: Duration(seconds: 5),
  );

  static AppConfig current = development;
}
