import 'package:isar_community/isar.dart';
import 'package:path_provider/path_provider.dart';
import 'entities/cached_device.dart';
import 'entities/cached_report.dart';
import 'entities/bandwidth_history_log.dart';

class IsarService {
  late final Isar _isar;
  bool _isInitialized = false;

  Isar get isar {
    if (!_isInitialized) {
      throw StateError('IsarService must be initialized before accessing isar instance');
    }
    return _isar;
  }

  Future<void> init() async {
    if (_isInitialized) return;

    final dir = await getApplicationDocumentsDirectory();
    _isar = await Isar.open(
      [
        CachedDeviceSchema,
        CachedReportSchema,
        BandwidthHistoryLogSchema,
      ],
      directory: dir.path,
      name: 'openwrt_quota_db',
    );
    _isInitialized = true;
  }

  // Fast cache accessor
  IsarCollection<CachedDevice> get devices => isar.cachedDevices;
  IsarCollection<CachedReport> get reports => isar.cachedReports;
  IsarCollection<BandwidthHistoryLog> get historyLogs => isar.bandwidthHistoryLogs;

  Future<void> clearCache() async {
    await isar.writeTxn(() async {
      await isar.clear();
    });
  }
}
