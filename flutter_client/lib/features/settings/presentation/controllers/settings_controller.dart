import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/di/providers.dart';
import '../../../../core/network/openwrt_client.dart';
import '../../../../core/network/router/connection_diagnostics.dart';
import '../../domain/models/connection_settings.dart';
import '../../domain/repositories/settings_repository.dart';

final settingsControllerProvider =
    StateNotifierProvider<SettingsController, ConnectionSettings>((ref) {
  final repo = ref.watch(settingsRepositoryProvider);
  return SettingsController(repo);
});

class SettingsController extends StateNotifier<ConnectionSettings> {
  final SettingsRepository _repository;

  SettingsController(this._repository) : super(_repository.getSettings());

  Future<void> updateSettings({
    String? routerIp,
    int? routerPort,
    String? protocol,
    String? username,
    String? password,
    String? apiKey,
    bool? isDemoMode,
    int? refreshInterval,
    bool? isDarkMode,
  }) async {
    final updated = state.copyWith(
      routerIp: routerIp,
      routerPort: routerPort,
      protocol: protocol,
      username: username,
      password: password,
      apiKey: apiKey,
      isDemoMode: isDemoMode,
      refreshInterval: refreshInterval,
      isDarkMode: isDarkMode,
    );
    await _repository.saveSettings(updated);
    state = updated;
  }

  Future<void> toggleDemoMode(bool value) async {
    await updateSettings(isDemoMode: value);
  }

  Future<ConnectionTestResultInfo> testConnection() async {
    return await _repository.testConnection();
  }

  Future<ConnectionDiagnosticReport?> runDiagnostics() async {
    return await _repository.runDiagnostics();
  }

  Future<void> resetToDefaults() async {
    await _repository.resetSettings();
    state = _repository.getSettings();
  }
}
