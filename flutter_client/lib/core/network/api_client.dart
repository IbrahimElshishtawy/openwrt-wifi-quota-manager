import 'dart:io';
import 'package:dio/dio.dart';
import '../constants/api_endpoints.dart';
import '../errors/exceptions.dart';
import '../storage/preferences_service.dart';
import 'mock_data_generator.dart';

class ApiClient {
  final Dio _dio;
  final PreferencesService preferencesService;

  ApiClient({
    required this.preferencesService,
    Dio? dio,
  }) : _dio = dio ?? Dio() {
    _configureDio();
  }

  Dio get dioInstance => _dio;

  void _configureDio() {
    _dio.options = BaseOptions(
      connectTimeout: const Duration(seconds: 4),
      receiveTimeout: const Duration(seconds: 5),
      sendTimeout: const Duration(seconds: 4),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      // Avoid printing sensitive authentication data in debug logs
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

          // Attach Bearer token for Quota Manager REST API if configured
          if (token.isNotEmpty) {
            options.headers['Authorization'] = 'Bearer $token';
          }

          // Attach LuCI sysauth cookie if active
          if (sessionToken.isNotEmpty) {
            options.headers['Cookie'] = 'sysauth=$sessionToken';
          }

          return handler.next(options);
        },
        onError: (error, handler) {
          // Never log raw tokens or auth headers in error stack traces
          return handler.next(error);
        },
      ),
    );
  }

  Future<dynamic> get(String path, {Map<String, dynamic>? queryParameters}) async {
    // If Demo Mode is enabled, return realistic mock data instantly without network calls
    if (preferencesService.isDemoMode) {
      await Future.delayed(const Duration(milliseconds: 250));
      return _handleDemoGet(path);
    }

    try {
      final response = await _dio.get(path, queryParameters: queryParameters);
      return response.data;
    } on DioException catch (e) {
      _handleDioError(e);
    }
  }

  Future<dynamic> post(String path, {dynamic data}) async {
    if (preferencesService.isDemoMode) {
      await Future.delayed(const Duration(milliseconds: 300));
      return _handleDemoPost(path, data is Map<String, dynamic> ? data : {});
    }

    try {
      final response = await _dio.post(path, data: data);
      return response.data;
    } on DioException catch (e) {
      _handleDioError(e);
    }
  }

  Future<dynamic> delete(String path, {Map<String, dynamic>? queryParameters}) async {
    if (preferencesService.isDemoMode) {
      await Future.delayed(const Duration(milliseconds: 250));
      return {'status': 'success', 'message': 'Device removed (Demo Mode)'};
    }

    try {
      final response = await _dio.delete(path, queryParameters: queryParameters);
      return response.data;
    } on DioException catch (e) {
      _handleDioError(e);
    }
  }

  dynamic _handleDemoGet(String path) {
    if (path == ApiEndpoints.health) {
      return {
        'status': 'ok',
        'service': 'OpenWrt Wi-Fi Quota Manager API (Demo)',
        'version': '1.0.0-demo',
        'timestamp': DateTime.now().toIso8601String(),
      };
    } else if (path == ApiEndpoints.devices) {
      return {'status': 'success', 'devices': MockDataGenerator.mockDevices};
    } else if (path == ApiEndpoints.reports) {
      return MockDataGenerator.mockReport;
    } else if (path == ApiEndpoints.usage) {
      return {
        'status': 'success',
        'count': MockDataGenerator.mockDevices.length,
        'usage': {
          for (var d in MockDataGenerator.mockDevices)
            d['mac'] as String: {
              'rx_bytes': ((d['usage_gb'] as num) * 0.8 * 1024 * 1024 * 1024).toInt(),
              'tx_bytes': ((d['usage_gb'] as num) * 0.2 * 1024 * 1024 * 1024).toInt(),
              'total_bytes': ((d['usage_gb'] as num) * 1024 * 1024 * 1024).toInt(),
            }
        }
      };
    } else if (path == ApiEndpoints.blocked) {
      return {
        'status': 'success',
        'blocked_devices': MockDataGenerator.mockDevices
            .where((d) => d['is_blocked'] == true)
            .map((d) => d['mac'] as String)
            .toList(),
      };
    }
    return {'status': 'success'};
  }

  dynamic _handleDemoPost(String path, Map<String, dynamic> data) {
    if (path == ApiEndpoints.quota) {
      final mac = data['mac'] as String? ?? '';
      final newQuota = (data['quota_gb'] as num?)?.toDouble() ?? 10.0;
      final enabled = data['enabled'] as bool? ?? true;

      for (var d in MockDataGenerator.mockDevices) {
        if ((d['mac'] as String).toUpperCase() == mac.toUpperCase()) {
          d['quota_gb'] = newQuota;
          d['enabled'] = enabled;
          final usage = (d['usage_gb'] as num).toDouble();
          d['remaining_gb'] = (newQuota - usage).clamp(0, 9999).toDouble();
          d['is_blocked'] = !enabled || (usage >= newQuota);
          break;
        }
      }

      return {
        'status': 'success',
        'message': 'Quota updated successfully (Demo)',
        'mac': mac,
        'new_quota_gb': newQuota,
      };
    } else if (path == ApiEndpoints.block) {
      final mac = data['mac'] as String? ?? '';
      for (var d in MockDataGenerator.mockDevices) {
        if ((d['mac'] as String).toUpperCase() == mac.toUpperCase()) {
          d['is_blocked'] = true;
          d['enabled'] = false;
          break;
        }
      }
      return {'status': 'success', 'message': 'Device $mac blocked (Demo)'};
    } else if (path == ApiEndpoints.unblock) {
      final mac = data['mac'] as String? ?? '';
      for (var d in MockDataGenerator.mockDevices) {
        if ((d['mac'] as String).toUpperCase() == mac.toUpperCase()) {
          d['is_blocked'] = false;
          d['enabled'] = true;
          break;
        }
      }
      return {'status': 'success', 'message': 'Device $mac unblocked (Demo)'};
    }
    return {'status': 'success'};
  }

  Never _handleDioError(DioException e) {
    final statusCode = e.response?.statusCode;
    final responseMsg = e.response?.data is Map
        ? (e.response?.data['message']?.toString())
        : null;

    if (statusCode == 401 || statusCode == 403) {
      throw OpenWrtAuthenticationException(
        message: responseMsg ?? 'OpenWrt authentication failed. Check your credentials or API token.',
        statusCode: statusCode,
      );
    } else if (statusCode == 501) {
      throw OpenWrtUnsupportedException(
        message: responseMsg ?? 'Requested OpenWrt capability is not supported or required package is missing.',
      );
    } else if (e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.receiveTimeout ||
        e.type == DioExceptionType.sendTimeout) {
      throw const OpenWrtTimeoutException(
        message: 'Router did not respond in time. Check if OpenWrt is responsive.',
      );
    } else if (e.type == DioExceptionType.connectionError ||
        e.error is SocketException) {
      throw const OpenWrtConnectionException(
        message: 'Unable to connect to router. Check Router IP, Port, Wi-Fi connection, and Protocol.',
      );
    } else {
      throw OpenWrtApiException(
        message: responseMsg ?? e.message ?? 'Unknown OpenWrt communication error.',
        statusCode: statusCode,
      );
    }
  }
}
