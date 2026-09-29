import 'dart:developer' as dev;
import 'dart:io';
import 'package:dio/dio.dart';
import 'package:uuid/uuid.dart';
import '../config/app_config.dart';
import '../constants/api_endpoints.dart';
import '../errors/exceptions.dart';
import '../storage/preferences_service.dart';
import 'mock_data_generator.dart';

class ApiClient {
  final Dio _dio;
  final PreferencesService preferencesService;
  static const _uuid = Uuid();

  ApiClient({
    required this.preferencesService,
    Dio? dio,
  }) : _dio = dio ?? Dio() {
    _configureDio();
  }

  Dio get dioInstance => _dio;

  void _configureDio() {
    final config = AppConfig.current;

    _dio.options = BaseOptions(
      connectTimeout: config.connectTimeout,
      receiveTimeout: config.receiveTimeout,
      sendTimeout: config.sendTimeout,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      responseType: ResponseType.json,
    );

    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          final host = preferencesService.routerIp;
          final port = preferencesService.routerPort;
          final protocol = preferencesService.routerProtocol;
          final token = preferencesService.apiKey;
          final sessionToken = preferencesService.credentials.getSessionToken();

          options.baseUrl = ApiEndpoints.baseUrl(host, port, protocol: protocol);

          // Generate or preserve correlated X-Request-Id
          if (!options.headers.containsKey('X-Request-Id')) {
            options.headers['X-Request-Id'] = _uuid.v4();
          }

          // Attach Bearer token for Quota Manager REST API if configured
          if (token.isNotEmpty) {
            options.headers['Authorization'] = 'Bearer $token';
          }

          // Attach LuCI sysauth cookie if active
          if (sessionToken.isNotEmpty) {
            options.headers['Cookie'] = 'sysauth=$sessionToken';
          }

          if (config.isDevelopment) {
            dev.log(
              '--> ${options.method} ${options.baseUrl}${options.path} [ReqID: ${options.headers['X-Request-Id']}]',
              name: 'ApiClient',
            );
          }

          return handler.next(options);
        },
        onResponse: (response, handler) {
          if (AppConfig.current.isDevelopment) {
            final reqId = response.requestOptions.headers['X-Request-Id'] ??
                response.headers.value('x-request-id');
            dev.log(
              '<-- ${response.statusCode} ${response.requestOptions.path} [ReqID: $reqId]',
              name: 'ApiClient',
            );
          }
          return handler.next(response);
        },
        onError: (error, handler) {
          if (AppConfig.current.isDevelopment) {
            final reqId = error.requestOptions.headers['X-Request-Id'] ??
                error.response?.headers.value('x-request-id');
            dev.log(
              '<-- ERROR ${error.response?.statusCode ?? 'NETWORK'} ${error.requestOptions.path} [ReqID: $reqId]: ${error.message}',
              name: 'ApiClient',
              error: error.error,
            );
          }
          return handler.next(error);
        },
      ),
    );
  }

  Future<dynamic> get(
    String path, {
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) async {
    if (preferencesService.isDemoMode) {
      await Future.delayed(const Duration(milliseconds: 250));
      return _handleDemoGet(path);
    }

    try {
      final response = await _dio.get(
        path,
        queryParameters: queryParameters,
        options: options,
      );
      return response.data;
    } on DioException catch (e) {
      // Safe retry once for transient network failures on idempotent GET
      if (_isTransientNetworkError(e)) {
        try {
          await Future.delayed(const Duration(milliseconds: 600));
          final retryResponse = await _dio.get(
            path,
            queryParameters: queryParameters,
            options: options,
          );
          return retryResponse.data;
        } on DioException catch (retryErr) {
          _handleDioError(retryErr);
        }
      }
      _handleDioError(e);
    }
  }

  Future<dynamic> post(
    String path, {
    dynamic data,
    Options? options,
  }) async {
    if (preferencesService.isDemoMode) {
      await Future.delayed(const Duration(milliseconds: 300));
      return _handleDemoPost(path, data is Map<String, dynamic> ? data : {});
    }

    try {
      final response = await _dio.post(path, data: data, options: options);
      return response.data;
    } on DioException catch (e) {
      _handleDioError(e);
    }
  }

  Future<dynamic> patch(
    String path, {
    dynamic data,
    Options? options,
  }) async {
    if (preferencesService.isDemoMode) {
      await Future.delayed(const Duration(milliseconds: 250));
      return _handleDemoPost(path, data is Map<String, dynamic> ? data : {});
    }

    try {
      final response = await _dio.patch(path, data: data, options: options);
      return response.data;
    } on DioException catch (e) {
      _handleDioError(e);
    }
  }

  Future<dynamic> delete(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) async {
    if (preferencesService.isDemoMode) {
      await Future.delayed(const Duration(milliseconds: 250));
      return {'status': 'success', 'message': 'Resource deleted (Demo Mode)'};
    }

    try {
      final response = await _dio.delete(
        path,
        data: data,
        queryParameters: queryParameters,
        options: options,
      );
      return response.data;
    } on DioException catch (e) {
      _handleDioError(e);
    }
  }

  bool _isTransientNetworkError(DioException e) {
    return e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.receiveTimeout ||
        (e.response?.statusCode != null &&
            (e.response!.statusCode == 502 || e.response!.statusCode == 503));
  }

  dynamic _handleDemoGet(String path) {
    if (path == ApiEndpoints.health || path == '/health') {
      return {
        'status': 'healthy',
        'service': 'OpenWrt Wi-Fi Quota Manager API (Demo)',
        'version': '1.0.0-demo',
        'timestamp': DateTime.now().toIso8601String(),
        'uptimeSeconds': 12345,
        'router': 'healthy',
        'firewall': {'status': 'healthy', 'circuitBreaker': 'CLOSED'},
        'quota': {'status': 'healthy'},
        'reconciliation': {'status': 'healthy'},
        'monitor': 'running',
      };
    } else if (path == ApiEndpoints.operationsStatus) {
      return {
        'status': 'healthy',
        'controllerVersion': '1.0.0-demo',
        'uptimeSeconds': 12345,
        'openwrt': {
          'host': '192.168.50.1',
          'port': 22,
          'circuitBreaker': 'CLOSED',
          'consecutiveFailures': 0,
        },
        'monitor': {
          'running': true,
          'syncInProgress': false,
          'intervalMs': 5000,
          'enabled': true,
        },
        'metricsSummary': {
          'httpRequestsTotal': 100,
          'httpErrorsTotal': 0,
          'devicesBlockedTotal': 0,
          'devicesUnblockedTotal': 0,
        },
      };
    } else if (path == ApiEndpoints.devices || path == ApiEndpoints.legacyDevices) {
      return {
        'status': 'success',
        'success': true,
        'data': MockDataGenerator.mockDevices,
        'devices': MockDataGenerator.mockDevices,
        'count': MockDataGenerator.mockDevices.length,
      };
    } else if (path == ApiEndpoints.legacyReports || path == ApiEndpoints.reports) {
      return MockDataGenerator.mockReport;
    } else if (path == ApiEndpoints.usage || path == ApiEndpoints.legacyUsage) {
      return {
        'status': 'success',
        'success': true,
        'count': MockDataGenerator.mockDevices.length,
        'data': [
          for (var d in MockDataGenerator.mockDevices)
            {
              'mac': d['mac'] as String,
              'ip': d['ip'] as String? ?? '192.168.50.100',
              'downloadBytes': ((d['usage_gb'] as num) * 0.8 * 1024 * 1024 * 1024).toInt(),
              'uploadBytes': ((d['usage_gb'] as num) * 0.2 * 1024 * 1024 * 1024).toInt(),
              'totalBytes': ((d['usage_gb'] as num) * 1024 * 1024 * 1024).toInt(),
            }
        ],
        'usage': {
          for (var d in MockDataGenerator.mockDevices)
            d['mac'] as String: {
              'rx_bytes': ((d['usage_gb'] as num) * 0.8 * 1024 * 1024 * 1024).toInt(),
              'tx_bytes': ((d['usage_gb'] as num) * 0.2 * 1024 * 1024 * 1024).toInt(),
              'total_bytes': ((d['usage_gb'] as num) * 1024 * 1024 * 1024).toInt(),
            }
        }
      };
    } else if (path == ApiEndpoints.blocks || path == ApiEndpoints.legacyBlocked) {
      return {
        'status': 'success',
        'success': true,
        'count': MockDataGenerator.mockDevices.where((d) => d['is_blocked'] == true).length,
        'data': MockDataGenerator.mockDevices
            .where((d) => d['is_blocked'] == true)
            .map((d) => d['mac'] as String)
            .toList(),
        'blocked': MockDataGenerator.mockDevices
            .where((d) => d['is_blocked'] == true)
            .map((d) => d['mac'] as String)
            .toList(),
        'blocked_devices': MockDataGenerator.mockDevices
            .where((d) => d['is_blocked'] == true)
            .map((d) => d['mac'] as String)
            .toList(),
      };
    } else if (path == ApiEndpoints.quotas) {
      return {
        'success': true,
        'count': MockDataGenerator.mockDevices.length,
        'data': [
          for (var d in MockDataGenerator.mockDevices)
            {
              'mac': d['mac'] as String,
              'quotaBytes': ((d['quota_gb'] as num) * 1024 * 1024 * 1024).toInt(),
              'usedBytes': ((d['usage_gb'] as num) * 1024 * 1024 * 1024).toInt(),
              'remainingBytes': ((d['remaining_gb'] as num) * 1024 * 1024 * 1024).toInt(),
              'percentage': (d['quota_gb'] as num) > 0
                  ? ((d['usage_gb'] as num) / (d['quota_gb'] as num) * 100).toDouble()
                  : 0.0,
              'status': (d['usage_gb'] as num) >= (d['quota_gb'] as num) ? 'exhausted' : 'active',
              'createdAt': DateTime.now().toIso8601String(),
              'updatedAt': DateTime.now().toIso8601String(),
            }
        ],
      };
    }
    return {'status': 'success', 'success': true};
  }

  dynamic _handleDemoPost(String path, Map<String, dynamic> data) {
    if (path == ApiEndpoints.legacyQuota || path == ApiEndpoints.quotas) {
      final mac = data['mac'] as String? ?? '';
      final newQuotaGb = data['quotaBytes'] != null
          ? ((data['quotaBytes'] as num) / (1024 * 1024 * 1024)).toDouble()
          : (data['quota_gb'] as num?)?.toDouble() ?? 10.0;
      final enabled = data['enabled'] as bool? ?? true;

      for (var d in MockDataGenerator.mockDevices) {
        if ((d['mac'] as String).toUpperCase() == mac.toUpperCase()) {
          d['quota_gb'] = newQuotaGb;
          d['enabled'] = enabled;
          final usage = (d['usage_gb'] as num).toDouble();
          d['remaining_gb'] = (newQuotaGb - usage).clamp(0, 9999).toDouble();
          d['is_blocked'] = !enabled || (usage >= newQuotaGb);
          break;
        }
      }

      return {
        'status': 'success',
        'success': true,
        'message': 'Quota updated successfully (Demo)',
        'data': {
          'mac': mac,
          'quotaBytes': (newQuotaGb * 1024 * 1024 * 1024).toInt(),
          'usedBytes': 0,
          'remainingBytes': (newQuotaGb * 1024 * 1024 * 1024).toInt(),
          'percentage': 0.0,
          'status': 'active',
          'createdAt': DateTime.now().toIso8601String(),
          'updatedAt': DateTime.now().toIso8601String(),
        },
      };
    } else if (path == ApiEndpoints.legacyBlock ||
        path == ApiEndpoints.blocks ||
        path.startsWith('${ApiEndpoints.blocks}/')) {
      final mac = data['mac'] as String? ?? '';
      for (var d in MockDataGenerator.mockDevices) {
        if ((d['mac'] as String).toUpperCase() == mac.toUpperCase()) {
          d['is_blocked'] = true;
          d['enabled'] = false;
          break;
        }
      }
      return {'status': 'success', 'success': true, 'message': 'Device $mac blocked (Demo)'};
    } else if (path == ApiEndpoints.legacyUnblock ||
        path.startsWith('${ApiEndpoints.blocks}/')) {
      final mac = data['mac'] as String? ?? '';
      for (var d in MockDataGenerator.mockDevices) {
        if ((d['mac'] as String).toUpperCase() == mac.toUpperCase()) {
          d['is_blocked'] = false;
          d['enabled'] = true;
          break;
        }
      }
      return {'status': 'success', 'success': true, 'message': 'Device $mac unblocked (Demo)'};
    } else if (path == ApiEndpoints.quotaEnforcementSync) {
      return {
        'success': true,
        'message': 'Enforcement and reconciliation cycle triggered (Demo)',
      };
    }
    return {'status': 'success', 'success': true};
  }

  Never _handleDioError(DioException e) {
    final statusCode = e.response?.statusCode;
    final resData = e.response?.data;
    String? responseMsg;
    String? errorCode;
    String? reqId = e.response?.headers.value('x-request-id') ??
        e.requestOptions.headers['X-Request-Id']?.toString();

    if (resData is Map) {
      responseMsg = resData['message']?.toString();
      if (resData['error'] is Map) {
        final errMap = resData['error'] as Map;
        responseMsg ??= errMap['message']?.toString();
        errorCode = errMap['code']?.toString();
        reqId ??= errMap['requestId']?.toString();
      }
      errorCode ??= resData['code']?.toString();
    }

    if (statusCode == 400) {
      throw OpenWrtApiException(
        message: responseMsg ?? 'Validation failed. Check request parameters.',
        statusCode: 400,
      );
    } else if (statusCode == 401) {
      throw OpenWrtAuthenticationException(
        message: responseMsg ?? 'Authentication required. Check your API authorization token.',
        statusCode: 401,
      );
    } else if (statusCode == 403) {
      throw OpenWrtAuthenticationException(
        message: responseMsg ?? 'Access forbidden. Token does not have required permissions.',
        statusCode: 403,
      );
    } else if (statusCode == 404) {
      throw OpenWrtApiException(
        message: responseMsg ?? 'The requested resource was not found on the controller.',
        statusCode: 404,
      );
    } else if (statusCode == 409) {
      throw OpenWrtApiException(
        message: responseMsg ?? 'Conflict: resource already exists or operation conflicts with current state.',
        statusCode: 409,
      );
    } else if (statusCode == 413) {
      throw OpenWrtApiException(
        message: responseMsg ?? 'Payload too large. Maximum request size is 64KB.',
        statusCode: 413,
      );
    } else if (statusCode == 429) {
      throw OpenWrtApiException(
        message: responseMsg ?? 'Too many requests. Rate limit exceeded, backing off.',
        statusCode: 429,
      );
    } else if (statusCode == 501) {
      throw OpenWrtUnsupportedException(
        message: responseMsg ?? 'Requested OpenWrt capability is not supported or package missing.',
      );
    } else if (statusCode == 502 || statusCode == 503) {
      throw OpenWrtConnectionException(
        message: responseMsg ?? 'OpenWrt backend is currently unavailable or router connectivity is degraded.',
        statusCode: statusCode,
      );
    } else if (e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.receiveTimeout ||
        e.type == DioExceptionType.sendTimeout) {
      throw const OpenWrtTimeoutException(
        message: 'Router did not respond in time. Check if OpenWrt is responsive.',
      );
    } else if (e.type == DioExceptionType.connectionError || e.error is SocketException) {
      throw const OpenWrtConnectionException(
        message: 'Unable to connect to controller. Check Host, Port, and network connection.',
      );
    } else {
      throw OpenWrtApiException(
        message: responseMsg ?? e.message ?? 'Unknown OpenWrt communication error.',
        statusCode: statusCode,
      );
    }
  }
}
