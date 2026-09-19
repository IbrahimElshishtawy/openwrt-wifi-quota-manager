// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'cached_report.dart';

// **************************************************************************
// IsarCollectionGenerator
// **************************************************************************

// coverage:ignore-file
// ignore_for_file: duplicate_ignore, non_constant_identifier_names, constant_identifier_names, invalid_use_of_protected_member, unnecessary_cast, prefer_const_constructors, lines_longer_than_80_chars, require_trailing_commas, inference_failure_on_function_invocation, unnecessary_parenthesis, unnecessary_raw_strings, unnecessary_null_checks, join_return_with_assignment, prefer_final_locals, avoid_js_rounded_ints, avoid_positional_boolean_parameters, always_specify_types

extension GetCachedReportCollection on Isar {
  IsarCollection<CachedReport> get cachedReports => this.collection();
}

const CachedReportSchema = CollectionSchema(
  name: r'CachedReport',
  id: -3687000540060571535,
  properties: {
    r'cycleDaysRemaining': PropertySchema(
      id: 0,
      name: r'cycleDaysRemaining',
      type: IsarType.long,
    ),
    r'lastUpdated': PropertySchema(
      id: 1,
      name: r'lastUpdated',
      type: IsarType.dateTime,
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
    r'topConsumersJson': PropertySchema(
      id: 4,
      name: r'topConsumersJson',
      type: IsarType.string,
    ),
    r'totalBandwidthUsedGb': PropertySchema(
      id: 5,
      name: r'totalBandwidthUsedGb',
      type: IsarType.double,
    ),
  },

  estimateSize: _cachedReportEstimateSize,
  serialize: _cachedReportSerialize,
  deserialize: _cachedReportDeserialize,
  deserializeProp: _cachedReportDeserializeProp,
  idName: r'id',
  indexes: {},
  links: {},
  embeddedSchemas: {},

  getId: _cachedReportGetId,
  getLinks: _cachedReportGetLinks,
  attach: _cachedReportAttach,
  version: '3.3.2',
);

int _cachedReportEstimateSize(
  CachedReport object,
  List<int> offsets,
  Map<Type, List<int>> allOffsets,
) {
  var bytesCount = offsets.last;
  bytesCount += 3 + object.topConsumersJson.length * 3;
  return bytesCount;
}

void _cachedReportSerialize(
  CachedReport object,
  IsarWriter writer,
  List<int> offsets,
  Map<Type, List<int>> allOffsets,
) {
  writer.writeLong(offsets[0], object.cycleDaysRemaining);
  writer.writeDateTime(offsets[1], object.lastUpdated);
  writer.writeDouble(offsets[2], object.packageRemainingGb);
  writer.writeDouble(offsets[3], object.packageTotalGb);
  writer.writeString(offsets[4], object.topConsumersJson);
  writer.writeDouble(offsets[5], object.totalBandwidthUsedGb);
}

CachedReport _cachedReportDeserialize(
  Id id,
  IsarReader reader,
  List<int> offsets,
  Map<Type, List<int>> allOffsets,
) {
  final object = CachedReport();
  object.cycleDaysRemaining = reader.readLong(offsets[0]);
  object.id = id;
  object.lastUpdated = reader.readDateTime(offsets[1]);
  object.packageRemainingGb = reader.readDouble(offsets[2]);
  object.packageTotalGb = reader.readDouble(offsets[3]);
  object.topConsumersJson = reader.readString(offsets[4]);
  object.totalBandwidthUsedGb = reader.readDouble(offsets[5]);
  return object;
}

P _cachedReportDeserializeProp<P>(
  IsarReader reader,
  int propertyId,
  int offset,
  Map<Type, List<int>> allOffsets,
) {
  switch (propertyId) {
    case 0:
      return (reader.readLong(offset)) as P;
    case 1:
      return (reader.readDateTime(offset)) as P;
    case 2:
      return (reader.readDouble(offset)) as P;
    case 3:
      return (reader.readDouble(offset)) as P;
    case 4:
      return (reader.readString(offset)) as P;
    case 5:
      return (reader.readDouble(offset)) as P;
    default:
      throw IsarError('Unknown property with id $propertyId');
  }
}

Id _cachedReportGetId(CachedReport object) {
  return object.id;
}

List<IsarLinkBase<dynamic>> _cachedReportGetLinks(CachedReport object) {
  return [];
}

void _cachedReportAttach(
  IsarCollection<dynamic> col,
  Id id,
  CachedReport object,
) {
  object.id = id;
}

extension CachedReportQueryWhereSort
    on QueryBuilder<CachedReport, CachedReport, QWhere> {
  QueryBuilder<CachedReport, CachedReport, QAfterWhere> anyId() {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(const IdWhereClause.any());
    });
  }
}

extension CachedReportQueryWhere
    on QueryBuilder<CachedReport, CachedReport, QWhereClause> {
  QueryBuilder<CachedReport, CachedReport, QAfterWhereClause> idEqualTo(Id id) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IdWhereClause.between(lower: id, upper: id));
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterWhereClause> idNotEqualTo(
    Id id,
  ) {
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

  QueryBuilder<CachedReport, CachedReport, QAfterWhereClause> idGreaterThan(
    Id id, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(
        IdWhereClause.greaterThan(lower: id, includeLower: include),
      );
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterWhereClause> idLessThan(
    Id id, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(
        IdWhereClause.lessThan(upper: id, includeUpper: include),
      );
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterWhereClause> idBetween(
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
}

extension CachedReportQueryFilter
    on QueryBuilder<CachedReport, CachedReport, QFilterCondition> {
  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition>
  cycleDaysRemainingEqualTo(int value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.equalTo(property: r'cycleDaysRemaining', value: value),
      );
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition>
  cycleDaysRemainingGreaterThan(int value, {bool include = false}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.greaterThan(
          include: include,
          property: r'cycleDaysRemaining',
          value: value,
        ),
      );
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition>
  cycleDaysRemainingLessThan(int value, {bool include = false}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.lessThan(
          include: include,
          property: r'cycleDaysRemaining',
          value: value,
        ),
      );
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition>
  cycleDaysRemainingBetween(
    int lower,
    int upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.between(
          property: r'cycleDaysRemaining',
          lower: lower,
          includeLower: includeLower,
          upper: upper,
          includeUpper: includeUpper,
        ),
      );
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition> idEqualTo(
    Id value,
  ) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.equalTo(property: r'id', value: value),
      );
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition> idGreaterThan(
    Id value, {
    bool include = false,
  }) {
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

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition> idLessThan(
    Id value, {
    bool include = false,
  }) {
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

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition> idBetween(
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

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition>
  lastUpdatedEqualTo(DateTime value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.equalTo(property: r'lastUpdated', value: value),
      );
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition>
  lastUpdatedGreaterThan(DateTime value, {bool include = false}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.greaterThan(
          include: include,
          property: r'lastUpdated',
          value: value,
        ),
      );
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition>
  lastUpdatedLessThan(DateTime value, {bool include = false}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.lessThan(
          include: include,
          property: r'lastUpdated',
          value: value,
        ),
      );
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition>
  lastUpdatedBetween(
    DateTime lower,
    DateTime upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.between(
          property: r'lastUpdated',
          lower: lower,
          includeLower: includeLower,
          upper: upper,
          includeUpper: includeUpper,
        ),
      );
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition>
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

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition>
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

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition>
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

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition>
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

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition>
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

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition>
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

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition>
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

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition>
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

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition>
  topConsumersJsonEqualTo(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.equalTo(
          property: r'topConsumersJson',
          value: value,
          caseSensitive: caseSensitive,
        ),
      );
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition>
  topConsumersJsonGreaterThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.greaterThan(
          include: include,
          property: r'topConsumersJson',
          value: value,
          caseSensitive: caseSensitive,
        ),
      );
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition>
  topConsumersJsonLessThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.lessThan(
          include: include,
          property: r'topConsumersJson',
          value: value,
          caseSensitive: caseSensitive,
        ),
      );
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition>
  topConsumersJsonBetween(
    String lower,
    String upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.between(
          property: r'topConsumersJson',
          lower: lower,
          includeLower: includeLower,
          upper: upper,
          includeUpper: includeUpper,
          caseSensitive: caseSensitive,
        ),
      );
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition>
  topConsumersJsonStartsWith(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.startsWith(
          property: r'topConsumersJson',
          value: value,
          caseSensitive: caseSensitive,
        ),
      );
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition>
  topConsumersJsonEndsWith(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.endsWith(
          property: r'topConsumersJson',
          value: value,
          caseSensitive: caseSensitive,
        ),
      );
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition>
  topConsumersJsonContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.contains(
          property: r'topConsumersJson',
          value: value,
          caseSensitive: caseSensitive,
        ),
      );
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition>
  topConsumersJsonMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.matches(
          property: r'topConsumersJson',
          wildcard: pattern,
          caseSensitive: caseSensitive,
        ),
      );
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition>
  topConsumersJsonIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.equalTo(property: r'topConsumersJson', value: ''),
      );
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition>
  topConsumersJsonIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(
        FilterCondition.greaterThan(property: r'topConsumersJson', value: ''),
      );
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition>
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

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition>
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

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition>
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

  QueryBuilder<CachedReport, CachedReport, QAfterFilterCondition>
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

extension CachedReportQueryObject
    on QueryBuilder<CachedReport, CachedReport, QFilterCondition> {}

extension CachedReportQueryLinks
    on QueryBuilder<CachedReport, CachedReport, QFilterCondition> {}

extension CachedReportQuerySortBy
    on QueryBuilder<CachedReport, CachedReport, QSortBy> {
  QueryBuilder<CachedReport, CachedReport, QAfterSortBy>
  sortByCycleDaysRemaining() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cycleDaysRemaining', Sort.asc);
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterSortBy>
  sortByCycleDaysRemainingDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cycleDaysRemaining', Sort.desc);
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterSortBy> sortByLastUpdated() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'lastUpdated', Sort.asc);
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterSortBy>
  sortByLastUpdatedDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'lastUpdated', Sort.desc);
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterSortBy>
  sortByPackageRemainingGb() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'packageRemainingGb', Sort.asc);
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterSortBy>
  sortByPackageRemainingGbDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'packageRemainingGb', Sort.desc);
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterSortBy>
  sortByPackageTotalGb() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'packageTotalGb', Sort.asc);
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterSortBy>
  sortByPackageTotalGbDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'packageTotalGb', Sort.desc);
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterSortBy>
  sortByTopConsumersJson() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'topConsumersJson', Sort.asc);
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterSortBy>
  sortByTopConsumersJsonDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'topConsumersJson', Sort.desc);
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterSortBy>
  sortByTotalBandwidthUsedGb() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'totalBandwidthUsedGb', Sort.asc);
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterSortBy>
  sortByTotalBandwidthUsedGbDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'totalBandwidthUsedGb', Sort.desc);
    });
  }
}

extension CachedReportQuerySortThenBy
    on QueryBuilder<CachedReport, CachedReport, QSortThenBy> {
  QueryBuilder<CachedReport, CachedReport, QAfterSortBy>
  thenByCycleDaysRemaining() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cycleDaysRemaining', Sort.asc);
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterSortBy>
  thenByCycleDaysRemainingDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cycleDaysRemaining', Sort.desc);
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterSortBy> thenById() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'id', Sort.asc);
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterSortBy> thenByIdDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'id', Sort.desc);
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterSortBy> thenByLastUpdated() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'lastUpdated', Sort.asc);
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterSortBy>
  thenByLastUpdatedDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'lastUpdated', Sort.desc);
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterSortBy>
  thenByPackageRemainingGb() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'packageRemainingGb', Sort.asc);
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterSortBy>
  thenByPackageRemainingGbDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'packageRemainingGb', Sort.desc);
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterSortBy>
  thenByPackageTotalGb() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'packageTotalGb', Sort.asc);
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterSortBy>
  thenByPackageTotalGbDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'packageTotalGb', Sort.desc);
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterSortBy>
  thenByTopConsumersJson() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'topConsumersJson', Sort.asc);
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterSortBy>
  thenByTopConsumersJsonDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'topConsumersJson', Sort.desc);
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterSortBy>
  thenByTotalBandwidthUsedGb() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'totalBandwidthUsedGb', Sort.asc);
    });
  }

  QueryBuilder<CachedReport, CachedReport, QAfterSortBy>
  thenByTotalBandwidthUsedGbDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'totalBandwidthUsedGb', Sort.desc);
    });
  }
}

extension CachedReportQueryWhereDistinct
    on QueryBuilder<CachedReport, CachedReport, QDistinct> {
  QueryBuilder<CachedReport, CachedReport, QDistinct>
  distinctByCycleDaysRemaining() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'cycleDaysRemaining');
    });
  }

  QueryBuilder<CachedReport, CachedReport, QDistinct> distinctByLastUpdated() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'lastUpdated');
    });
  }

  QueryBuilder<CachedReport, CachedReport, QDistinct>
  distinctByPackageRemainingGb() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'packageRemainingGb');
    });
  }

  QueryBuilder<CachedReport, CachedReport, QDistinct>
  distinctByPackageTotalGb() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'packageTotalGb');
    });
  }

  QueryBuilder<CachedReport, CachedReport, QDistinct>
  distinctByTopConsumersJson({bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(
        r'topConsumersJson',
        caseSensitive: caseSensitive,
      );
    });
  }

  QueryBuilder<CachedReport, CachedReport, QDistinct>
  distinctByTotalBandwidthUsedGb() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'totalBandwidthUsedGb');
    });
  }
}

extension CachedReportQueryProperty
    on QueryBuilder<CachedReport, CachedReport, QQueryProperty> {
  QueryBuilder<CachedReport, int, QQueryOperations> idProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'id');
    });
  }

  QueryBuilder<CachedReport, int, QQueryOperations>
  cycleDaysRemainingProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'cycleDaysRemaining');
    });
  }

  QueryBuilder<CachedReport, DateTime, QQueryOperations> lastUpdatedProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'lastUpdated');
    });
  }

  QueryBuilder<CachedReport, double, QQueryOperations>
  packageRemainingGbProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'packageRemainingGb');
    });
  }

  QueryBuilder<CachedReport, double, QQueryOperations>
  packageTotalGbProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'packageTotalGb');
    });
  }

  QueryBuilder<CachedReport, String, QQueryOperations>
  topConsumersJsonProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'topConsumersJson');
    });
  }

  QueryBuilder<CachedReport, double, QQueryOperations>
  totalBandwidthUsedGbProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'totalBandwidthUsedGb');
    });
  }
}
