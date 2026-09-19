import 'package:shared_preferences/shared_preferences.dart';
import '../constants/api_endpoints.dart';
import '../security/credential_storage.dart';

class PreferencesService {
  final SharedPreferences _prefs;
  final CredentialStorage _credentialStorage;

  PreferencesService(this._prefs, [CredentialStorage? credentialStorage])
      : _credentialStorage = credentialStorage ?? CredentialStorage(_prefs);

  static const String _keyRouterIp = 'router_ip';
  static const String _keyRouterPort = 'router_port';
  static const String _keyRouterProtocol = 'router_protocol';
  static const String _keyRouterUsername = 'router_username';
  static const String _keyIsDemoMode = 'is_demo_mode';
  static const String _keyRefreshInterval = 'refresh_interval_seconds';
  static const String _keyIsDarkMode = 'is_dark_mode';

  CredentialStorage get credentials => _credentialStorage;

  String get routerIp => _prefs.getString(_keyRouterIp) ?? ApiEndpoints.defaultRouterIp;
  Future<bool> setRouterIp(String value) => _prefs.setString(_keyRouterIp, value.trim());

  int get routerPort => _prefs.getInt(_keyRouterPort) ?? ApiEndpoints.defaultRouterPort;
  Future<bool> setRouterPort(int value) => _prefs.setInt(_keyRouterPort, value);

  String get routerProtocol => _prefs.getString(_keyRouterProtocol) ?? 'http';
  Future<bool> setRouterProtocol(String value) =>
      _prefs.setString(_keyRouterProtocol, value.trim().toLowerCase());

  String get routerUsername => _prefs.getString(_keyRouterUsername) ?? 'root';
  Future<bool> setRouterUsername(String value) =>
      _prefs.setString(_keyRouterUsername, value.trim());

  String get routerPassword => _credentialStorage.getPassword();
  Future<bool> setRouterPassword(String value) => _credentialStorage.savePassword(value);

  String get apiKey {
    final secured = _credentialStorage.getApiKey();
    if (secured.isNotEmpty) return secured;
    // Fallback or migration from legacy key if set
    final legacy = _prefs.getString('api_key');
    if (legacy != null && legacy.isNotEmpty) {
      _credentialStorage.saveApiKey(legacy);
      _prefs.remove('api_key');
      return legacy;
    }
    return ApiEndpoints.defaultApiKey;
  }

  Future<bool> setApiKey(String value) => _credentialStorage.saveApiKey(value);

  bool get isDemoMode => _prefs.getBool(_keyIsDemoMode) ?? true;
  Future<bool> setDemoMode(bool value) => _prefs.setBool(_keyIsDemoMode, value);

  int get refreshInterval => _prefs.getInt(_keyRefreshInterval) ?? 10;
  Future<bool> setRefreshInterval(int value) => _prefs.setInt(_keyRefreshInterval, value);

  bool get isDarkMode => _prefs.getBool(_keyIsDarkMode) ?? true;
  Future<bool> setDarkMode(bool value) => _prefs.setBool(_keyIsDarkMode, value);

  Future<void> resetToDefaults() async {
    await setRouterIp(ApiEndpoints.defaultRouterIp);
    await setRouterPort(ApiEndpoints.defaultRouterPort);
    await setRouterProtocol('http');
    await setRouterUsername('root');
    await setRouterPassword('');
    await setApiKey(ApiEndpoints.defaultApiKey);
    await setDemoMode(true);
    await setRefreshInterval(10);
    await setDarkMode(true);
  }
}
