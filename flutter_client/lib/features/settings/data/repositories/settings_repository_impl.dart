import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/storage/preferences_service.dart';
import '../../domain/models/connection_settings.dart';
import '../../domain/repositories/settings_repository.dart';

class SettingsRepositoryImpl implements SettingsRepository {
  final PreferencesService preferencesService;
  final ApiClient apiClient;

  SettingsRepositoryImpl({
    required this.preferencesService,
    required this.apiClient,
  });

  @override
  ConnectionSettings getSettings() {
    return ConnectionSettings(
      routerIp: preferencesService.routerIp,
      routerPort: preferencesService.routerPort,
      apiKey: preferencesService.apiKey,
      isDemoMode: preferencesService.isDemoMode,
      refreshInterval: preferencesService.refreshInterval,
      isDarkMode: preferencesService.isDarkMode,
    );
  }

  @override
  Future<void> saveSettings(ConnectionSettings settings) async {
    await preferencesService.setRouterIp(settings.routerIp);
    await preferencesService.setRouterPort(settings.routerPort);
    await preferencesService.setApiKey(settings.apiKey);
    await preferencesService.setDemoMode(settings.isDemoMode);
    await preferencesService.setRefreshInterval(settings.refreshInterval);
    await preferencesService.setDarkMode(settings.isDarkMode);
  }

  @override
  Future<void> resetSettings() async {
    await preferencesService.resetToDefaults();
  }

  @override
  Future<bool> testConnection() async {
    try {
      final res = await apiClient.get(ApiEndpoints.reports);
      return res != null;
    } catch (_) {
      return false;
    }
  }
}
