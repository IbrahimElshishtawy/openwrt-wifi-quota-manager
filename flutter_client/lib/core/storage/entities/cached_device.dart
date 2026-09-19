import 'package:isar_community/isar.dart';

part 'cached_device.g.dart';

@collection
class CachedDevice {
  Id id = Isar.autoIncrement;

  @Index(unique: true, replace: true)
  late String mac;

  late String name;
  late String ip;
  late String hostname;
  late double usageGb;
  late double quotaGb;
  late double remainingGb;
  late bool enabled;
  late bool isBlocked;
  late DateTime lastUpdated;
}
