/// Base exception for all OpenWrt operations
abstract class OpenWrtException implements Exception {
  final String message;
  final int? statusCode;

  const OpenWrtException(this.message, {this.statusCode});

  @override
  String toString() => message;
}

/// Thrown when the OpenWrt router is unreachable (LAN down, incorrect IP, offline)
class OpenWrtConnectionException extends OpenWrtException {
  const OpenWrtConnectionException({
    String message = 'Unable to reach OpenWrt router. Check router IP, Wi-Fi connection, and port.',
    int? statusCode,
  }) : super(message, statusCode: statusCode);
}

/// Thrown when OpenWrt credentials, API token, or LuCI session authentication fails
class OpenWrtAuthenticationException extends OpenWrtException {
  const OpenWrtAuthenticationException({
    String message = 'Authentication failed. Please verify your OpenWrt username, password, or API token.',
    int? statusCode = 401,
  }) : super(message, statusCode: statusCode);
}

/// Thrown when a network or API call times out
class OpenWrtTimeoutException extends OpenWrtException {
  const OpenWrtTimeoutException({
    String message = 'Connection timed out. OpenWrt router did not respond in time.',
    int? statusCode = 408,
  }) : super(message, statusCode: statusCode);
}

/// Thrown when an OpenWrt endpoint returns a server or validation error
class OpenWrtApiException extends OpenWrtException {
  const OpenWrtApiException({
    required String message,
    int? statusCode,
  }) : super(message, statusCode: statusCode);
}

/// Thrown when an OpenWrt feature is unavailable because required packages
/// (e.g. nlbwmon, nftables, LuCI RPC) are not installed or active on the router.
class OpenWrtUnsupportedException extends OpenWrtException {
  final String? missingPackage;

  const OpenWrtUnsupportedException({
    required String message,
    this.missingPackage,
  }) : super(message);
}

// -------------------------------------------------------------
// Existing standard exceptions preserved for backward compatibility
// -------------------------------------------------------------

class ServerException implements Exception {
  final String message;
  final int? statusCode;

  const ServerException({required this.message, this.statusCode});

  @override
  String toString() => 'ServerException: $message (code: $statusCode)';
}

class CacheException implements Exception {
  final String message;

  const CacheException({required this.message});

  @override
  String toString() => 'CacheException: $message';
}

class NetworkException implements Exception {
  final String message;

  const NetworkException({required this.message});

  @override
  String toString() => 'NetworkException: $message';
}

class AuthenticationException implements Exception {
  final String message;

  const AuthenticationException({required this.message});

  @override
  String toString() => 'AuthenticationException: $message';
}
