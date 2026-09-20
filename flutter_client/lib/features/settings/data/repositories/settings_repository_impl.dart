import '../../../../core/network/openwrt_client.dart';
import '../../../../core/network/router/connection_diagnostics.dart';
import '../../../../core/network/router/router_service.dart';
import '../../../../core/storage/preferences_service.dart';
import '../../domain/models/connection_settings.dart';
import '../../domain/repositories/settings_repository.dart';

class SettingsRepositoryImpl implements SettingsRepository {
  final PreferencesService preferencesService;
  final OpenWrtClient openWrtClient;
  final RouterService? routerService;

  SettingsRepositoryImpl({
    required this.preferencesService,
    required this.openWrtClient,
    this.routerService,
  });

  @override
  ConnectionSettings getSettings() {
    return ConnectionSettings(
      routerIp: preferencesService.routerIp,
      routerPort: preferencesService.routerPort,
      protocol: preferencesService.routerProtocol,
      username: preferencesService.routerUsername,
      password: preferencesService.routerPassword,
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
    await preferencesService.setRouterProtocol(settings.protocol);
    await preferencesService.setRouterUsername(settings.username);
    await preferencesService.setRouterPassword(settings.password);
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
  Future<ConnectionTestResultInfo> testConnection() async {
    if (routerService != null) {
      return await routerService!.testConnection();
    }
    return await openWrtClient.testConnection();
  }

  @override
  Future<ConnectionDiagnosticReport?> runDiagnostics() async {
    if (routerService != null) {
      return await routerService!.runDiagnostics();
    }
    return null;
  }
}
