import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:flutter_client/core/constants/api_endpoints.dart';
import 'package:flutter_client/core/network/api_client.dart';
import 'package:flutter_client/core/network/openwrt_client.dart';
import 'package:flutter_client/core/security/credential_storage.dart';
import 'package:flutter_client/core/storage/preferences_service.dart';
import 'package:flutter_client/core/utils/device_icon_resolver.dart';
import 'package:flutter_client/core/utils/formatters.dart';
import 'package:flutter_client/features/dashboard/domain/models/quota_report.dart';
import 'package:flutter_client/features/devices/domain/models/device_model.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late SharedPreferences prefs;
  late CredentialStorage credentialStorage;
  late PreferencesService preferencesService;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    prefs = await SharedPreferences.getInstance();
    credentialStorage = CredentialStorage(prefs);
    preferencesService = PreferencesService(prefs, credentialStorage);
  });

  group('Security & Credential Storage Tests', () {
    test('Credentials are encrypted and never stored in plain text', () async {
      const plainPassword = 'super_secret_router_pass_123';
      await credentialStorage.savePassword(plainPassword);

      // Verify SharedPreferences does NOT contain plain text
      final rawStored = prefs.getString('sec_cred_router_password');
      expect(rawStored, isNotNull);
      expect(rawStored, isNot(contains(plainPassword)));

      // Verify decrypted retrieval returns original password
      final decrypted = credentialStorage.getPassword();
      expect(decrypted, plainPassword);
    });

    test('API Token is encrypted and retrieved properly', () async {
      const plainToken = 'tok_bearer_openwrt_98765';
      await credentialStorage.saveApiKey(plainToken);

      final rawStored = prefs.getString('sec_cred_api_key');
      expect(rawStored, isNotNull);
      expect(rawStored, isNot(contains(plainToken)));

      final decrypted = credentialStorage.getApiKey();
      expect(decrypted, plainToken);
    });

    test('Credential redaction scrubs secrets from logs', () {
      expect(CredentialStorage.redact(''), '[EMPTY]');
      expect(CredentialStorage.redact(null), '[EMPTY]');
      expect(CredentialStorage.redact('123'), '***');
      expect(CredentialStorage.redact('secretPassword'), 'se***rd');
    });

    test('Clear credentials removes stored keys', () async {
      await credentialStorage.savePassword('pass');
      await credentialStorage.saveApiKey('key');

      await credentialStorage.clearAll();
      expect(credentialStorage.getPassword(), isEmpty);
      expect(credentialStorage.getApiKey(), isEmpty);
    });
  });

  group('URL and BaseUrl Normalization Tests', () {
    test('Normalizes various IP and protocol combinations cleanly', () {
      expect(
        ApiEndpoints.baseUrl('192.168.1.1', 8080, protocol: 'http'),
        'http://192.168.1.1:8080',
      );
      expect(
        ApiEndpoints.baseUrl('http://192.168.1.1', 8080, protocol: 'http'),
        'http://192.168.1.1:8080',
      );
      expect(
        ApiEndpoints.baseUrl('https://10.0.0.1:8080/', 8443, protocol: 'https'),
        'https://10.0.0.1:8443',
      );
      expect(
        ApiEndpoints.baseUrl('172.16.0.1/', 80, protocol: 'http'),
        'http://172.16.0.1:80',
      );
    });
  });

  group('Demo Mode vs Live Mode Isolation Tests', () {
    test('Demo Mode returns instant mock data without sending network requests', () async {
      await preferencesService.setDemoMode(true);
      final client = ApiClient(preferencesService: preferencesService);

      final health = await client.get(ApiEndpoints.health);
      expect(health['status'], 'ok');
      expect(health['service'], contains('Demo'));

      final devicesRes = await client.get(ApiEndpoints.devices);
      expect(devicesRes['status'], 'success');
      expect((devicesRes['devices'] as List).isNotEmpty, true);

      final report = await client.get(ApiEndpoints.reports);
      expect(report['status'], 'success');
      expect(report['package_total_gb'], isNotNull);
    });

    test('Demo Mode simulates block and unblock state', () async {
      await preferencesService.setDemoMode(true);
      final client = ApiClient(preferencesService: preferencesService);

      final blockRes = await client.post(ApiEndpoints.block, data: {'mac': 'AA:BB:CC:DD:EE:01'});
      expect(blockRes['status'], 'success');

      final unblockRes = await client.post(ApiEndpoints.unblock, data: {'mac': 'AA:BB:CC:DD:EE:01'});
      expect(unblockRes['status'], 'success');
    });
  });

  group('Device Model & Parsing Tests', () {
    test('Parses full OpenWrt device JSON with usage and quota metrics', () {
      final json = {
        'mac': '11:22:33:44:55:66',
        'name': 'Living Room Apple TV',
        'ip': '192.168.1.105',
        'hostname': 'Apple-TV-4K',
        'quota_gb': 50.0,
        'usage_gb': 42.5,
        'remaining_gb': 7.5,
        'enabled': true,
        'is_blocked': false,
      };

      final device = DeviceModel.fromJson(json);
      expect(device.mac, '11:22:33:44:55:66');
      expect(device.name, 'Living Room Apple TV');
      expect(device.ip, '192.168.1.105');
      expect(device.usageRatio, 0.85);
      expect(device.isNearLimit, true);
      expect(device.isOverQuota, false);
      expect(device.isBlocked, false);
    });

    test('Handles device with 0 quota gracefully without divide-by-zero', () {
      final device = DeviceModel.fromJson({
        'mac': 'AA:BB:CC:DD:EE:FF',
        'name': 'Unmetered Device',
        'quota_gb': 0.0,
        'usage_gb': 10.0,
      });

      expect(device.usageRatio, 0.0);
      expect(device.isNearLimit, false);
    });
  });

  group('Device Icon Resolver Tests', () {
    test('Detects device types accurately from name and hostname', () {
      expect(DeviceIconResolver.resolveType('iPhone 15 Pro', 'Ahmed-iPhone'), DeviceType.phone);
      expect(DeviceIconResolver.resolveType('Samsung Galaxy Tab', 'tab-sm-x'), DeviceType.tablet);
      expect(DeviceIconResolver.resolveType('MacBook Pro M3', 'MacBook-Pro.lan'), DeviceType.laptop);
      expect(DeviceIconResolver.resolveType('Sony Bravia OLED', 'bravia-4k'), DeviceType.tv);
      expect(DeviceIconResolver.resolveType('PlayStation 5', 'ps5-console'), DeviceType.gameConsole);
      expect(DeviceIconResolver.resolveType('Front Door Cam', 'ring-doorbell'), DeviceType.camera);
      expect(DeviceIconResolver.resolveType('OpenWrt Gateway', 'router.lan'), DeviceType.router);
      expect(DeviceIconResolver.resolveType('Generic Gizmo', 'unknown-host'), DeviceType.unknown);
    });
  });

  group('Formatters Unit Tests', () {
    test('Formats byte counters into human-readable units', () {
      expect(Formatters.formatBytes(500), '500 B');
      expect(Formatters.formatBytes(1536), '1.5 KB');
      expect(Formatters.formatBytes(52428800), '50.00 MB');
      expect(Formatters.formatBytes(5368709120), '5.00 GB');
    });

    test('Formats uptime in seconds into readable intervals', () {
      expect(Formatters.formatUptime(0), '0m');
      expect(Formatters.formatUptime(180), '3m');
      expect(Formatters.formatUptime(7320), '2h 2m');
      expect(Formatters.formatUptime(90000), '1d 1h 0m');
    });
  });

  group('Connection Test Diagnostic Tests', () {
    test('Detects invalid configuration before network dispatch', () async {
      await preferencesService.setRouterIp('');
      final client = OpenWrtClientImpl(
        apiClient: ApiClient(preferencesService: preferencesService),
        preferencesService: preferencesService,
      );

      final res = await client.testConnection();
      expect(res.status, ConnectionTestStatus.invalidConfiguration);
      expect(res.isSuccess, false);
      expect(res.message, contains('Router IP is empty'));
    });

    test('Detects invalid port range', () async {
      await preferencesService.setRouterIp('192.168.1.1');
      await preferencesService.setRouterPort(999999);
      final client = OpenWrtClientImpl(
        apiClient: ApiClient(preferencesService: preferencesService),
        preferencesService: preferencesService,
      );

      final res = await client.testConnection();
      expect(res.status, ConnectionTestStatus.invalidConfiguration);
      expect(res.isSuccess, false);
      expect(res.message, contains('Invalid port'));
    });

    test('Succeeds in Demo Mode with measured latency', () async {
      await preferencesService.setRouterIp('192.168.1.1');
      await preferencesService.setRouterPort(8080);
      await preferencesService.setDemoMode(true);

      final client = OpenWrtClientImpl(
        apiClient: ApiClient(preferencesService: preferencesService),
        preferencesService: preferencesService,
      );

      final res = await client.testConnection();
      expect(res.status, ConnectionTestStatus.connected);
      expect(res.isSuccess, true);
      expect(res.responseTimeMs, isNotNull);
    });
  });

  group('QuotaReport Calculations Tests', () {
    test('Calculates remaining quota and usage percentage correctly', () {
      final report = QuotaReport.fromJson({
        'total_bandwidth_used_gb': 150.0,
        'package_total_gb': 200.0,
        'package_remaining_gb': 50.0,
        'cycle_days_remaining': 12,
        'top_consumers': [
          {'mac': '11:22:33:44:55:66', 'name': 'PC', 'usage_gb': 80.0},
          {'mac': 'AA:BB:CC:DD:EE:FF', 'name': 'Phone', 'usage_gb': 70.0},
        ],
      });

      expect(report.totalBandwidthUsedGb, 150.0);
      expect(report.packageTotalGb, 200.0);
      expect(report.packageRemainingGb, 50.0);
      expect(report.usedRatio, 0.75);
      expect(report.usedPercentage, 75.0);
      expect(report.isNearLimit, false);
      expect(report.topConsumers.length, 2);
    });
  });
}
