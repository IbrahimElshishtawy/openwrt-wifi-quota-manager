import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_client/features/dashboard/domain/models/quota_report.dart';
import 'package:flutter_client/features/devices/domain/models/device_model.dart';

void main() {
  group('OpenWrt Quota Domain Tests', () {
    test('DeviceModel correctly calculates usage ratio and quota state', () {
      final device = DeviceModel.fromJson({
        'mac': 'AA:BB:CC:DD:EE:FF',
        'name': 'Ahmed Phone',
        'ip': '192.168.1.150',
        'hostname': 'Ahmed-iPhone',
        'usage_gb': 18.0,
        'quota_gb': 20.0,
        'remaining_gb': 2.0,
        'enabled': true,
        'is_blocked': false,
      });

      expect(device.name, 'Ahmed Phone');
      expect(device.usageRatio, 0.9);
      expect(device.isNearLimit, true);
      expect(device.isOverQuota, false);
    });

    test('QuotaReport correctly parses API JSON and calculations', () {
      final report = QuotaReport.fromJson({
        'status': 'success',
        'total_bandwidth_used_gb': 125.0,
        'package_total_gb': 250.0,
        'package_remaining_gb': 125.0,
        'cycle_days_remaining': 14,
        'top_consumers': [
          {'mac': '11:22:33:44:55:66', 'name': 'TV', 'usage_gb': 50.0}
        ],
      });

      expect(report.usedPercentage, 50.0);
      expect(report.usedRatio, 0.5);
      expect(report.cycleDaysRemaining, 14);
      expect(report.topConsumers.length, 1);
      expect(report.topConsumers.first.name, 'TV');
    });
  });
}
