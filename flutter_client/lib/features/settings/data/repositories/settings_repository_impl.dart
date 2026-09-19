import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/storage/preferences_service.dart';
import '../../domain/models/connection_settings.dart';
import '../../domain/repositories/settings_repository.dart';

class SettingsRepositoryImpl implements SettingsRepository {
  final PreferencesService _preferencesService;
  final ApiClient _apiClient;

  SettingsRepositoryImpl({
    required PreferencesService preferencesService,
    required ApiClient apiClient,
  })  : _preferencesService = preferencesService,
        _apiClient = apiClient;

  @override
  ConnectionSettings getSettings() {
    return ConnectionSettings(
      routerIp: _preferencesService.routerIp,
      routerPort: _preferencesService.routerPort,
      apiKey: _preferencesService.apiKey,
      isDemoMode: _preferencesService.isDemoMode,
      refreshInterval: _preferencesService.refreshInterval,
      isDarkMode: _preferencesService.isDarkMode,
    );
  }

  @override
  Future<void> saveSettings(ConnectionSettings settings) async {
    await _preferencesService.setRouterIp(settings.routerIp);
    await _preferencesService.setRouterPort(settings.routerPort);
    await _preferencesService.setApiKey(settings.apiKey);
    await _preferencesService.setDemoMode(settings.isDemoMode);
    await _preferencesService.setRefreshInterval(settings.refreshInterval);
    await _preferencesService.setDarkMode(settings.isDarkMode);
  }

  @override
  Future<void> resetSettings() async {
    await _preferencesService.resetToDefaults();
  }

  @override
  Future<bool> testConnection() async {
    try {
      final res = await _apiClient.get(ApiEndpoints.reports);
      return res != null;
    } catch (_) {
      return false;
    }
  }
}
