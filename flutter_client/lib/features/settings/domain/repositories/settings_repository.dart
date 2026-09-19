import '../models/connection_settings.dart';

abstract class SettingsRepository {
  ConnectionSettings getSettings();
  Future<void> saveSettings(ConnectionSettings settings);
  Future<void> resetSettings();
  Future<bool> testConnection();
}
