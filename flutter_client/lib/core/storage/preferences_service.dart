import 'package:shared_preferences/shared_preferences.dart';
import '../constants/api_endpoints.dart';

class PreferencesService {
  final SharedPreferences _prefs;

  PreferencesService(this._prefs);

  static const String _keyRouterIp = 'router_ip';
  static const String _keyRouterPort = 'router_port';
  static const String _keyApiKey = 'api_key';
  static const String _keyIsDemoMode = 'is_demo_mode';
  static const String _keyRefreshInterval = 'refresh_interval_seconds';
  static const String _keyIsDarkMode = 'is_dark_mode';

  String get routerIp => _prefs.getString(_keyRouterIp) ?? ApiEndpoints.defaultRouterIp;
  Future<bool> setRouterIp(String value) => _prefs.setString(_keyRouterIp, value.trim());

  int get routerPort => _prefs.getInt(_keyRouterPort) ?? ApiEndpoints.defaultRouterPort;
  Future<bool> setRouterPort(int value) => _prefs.setInt(_keyRouterPort, value);

  String get apiKey => _prefs.getString(_keyApiKey) ?? ApiEndpoints.defaultApiKey;
  Future<bool> setApiKey(String value) => _prefs.setString(_keyApiKey, value.trim());

  bool get isDemoMode => _prefs.getBool(_keyIsDemoMode) ?? true;
  Future<bool> setDemoMode(bool value) => _prefs.setBool(_keyIsDemoMode, value);

  int get refreshInterval => _prefs.getInt(_keyRefreshInterval) ?? 10;
  Future<bool> setRefreshInterval(int value) => _prefs.setInt(_keyRefreshInterval, value);

  bool get isDarkMode => _prefs.getBool(_keyIsDarkMode) ?? true;
  Future<bool> setDarkMode(bool value) => _prefs.setBool(_keyIsDarkMode, value);

  Future<void> resetToDefaults() async {
    await setRouterIp(ApiEndpoints.defaultRouterIp);
    await setRouterPort(ApiEndpoints.defaultRouterPort);
    await setApiKey(ApiEndpoints.defaultApiKey);
    await setDemoMode(true);
    await setRefreshInterval(10);
    await setDarkMode(true);
  }
}
