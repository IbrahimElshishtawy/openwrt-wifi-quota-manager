class ApiEndpoints {
  ApiEndpoints._();

  static const String defaultRouterIp = '192.168.1.1';
  static const int defaultRouterPort = 8080;
  static const String defaultApiKey = 'openwrt-secret-token-2026';

  // REST API Endpoints defined in openwrt/api/README.md
  static const String devices = '/devices';
  static const String quota = '/quota';
  static const String reports = '/reports';
  static const String package = '/package';

  static String baseUrl(String host, int port) {
    // Normalizes host format
    final cleanHost = host.trim().replaceAll(RegExp(r'^https?://'), '');
    return 'http://$cleanHost:$port';
  }
}
