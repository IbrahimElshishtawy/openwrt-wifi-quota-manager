import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../network/api_client.dart';
import '../network/openwrt_client.dart';
import '../network/router/adapter_registry.dart';
import '../network/router/adapters/openwrt_adapter.dart';
import '../network/router/connection_diagnostics.dart';
import '../network/router/quota_engine.dart';
import '../network/router/router_discovery.dart';
import '../network/router/router_service.dart';
import '../security/credential_storage.dart';
import '../storage/isar_service.dart';
import '../storage/preferences_service.dart';

import '../../features/analytics/data/repositories/analytics_repository_impl.dart';
import '../../features/analytics/domain/repositories/analytics_repository.dart';
import '../../features/dashboard/data/datasources/dashboard_local_datasource.dart';
import '../../features/dashboard/data/datasources/dashboard_remote_datasource.dart';
import '../../features/dashboard/data/repositories/dashboard_repository_impl.dart';
import '../../features/dashboard/domain/repositories/dashboard_repository.dart';
import '../../features/devices/data/datasources/device_local_datasource.dart';
import '../../features/devices/data/datasources/device_remote_datasource.dart';
import '../../features/devices/data/repositories/device_repository_impl.dart';
import '../../features/devices/domain/repositories/device_repository.dart';
import '../../features/settings/data/repositories/settings_repository_impl.dart';
import '../../features/settings/domain/repositories/settings_repository.dart';

// --- Core Storage & Security Providers ---
final sharedPreferencesProvider = Provider<SharedPreferences>((ref) {
  throw UnimplementedError('sharedPreferencesProvider must be overridden in ProviderScope');
});

final credentialStorageProvider = Provider<CredentialStorage>((ref) {
  final prefs = ref.watch(sharedPreferencesProvider);
  return CredentialStorage(prefs);
});

final isarServiceProvider = Provider<IsarService>((ref) {
  throw UnimplementedError('isarServiceProvider must be overridden in ProviderScope');
});

final preferencesServiceProvider = Provider<PreferencesService>((ref) {
  final prefs = ref.watch(sharedPreferencesProvider);
  final creds = ref.watch(credentialStorageProvider);
  return PreferencesService(prefs, creds);
});

// --- Core Network Providers ---
final apiClientProvider = Provider<ApiClient>((ref) {
  final prefService = ref.watch(preferencesServiceProvider);
  return ApiClient(preferencesService: prefService);
});

final openWrtClientProvider = Provider<OpenWrtClient>((ref) {
  final client = ref.watch(apiClientProvider);
  final prefService = ref.watch(preferencesServiceProvider);
  return OpenWrtClientImpl(
    apiClient: client,
    preferencesService: prefService,
  );
});

// --- Universal Router Abstraction Providers ---
final openWrtAdapterProvider = Provider<OpenWrtAdapter>((ref) {
  final openWrtClient = ref.watch(openWrtClientProvider);
  final apiClient = ref.watch(apiClientProvider);
  return OpenWrtAdapter(
    openWrtClient: openWrtClient,
    apiClient: apiClient,
  );
});

final routerAdapterRegistryProvider = Provider<RouterAdapterRegistry>((ref) {
  final openWrtAdapter = ref.watch(openWrtAdapterProvider);
  return RouterAdapterRegistry.withDefaults(openWrtAdapter: openWrtAdapter);
});

final routerDiscoveryProvider = Provider<RouterDiscovery>((ref) {
  return RouterDiscovery();
});

final connectionDiagnosticsProvider = Provider<ConnectionDiagnostics>((ref) {
  final discovery = ref.watch(routerDiscoveryProvider);
  return ConnectionDiagnostics(discovery: discovery);
});

final routerServiceProvider = Provider<RouterService>((ref) {
  final registry = ref.watch(routerAdapterRegistryProvider);
  final prefService = ref.watch(preferencesServiceProvider);
  final discovery = ref.watch(routerDiscoveryProvider);
  final diagnostics = ref.watch(connectionDiagnosticsProvider);
  final openWrtAdapter = ref.watch(openWrtAdapterProvider);
  return RouterService(
    registry: registry,
    preferencesService: prefService,
    discovery: discovery,
    diagnostics: diagnostics,
    initialAdapter: openWrtAdapter,
  );
});

final quotaEngineProvider = Provider<QuotaEngine>((ref) {
  final routerService = ref.watch(routerServiceProvider);
  return routerService.quotaEngine;
});

// --- Devices Providers ---
final deviceRemoteDataSourceProvider = Provider<DeviceRemoteDataSource>((ref) {
  final openWrtClient = ref.watch(openWrtClientProvider);
  return DeviceRemoteDataSourceImpl(openWrtClient);
});

final deviceLocalDataSourceProvider = Provider<DeviceLocalDataSource>((ref) {
  final isar = ref.watch(isarServiceProvider);
  return DeviceLocalDataSourceImpl(isar);
});

final deviceRepositoryProvider = Provider<DeviceRepository>((ref) {
  final remote = ref.watch(deviceRemoteDataSourceProvider);
  final local = ref.watch(deviceLocalDataSourceProvider);
  return DeviceRepositoryImpl(
    remoteDataSource: remote,
    localDataSource: local,
  );
});

// --- Dashboard Providers ---
final dashboardRemoteDataSourceProvider = Provider<DashboardRemoteDataSource>((ref) {
  final client = ref.watch(apiClientProvider);
  return DashboardRemoteDataSourceImpl(client);
});

final dashboardLocalDataSourceProvider = Provider<DashboardLocalDataSource>((ref) {
  final isar = ref.watch(isarServiceProvider);
  return DashboardLocalDataSourceImpl(isar);
});

final dashboardRepositoryProvider = Provider<DashboardRepository>((ref) {
  final remote = ref.watch(dashboardRemoteDataSourceProvider);
  final local = ref.watch(dashboardLocalDataSourceProvider);
  return DashboardRepositoryImpl(
    remoteDataSource: remote,
    localDataSource: local,
  );
});

// --- Analytics Providers ---
final analyticsRepositoryProvider = Provider<AnalyticsRepository>((ref) {
  final isar = ref.watch(isarServiceProvider);
  return AnalyticsRepositoryImpl(isar);
});

// --- Settings Providers ---
final settingsRepositoryProvider = Provider<SettingsRepository>((ref) {
  final prefService = ref.watch(preferencesServiceProvider);
  final openWrt = ref.watch(openWrtClientProvider);
  final routerService = ref.watch(routerServiceProvider);
  return SettingsRepositoryImpl(
    preferencesService: prefService,
    openWrtClient: openWrt,
    routerService: routerService,
  );
});
