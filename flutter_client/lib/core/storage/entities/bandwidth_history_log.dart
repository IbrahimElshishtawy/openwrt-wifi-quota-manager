import 'package:isar_community/isar.dart';

part 'bandwidth_history_log.g.dart';

@collection
class BandwidthHistoryLog {
  Id id = Isar.autoIncrement;

  @Index()
  late DateTime timestamp;

  late double totalBandwidthUsedGb;
  late double packageTotalGb;
  late double packageRemainingGb;
  late int activeDevicesCount;
  late int blockedDevicesCount;
}
