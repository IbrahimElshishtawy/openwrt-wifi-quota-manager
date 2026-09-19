class ApiEndpoints {
  ApiEndpoints._();

  static const String defaultRouterIp = '192.168.1.1';
  static const int defaultRouterPort = 8080;
  static const String defaultApiKey = 'openwrt-secret-token-2026';
  static const String defaultProtocol = 'http';
  static const String defaultUsername = 'root';

  // REST API Endpoints defined in openwrt/api/README.md
  static const String health = '/health';
  static const String devices = '/devices';
  static const String quota = '/quota';
  static const String reports = '/reports';
  static const String package = '/package';
  static const String usage = '/usage';
  static const String blocked = '/blocked';
  static const String block = '/block';
  static const String unblock = '/unblock';
  static const String reset = '/reset';

  // LuCI RPC / ubus Endpoints
  static const String luciAuth = '/cgi-bin/luci/rpc/auth';
  static const String luciSys = '/cgi-bin/luci/rpc/sys';
  static const String ubus = '/ubus';

  /// Constructs a normalized base URL supporting configurable protocol, host, and port.
  static String baseUrl(String host, int port, {String protocol = defaultProtocol}) {
    var cleanHost = host.trim();
    // Strip leading scheme if user typed it into IP field
    cleanHost = cleanHost.replaceAll(RegExp(r'^https?://', caseSensitive: false), '');
    // Strip trailing slashes or paths
    if (cleanHost.contains('/')) {
      cleanHost = cleanHost.split('/')[0];
    }
    // Strip port if user typed host:port into IP field
    if (cleanHost.contains(':') && !cleanHost.contains(']')) {
      cleanHost = cleanHost.split(':')[0];
    }

    final proto = protocol.trim().toLowerCase().replaceAll(RegExp(r'[^a-z]'), '');
    final validProto = (proto == 'https') ? 'https' : 'http';

    return '$validProto://$cleanHost:$port';
  }
}
