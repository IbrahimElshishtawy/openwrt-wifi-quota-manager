abstract class Failure {
  final String message;
  final String? code;
  final String? requestId;

  const Failure(this.message, {this.code, this.requestId});

  @override
  String toString() => message;

  factory Failure.fromStatusCode(
    int? statusCode,
    String message, {
    String? code,
    String? requestId,
  }) {
    switch (statusCode) {
      case 400:
        return ValidationFailure(message, code: code ?? 'VALIDATION_ERROR', requestId: requestId);
      case 401:
        return AuthenticationFailure(message, code: code ?? 'UNAUTHORIZED', requestId: requestId);
      case 403:
        return AuthorizationFailure(message, code: code ?? 'FORBIDDEN', requestId: requestId);
      case 404:
        return NotFoundFailure(message, code: code ?? 'NOT_FOUND', requestId: requestId);
      case 409:
        return ConflictFailure(message, code: code ?? 'CONFLICT', requestId: requestId);
      case 413:
        return PayloadTooLargeFailure(message, code: code ?? 'PAYLOAD_TOO_LARGE', requestId: requestId);
      case 429:
        return RateLimitFailure(message, code: code ?? 'RATE_LIMIT_EXCEEDED', requestId: requestId);
      case 502:
      case 503:
        return BackendUnavailableFailure(message, code: code ?? 'BACKEND_UNAVAILABLE', requestId: requestId);
      case 408:
      case 504:
        return TimeoutFailure(message, code: code ?? 'TIMEOUT', requestId: requestId);
      default:
        if (statusCode != null && statusCode >= 500) {
          return BackendUnavailableFailure(message, code: code ?? 'INTERNAL_SERVER_ERROR', requestId: requestId);
        }
        return UnknownFailure(message, code: code ?? 'UNKNOWN_ERROR', requestId: requestId);
    }
  }
}

class ValidationFailure extends Failure {
  final dynamic issues;
  const ValidationFailure(super.message, {super.code, super.requestId, this.issues});
}

class AuthenticationFailure extends Failure {
  const AuthenticationFailure(super.message, {super.code, super.requestId});
}

class AuthorizationFailure extends Failure {
  const AuthorizationFailure(super.message, {super.code, super.requestId});
}

class NotFoundFailure extends Failure {
  const NotFoundFailure(super.message, {super.code, super.requestId});
}

class ConflictFailure extends Failure {
  const ConflictFailure(super.message, {super.code, super.requestId});
}

class PayloadTooLargeFailure extends Failure {
  const PayloadTooLargeFailure(super.message, {super.code, super.requestId});
}

class RateLimitFailure extends Failure {
  final int? retryAfterSeconds;
  const RateLimitFailure(super.message, {super.code, super.requestId, this.retryAfterSeconds});
}

class BackendUnavailableFailure extends Failure {
  const BackendUnavailableFailure(super.message, {super.code, super.requestId});
}

class TimeoutFailure extends Failure {
  const TimeoutFailure(super.message, {super.code, super.requestId});
}

class NetworkFailure extends Failure {
  const NetworkFailure(super.message, {super.code, super.requestId});
}

class CacheFailure extends Failure {
  const CacheFailure(super.message, {super.code, super.requestId});
}

class UnknownFailure extends Failure {
  const UnknownFailure(super.message, {super.code, super.requestId});
}

class ServerFailure extends Failure {
  final int? statusCode;
  const ServerFailure(super.message, {this.statusCode, super.code, super.requestId});
}

class UnsupportedFeatureFailure extends Failure {
  final String? missingPackage;
  const UnsupportedFeatureFailure(super.message, {this.missingPackage, super.code, super.requestId});
}
