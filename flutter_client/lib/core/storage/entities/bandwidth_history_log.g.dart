// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'bandwidth_history_log.dart';

// **************************************************************************
// IsarCollectionGenerator
// **************************************************************************

// coverage:ignore-file
// ignore_for_file: duplicate_ignore, non_constant_identifier_names, constant_identifier_names, invalid_use_of_protected_member, unnecessary_cast, prefer_const_constructors, lines_longer_than_80_chars, require_trailing_commas, inference_failure_on_function_invocation, unnecessary_parenthesis, unnecessary_raw_strings, unnecessary_null_checks, join_return_with_assignment, prefer_final_locals, avoid_js_rounded_ints, avoid_positional_boolean_parameters, always_specify_types

extension GetBandwidthHistoryLogCollection on Isar {
  IsarCollection<BandwidthHistoryLog> get bandwidthHistoryLogs =>
      this.collection();
}

const BandwidthHistoryLogSchema = CollectionSchema(
  name: r'BandwidthHistoryLog',
  id: 5047028765040418572,
  properties: {
    r'activeDevicesCount': PropertySchema(
      id: 0,
      name: r'activeDevicesCount',
      type: IsarType.long,
    ),
    r'blockedDevicesCount': PropertySchema(
      id: 1,
      name: r'blockedDevicesCount',
      type: IsarType.long,
    ),
    r'packageRemainingGb': PropertySchema(
      id: 2,
      name: r'packageRemainingGb',
      type: IsarType.double,
    ),
    r'packageTotalGb': PropertySchema(
      id: 3,
      name: r'packageTotalGb',
      type: IsarType.double,
    ),
    r'timestamp': PropertySchema(
      id: 4,
      name: r'timestamp',
      type: IsarType.dateTime,
    ),
    r'totalBandwidthUsedGb': PropertySchema(
      id: 5,
      name: r'totalBandwidthUsedGb',
      type: IsarType.double,
    ),
  },

  estimateSize: _bandwidthHistoryLogEstimateSize,
  serialize: _bandwidthHistoryLogSerialize,
  deserialize: _bandwidthHistoryLogDeserialize,
  deserializeProp: _bandwidthHistoryLogDeserializeProp,
  idName: r'id',
  indexes: {
    r'timestamp': IndexSchema(
      id: 1852253767416892198,
      name: r'timestamp',
      unique: false,
      replace: false,
      properties: [
        IndexPropertySchema(
          name: r'timestamp',
          type: IndexType.value,
          caseSensitive: false,
        ),
      ],
    ),
  },
  links: {},
  embeddedSchemas: {},

  getId: _bandwidthHistoryLogGetId,
  getLinks: _bandwidthHistoryLogGetLinks,
  attach: _bandwidthHistoryLogAttach,
  version: '3.3.2',
);

int _bandwidthHistoryLogEstimateSize(
  BandwidthHistoryLog object,
  List<int> offsets,
  Map<Type, List<int>> allOffsets,
) {
  var bytesCount = offsets.last;
  return bytesCount;
}

void _bandwidthHistoryLogSerialize(
  BandwidthHistoryLog object,
  IsarWriter writer,
  List<int> offsets,
  Map<Type, List<int>> allOffsets,
) {
  writer.writeLong(offsets[0], object.activeDevicesCount);
  writer.writeLong(offsets[1], object.blockedDevicesCount);
  writer.writeDouble(offsets[2], object.packageRemainingGb);
  writer.writeDouble(offsets[3], object.packageTotalGb);
  writer.writeDateTime(offsets[4], object.timestamp);
  writer.writeDouble(offsets[5], object.totalBandwidthUsedGb);
}

BandwidthHistoryLog _bandwidthHistoryLogDeserialize(
  Id id,
  IsarReader reader,
  List<int> offsets,
  Map<Type, List<int>> allOffsets,
) {
  final object = BandwidthHistoryLog();
  object.activeDevicesCount = reader.readLong(offsets[0]);
  object.blockedDevicesCount = reader.readLong(offsets[1]);
  object.id = id;
  object.packageRemainingGb = reader.readDouble(offsets[2]);
  object.packageTotalGb = reader.readDouble(offsets[3]);
  object.timestamp = reader.readDateTime(offsets[4]);
  object.totalBandwidthUsedGb = reader.readDouble(offsets[5]);
  return object;
}

P _bandwidthHistoryLogDeserializeProp<P>(
  IsarReader reader,
  int propertyId,
  int offset,
  Map<Type, List<int>> allOffsets,
) {
  switch (propertyId) {
    case 0:
      return (reader.readLong(offset)) as P;
    case 1:
      return (reader.readLong(offset)) as P;
    case 2:
      return (reader.readDouble(offset)) as P;
    case 3:
      return (reader.readDouble(offset)) as P;
    case 4:
      return (reader.readDateTime(offset)) as P;
    case 5:
      return (reader.readDouble(offset)) as P;
    default:
      throw IsarError('Unknown property with id $propertyId');
  }
}

Id _bandwidthHistoryLogGetId(BandwidthHistoryLog object) {
  return object.id;
}

List<IsarLinkBase<dynamic>> _bandwidthHistoryLogGetLinks(
  BandwidthHistoryLog object,
) {
  return [];
}

void _bandwidthHistoryLogAttach(
  IsarCollection<dynamic> col,
  Id id,
  BandwidthHistoryLog object,
) {
  object.id = id;
}

extension BandwidthHistoryLogQueryWhereSort
    on QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QWhere> {
  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterWhere> anyId() {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(const IdWhereClause.any());
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterWhere>
  anyTimestamp() {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(
        const IndexWhereClause.any(indexName: r'timestamp'),
      );
    });
  }
}

extension BandwidthHistoryLogQueryWhere
    on QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QWhereClause> {
  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterWhereClause>
  idEqualTo(Id id) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IdWhereClause.between(lower: id, upper: id));
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterWhereClause>
  idNotEqualTo(Id id) {
    return QueryBuilder.apply(this, (query) {
      if (query.whereSort == Sort.asc) {
        return query
            .addWhereClause(
              IdWhereClause.lessThan(upper: id, includeUpper: false),
            )
            .addWhereClause(
              IdWhereClause.greaterThan(lower: id, includeLower: false),
            );
      } else {
        return query
            .addWhereClause(
              IdWhereClause.greaterThan(lower: id, includeLower: false),
            )
            .addWhereClause(
              IdWhereClause.lessThan(upper: id, includeUpper: false),
            );
      }
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterWhereClause>
  idGreaterThan(Id id, {bool include = false}) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(
        IdWhereClause.greaterThan(lower: id, includeLower: include),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterWhereClause>
  idLessThan(Id id, {bool include = false}) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(
        IdWhereClause.lessThan(upper: id, includeUpper: include),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterWhereClause>
  idBetween(
    Id lowerId,
    Id upperId, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(
        IdWhereClause.between(
          lower: lowerId,
          includeLower: includeLower,
          upper: upperId,
          includeUpper: includeUpper,
        ),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterWhereClause>
  timestampEqualTo(DateTime timestamp) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(
        IndexWhereClause.equalTo(indexName: r'timestamp', value: [timestamp]),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterWhereClause>
  timestampNotEqualTo(DateTime timestamp) {
    return QueryBuilder.apply(this, (query) {
      if (query.whereSort == Sort.asc) {
        return query
            .addWhereClause(
              IndexWhereClause.between(
                indexName: r'timestamp',
                lower: [],
                upper: [timestamp],
                includeUpper: false,
              ),
            )
            .addWhereClause(
              IndexWhereClause.between(
                indexName: r'timestamp',
                lower: [timestamp],
                includeLower: false,
                upper: [],
              ),
            );
      } else {
        return query
            .addWhereClause(
              IndexWhereClause.between(
                indexName: r'timestamp',
                lower: [timestamp],
                includeLower: false,
                upper: [],
              ),
            )
            .addWhereClause(
              IndexWhereClause.between(
                indexName: r'timestamp',
                lower: [],
                upper: [timestamp],
                includeUpper: false,
              ),
            );
      }
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterWhereClause>
  timestampGreaterThan(DateTime timestamp, {bool include = false}) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(
        IndexWhereClause.between(
          indexName: r'timestamp',
          lower: [timestamp],
          includeLower: include,
          upper: [],
        ),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterWhereClause>
  timestampLessThan(DateTime timestamp, {bool include = false}) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(
        IndexWhereClause.between(
          indexName: r'timestamp',
          lower: [],
          upper: [timestamp],
          includeUpper: include,
        ),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterWhereClause>
  timestampBetween(
    DateTime lowerTimestamp,
    DateTime upperTimestamp, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(
        IndexWhereClause.between(
          indexName: r'timestamp',
          lower: [lowerTimestamp],
          includeLower: includeLower,
          upper: [upperTimestamp],
          includeUpper: includeUpper,
        ),
      );
    });
  }
}

extension BandwidthHistoryLogQueryFilter
    on
        QueryBuilder<
          BandwidthHistoryLog,
          BandwidthHistoryLog,
          QFilterCondition
        > {
  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterFilterCondition>
  activeDevicesCountEqualTo(int value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.equalTo(property: r'activeDevicesCount', value: value),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterFilterCondition>
  activeDevicesCountGreaterThan(int value, {bool include = false}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.greaterThan(
          include: include,
          property: r'activeDevicesCount',
          value: value,
        ),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterFilterCondition>
  activeDevicesCountLessThan(int value, {bool include = false}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.lessThan(
          include: include,
          property: r'activeDevicesCount',
          value: value,
        ),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterFilterCondition>
  activeDevicesCountBetween(
    int lower,
    int upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.between(
          property: r'activeDevicesCount',
          lower: lower,
          includeLower: includeLower,
          upper: upper,
          includeUpper: includeUpper,
        ),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterFilterCondition>
  blockedDevicesCountEqualTo(int value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.equalTo(property: r'blockedDevicesCount', value: value),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterFilterCondition>
  blockedDevicesCountGreaterThan(int value, {bool include = false}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.greaterThan(
          include: include,
          property: r'blockedDevicesCount',
          value: value,
        ),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterFilterCondition>
  blockedDevicesCountLessThan(int value, {bool include = false}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.lessThan(
          include: include,
          property: r'blockedDevicesCount',
          value: value,
        ),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterFilterCondition>
  blockedDevicesCountBetween(
    int lower,
    int upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.between(
          property: r'blockedDevicesCount',
          lower: lower,
          includeLower: includeLower,
          upper: upper,
          includeUpper: includeUpper,
        ),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterFilterCondition>
  idEqualTo(Id value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.equalTo(property: r'id', value: value),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterFilterCondition>
  idGreaterThan(Id value, {bool include = false}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.greaterThan(
          include: include,
          property: r'id',
          value: value,
        ),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterFilterCondition>
  idLessThan(Id value, {bool include = false}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.lessThan(
          include: include,
          property: r'id',
          value: value,
        ),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterFilterCondition>
  idBetween(
    Id lower,
    Id upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.between(
          property: r'id',
          lower: lower,
          includeLower: includeLower,
          upper: upper,
          includeUpper: includeUpper,
        ),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterFilterCondition>
  packageRemainingGbEqualTo(double value, {double epsilon = Query.epsilon}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.equalTo(
          property: r'packageRemainingGb',
          value: value,

          epsilon: epsilon,
        ),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterFilterCondition>
  packageRemainingGbGreaterThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.greaterThan(
          include: include,
          property: r'packageRemainingGb',
          value: value,

          epsilon: epsilon,
        ),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterFilterCondition>
  packageRemainingGbLessThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.lessThan(
          include: include,
          property: r'packageRemainingGb',
          value: value,

          epsilon: epsilon,
        ),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterFilterCondition>
  packageRemainingGbBetween(
    double lower,
    double upper, {
    bool includeLower = true,
    bool includeUpper = true,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.between(
          property: r'packageRemainingGb',
          lower: lower,
          includeLower: includeLower,
          upper: upper,
          includeUpper: includeUpper,

          epsilon: epsilon,
        ),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterFilterCondition>
  packageTotalGbEqualTo(double value, {double epsilon = Query.epsilon}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.equalTo(
          property: r'packageTotalGb',
          value: value,

          epsilon: epsilon,
        ),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterFilterCondition>
  packageTotalGbGreaterThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.greaterThan(
          include: include,
          property: r'packageTotalGb',
          value: value,

          epsilon: epsilon,
        ),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterFilterCondition>
  packageTotalGbLessThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.lessThan(
          include: include,
          property: r'packageTotalGb',
          value: value,

          epsilon: epsilon,
        ),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterFilterCondition>
  packageTotalGbBetween(
    double lower,
    double upper, {
    bool includeLower = true,
    bool includeUpper = true,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.between(
          property: r'packageTotalGb',
          lower: lower,
          includeLower: includeLower,
          upper: upper,
          includeUpper: includeUpper,

          epsilon: epsilon,
        ),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterFilterCondition>
  timestampEqualTo(DateTime value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.equalTo(property: r'timestamp', value: value),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterFilterCondition>
  timestampGreaterThan(DateTime value, {bool include = false}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.greaterThan(
          include: include,
          property: r'timestamp',
          value: value,
        ),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterFilterCondition>
  timestampLessThan(DateTime value, {bool include = false}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.lessThan(
          include: include,
          property: r'timestamp',
          value: value,
        ),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterFilterCondition>
  timestampBetween(
    DateTime lower,
    DateTime upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.between(
          property: r'timestamp',
          lower: lower,
          includeLower: includeLower,
          upper: upper,
          includeUpper: includeUpper,
        ),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterFilterCondition>
  totalBandwidthUsedGbEqualTo(double value, {double epsilon = Query.epsilon}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.equalTo(
          property: r'totalBandwidthUsedGb',
          value: value,

          epsilon: epsilon,
        ),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterFilterCondition>
  totalBandwidthUsedGbGreaterThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.greaterThan(
          include: include,
          property: r'totalBandwidthUsedGb',
          value: value,

          epsilon: epsilon,
        ),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterFilterCondition>
  totalBandwidthUsedGbLessThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.lessThan(
          include: include,
          property: r'totalBandwidthUsedGb',
          value: value,

          epsilon: epsilon,
        ),
      );
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterFilterCondition>
  totalBandwidthUsedGbBetween(
    double lower,
    double upper, {
    bool includeLower = true,
    bool includeUpper = true,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.between(
          property: r'totalBandwidthUsedGb',
          lower: lower,
          includeLower: includeLower,
          upper: upper,
          includeUpper: includeUpper,

          epsilon: epsilon,
        ),
      );
    });
  }
}

extension BandwidthHistoryLogQueryObject
    on
        QueryBuilder<
          BandwidthHistoryLog,
          BandwidthHistoryLog,
          QFilterCondition
        > {}

extension BandwidthHistoryLogQueryLinks
    on
        QueryBuilder<
          BandwidthHistoryLog,
          BandwidthHistoryLog,
          QFilterCondition
        > {}

extension BandwidthHistoryLogQuerySortBy
    on QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QSortBy> {
  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterSortBy>
  sortByActiveDevicesCount() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'activeDevicesCount', Sort.asc);
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterSortBy>
  sortByActiveDevicesCountDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'activeDevicesCount', Sort.desc);
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterSortBy>
  sortByBlockedDevicesCount() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'blockedDevicesCount', Sort.asc);
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterSortBy>
  sortByBlockedDevicesCountDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'blockedDevicesCount', Sort.desc);
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterSortBy>
  sortByPackageRemainingGb() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'packageRemainingGb', Sort.asc);
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterSortBy>
  sortByPackageRemainingGbDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'packageRemainingGb', Sort.desc);
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterSortBy>
  sortByPackageTotalGb() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'packageTotalGb', Sort.asc);
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterSortBy>
  sortByPackageTotalGbDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'packageTotalGb', Sort.desc);
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterSortBy>
  sortByTimestamp() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'timestamp', Sort.asc);
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterSortBy>
  sortByTimestampDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'timestamp', Sort.desc);
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterSortBy>
  sortByTotalBandwidthUsedGb() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'totalBandwidthUsedGb', Sort.asc);
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterSortBy>
  sortByTotalBandwidthUsedGbDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'totalBandwidthUsedGb', Sort.desc);
    });
  }
}

extension BandwidthHistoryLogQuerySortThenBy
    on QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QSortThenBy> {
  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterSortBy>
  thenByActiveDevicesCount() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'activeDevicesCount', Sort.asc);
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterSortBy>
  thenByActiveDevicesCountDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'activeDevicesCount', Sort.desc);
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterSortBy>
  thenByBlockedDevicesCount() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'blockedDevicesCount', Sort.asc);
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterSortBy>
  thenByBlockedDevicesCountDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'blockedDevicesCount', Sort.desc);
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterSortBy>
  thenById() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'id', Sort.asc);
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterSortBy>
  thenByIdDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'id', Sort.desc);
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterSortBy>
  thenByPackageRemainingGb() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'packageRemainingGb', Sort.asc);
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterSortBy>
  thenByPackageRemainingGbDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'packageRemainingGb', Sort.desc);
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterSortBy>
  thenByPackageTotalGb() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'packageTotalGb', Sort.asc);
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterSortBy>
  thenByPackageTotalGbDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'packageTotalGb', Sort.desc);
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterSortBy>
  thenByTimestamp() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'timestamp', Sort.asc);
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterSortBy>
  thenByTimestampDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'timestamp', Sort.desc);
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterSortBy>
  thenByTotalBandwidthUsedGb() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'totalBandwidthUsedGb', Sort.asc);
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QAfterSortBy>
  thenByTotalBandwidthUsedGbDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'totalBandwidthUsedGb', Sort.desc);
    });
  }
}

extension BandwidthHistoryLogQueryWhereDistinct
    on QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QDistinct> {
  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QDistinct>
  distinctByActiveDevicesCount() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'activeDevicesCount');
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QDistinct>
  distinctByBlockedDevicesCount() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'blockedDevicesCount');
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QDistinct>
  distinctByPackageRemainingGb() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'packageRemainingGb');
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QDistinct>
  distinctByPackageTotalGb() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'packageTotalGb');
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QDistinct>
  distinctByTimestamp() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'timestamp');
    });
  }

  QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QDistinct>
  distinctByTotalBandwidthUsedGb() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'totalBandwidthUsedGb');
    });
  }
}

extension BandwidthHistoryLogQueryProperty
    on QueryBuilder<BandwidthHistoryLog, BandwidthHistoryLog, QQueryProperty> {
  QueryBuilder<BandwidthHistoryLog, int, QQueryOperations> idProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'id');
    });
  }

  QueryBuilder<BandwidthHistoryLog, int, QQueryOperations>
  activeDevicesCountProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'activeDevicesCount');
    });
  }

  QueryBuilder<BandwidthHistoryLog, int, QQueryOperations>
  blockedDevicesCountProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'blockedDevicesCount');
    });
  }

  QueryBuilder<BandwidthHistoryLog, double, QQueryOperations>
  packageRemainingGbProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'packageRemainingGb');
    });
  }

  QueryBuilder<BandwidthHistoryLog, double, QQueryOperations>
  packageTotalGbProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'packageTotalGb');
    });
  }

  QueryBuilder<BandwidthHistoryLog, DateTime, QQueryOperations>
  timestampProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'timestamp');
    });
  }

  QueryBuilder<BandwidthHistoryLog, double, QQueryOperations>
  totalBandwidthUsedGbProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'totalBandwidthUsedGb');
    });
  }
}
