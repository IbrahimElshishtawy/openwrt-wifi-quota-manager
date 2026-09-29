class ApiEndpoints {
  ApiEndpoints._();

  static const String defaultRouterIp = '127.0.0.1';
  static const int defaultRouterPort = 3050;
  static const String defaultApiKey = '';
  static const String defaultProtocol = 'http';
  static const String defaultUsername = 'root';

  // Controller API Endpoints
  static const String health = '/api/health';
  static const String healthLive = '/api/health/live';
  static const String healthReady = '/api/health/ready';
  static const String operationsStatus = '/api/operations/status';
  static const String devices = '/api/devices';
  static const String quotas = '/api/quotas';
  static const String usage = '/api/usage';
  static const String blocks = '/api/blocks';
  static const String quotaEnforcementStatus = '/api/quota-enforcement/status';
  static const String quotaEnforcementSync = '/api/quota-enforcement/sync';
  static const String metrics = '/api/metrics';

  // Action endpoints
  static const String block = '/block';
  static const String unblock = '/unblock';
  static const String quota = '/api/quotas';
  static const String reset = '/api/quotas/reset';
  static const String reports = '/api/usage/reports';

  // Legacy & Compatibility Aliases
  static const String legacyDevices = '/devices';
  static const String legacyReports = '/reports';
  static const String legacyUsage = '/usage';
  static const String legacyBlocked = '/blocked';
  static const String legacyBlock = '/block';
  static const String legacyUnblock = '/unblock';
  static const String legacyQuota = '/quota';

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
