import '../../../../core/network/openwrt_client.dart';
import '../models/connection_settings.dart';

abstract class SettingsRepository {
  ConnectionSettings getSettings();
  Future<void> saveSettings(ConnectionSettings settings);
  Future<void> resetSettings();
  Future<ConnectionTestResultInfo> testConnection();
}
