import 'package:flutter_secure_storage/flutter_secure_storage.dart';

abstract class ISecureStorage {
  Future<void> write({required String key, required String value});
  Future<String?> read({required String key});
  Future<void> delete({required String key});
  Future<void> deleteAll();
}

class SecureStorageService implements ISecureStorage {
  final FlutterSecureStorage _storage;

  SecureStorageService([FlutterSecureStorage? storage])
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(),
              iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
              lOptions: LinuxOptions(),
            );


  static const String keyApiToken = 'auth_api_token';
  static const String keyRouterPassword = 'auth_router_password';
  static const String keySessionToken = 'auth_session_token';

  @override
  Future<void> write({required String key, required String value}) async {
    await _storage.write(key: key, value: value);
  }

  @override
  Future<String?> read({required String key}) async {
    try {
      return await _storage.read(key: key);
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> delete({required String key}) async {
    try {
      await _storage.delete(key: key);
    } catch (_) {}
  }

  @override
  Future<void> deleteAll() async {
    try {
      await _storage.deleteAll();
    } catch (_) {}
  }

  Future<void> saveApiToken(String token) => write(key: keyApiToken, value: token.trim());
  Future<String?> getApiToken() => read(key: keyApiToken);
  Future<void> clearApiToken() => delete(key: keyApiToken);

  Future<void> saveRouterPassword(String password) => write(key: keyRouterPassword, value: password.trim());
  Future<String?> getRouterPassword() => read(key: keyRouterPassword);
  Future<void> clearRouterPassword() => delete(key: keyRouterPassword);

  Future<void> saveSessionToken(String token) => write(key: keySessionToken, value: token.trim());
  Future<String?> getSessionToken() => read(key: keySessionToken);
  Future<void> clearSessionToken() => delete(key: keySessionToken);
}
