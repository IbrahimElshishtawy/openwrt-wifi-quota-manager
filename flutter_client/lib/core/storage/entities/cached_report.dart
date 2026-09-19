import 'package:isar_community/isar.dart';

part 'cached_report.g.dart';

@collection
class CachedReport {
  Id id = Isar.autoIncrement;

  late double totalBandwidthUsedGb;
  late double packageTotalGb;
  late double packageRemainingGb;
  late int cycleDaysRemaining;
  late DateTime lastUpdated;
  late String topConsumersJson;
}
