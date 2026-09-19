import 'package:dio/dio.dart';
import '../constants/api_endpoints.dart';
import '../errors/exceptions.dart';
import '../storage/preferences_service.dart';
import 'mock_data_generator.dart';

class ApiClient {
  final Dio _dio;
  final PreferencesService _preferencesService;

  ApiClient({
    required PreferencesService preferencesService,
    Dio? dio,
  })  : _preferencesService = preferencesService,
        _dio = dio ?? Dio() {
    _configureDio();
  }

  void _configureDio() {
    _dio.options = BaseOptions(
      connectTimeout: const Duration(seconds: 4),
      receiveTimeout: const Duration(seconds: 4),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    );

    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          final host = _preferencesService.routerIp;
          final port = _preferencesService.routerPort;
          final token = _preferencesService.apiKey;

          options.baseUrl = ApiEndpoints.baseUrl(host, port);
          if (token.isNotEmpty) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          return handler.next(options);
        },
      ),
    );
  }

  Future<dynamic> get(String path) async {
    // If Demo Mode is enabled, return realistic mock data instantly
    if (_preferencesService.isDemoMode) {
      await Future.delayed(const Duration(milliseconds: 300));
      if (path == ApiEndpoints.devices) {
        return {'status': 'success', 'devices': MockDataGenerator.mockDevices};
      } else if (path == ApiEndpoints.reports) {
        return MockDataGenerator.mockReport;
      }
    }

    try {
      final response = await _dio.get(path);
      return response.data;
    } on DioException catch (e) {
      _handleDioError(e);
    }
  }

  Future<dynamic> post(String path, Map<String, dynamic> data) async {
    if (_preferencesService.isDemoMode) {
      await Future.delayed(const Duration(milliseconds: 350));
      if (path == ApiEndpoints.quota) {
        final mac = data['mac'] as String;
        final newQuota = (data['quota_gb'] as num).toDouble();
        final enabled = data['enabled'] as bool? ?? true;

        // Update in-memory mock devices
        for (var d in MockDataGenerator.mockDevices) {
          if (d['mac'] == mac) {
            d['quota_gb'] = newQuota;
            d['enabled'] = enabled;
            d['remaining_gb'] = (newQuota - (d['usage_gb'] as num)).clamp(0, 9999).toDouble();
            d['is_blocked'] = !enabled || (d['usage_gb'] as num) >= newQuota;
            break;
          }
        }

        return {
          'status': 'success',
          'message': 'Quota updated successfully',
          'mac': mac,
          'new_quota_gb': newQuota,
        };
      }
      return {'status': 'success'};
    }

    try {
      final response = await _dio.post(path, data: data);
      return response.data;
    } on DioException catch (e) {
      _handleDioError(e);
    }
  }

  Never _handleDioError(DioException e) {
    if (e.response?.statusCode == 401 || e.response?.statusCode == 403) {
      throw AuthenticationException(
        message: e.response?.data?['message']?.toString() ?? 'Invalid API Token for OpenWrt Router',
      );
    } else if (e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.receiveTimeout ||
        e.type == DioExceptionType.connectionError) {
      throw const NetworkException(
        message: 'Cannot reach OpenWrt Router. Check Wi-Fi connection and Router IP.',
      );
    } else {
      throw ServerException(
        message: e.response?.data?['message']?.toString() ?? e.message ?? 'Unknown Router error',
        statusCode: e.response?.statusCode,
      );
    }
  }
}
