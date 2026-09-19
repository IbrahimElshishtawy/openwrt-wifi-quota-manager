import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_client/features/analytics/domain/models/usage_history_record.dart';
import 'package:flutter_client/features/analytics/domain/repositories/analytics_repository.dart';
import 'package:flutter_client/features/analytics/presentation/controllers/analytics_controller.dart';
import 'package:flutter_client/features/analytics/presentation/screens/analytics_screen.dart';
import 'package:flutter_client/features/analytics/presentation/widgets/usage_chart.dart';

void main() {
  final now = DateTime.now();
  final sample7Days = List.generate(7, (i) {
    return UsageHistoryRecord(
      timestamp: now.subtract(Duration(days: 6 - i)),
      totalBandwidthUsedGb: 45.0 + (i * 12.5),
      packageTotalGb: 250.0,
      packageRemainingGb: 250.0 - (45.0 + (i * 12.5)),
      activeDevicesCount: 5,
      blockedDevicesCount: i == 6 ? 1 : 0,
    );
  });

  group('AnalyticsState Calculations Unit Tests', () {
    test('Calculates peak, growth, and daily average accurately', () {
      final state = AnalyticsState(dailyUsage: sample7Days);

      expect(state.latestUsageGb, closeTo(120.0, 0.1));
      expect(state.weekPeakGb, closeTo(120.0, 0.1));
      expect(state.weekGrowthGb, closeTo(75.0, 0.1));
      expect(state.dailyAverageGb, closeTo(12.5, 0.1));
    });

    test('Handles empty dailyUsage gracefully without exceptions', () {
      const state = AnalyticsState();

      expect(state.latestUsageGb, 0.0);
      expect(state.weekPeakGb, 0.0);
      expect(state.weekGrowthGb, 0.0);
      expect(state.dailyAverageGb, 0.0);
    });
  });

  group('UsageChart Widget Tests', () {
    testWidgets('Renders empty placeholder when records list is empty', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: UsageChart(records: []),
          ),
        ),
      );

      expect(find.text('No historical usage data yet'), findsOneWidget);
    });

    testWidgets('Renders header, badge, key metrics, and chart with 7 days', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: UsageChart(records: sample7Days),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('7-Day Consumption Curve'), findsOneWidget);
      expect(find.text('Daily cumulative bandwidth'), findsOneWidget);
      expect(find.text('7 Days'), findsOneWidget);
      expect(find.text('Today'), findsOneWidget);
      expect(find.textContaining('GB this week'), findsOneWidget);
    });
  });

  group('AnalyticsScreen Responsive Layout Tests', () {
    for (final size in [
      const Size(360, 800),
      const Size(390, 844),
      const Size(412, 915),
    ]) {
      testWidgets('Zero overflow on ${size.width.toInt()} x ${size.height.toInt()} screen', (tester) async {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        final testState = AnalyticsState(
          history: sample7Days,
          dailyUsage: sample7Days,
          isLoading: false,
        );

        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              analyticsControllerProvider.overrideWith(
                (ref) => _FakeAnalyticsController(testState),
              ),
            ],
            child: const MaterialApp(
              home: AnalyticsScreen(),
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.text('Bandwidth Analytics'), findsOneWidget);
        expect(find.text('Week Peak'), findsOneWidget);
        expect(find.text('Daily Avg'), findsOneWidget);
        expect(find.text('Active Fleet'), findsOneWidget);
        expect(find.text('Telemetry Snapshots'), findsOneWidget);

        // Verify no RenderFlex errors were recorded
        expect(tester.takeException(), isNull);
      });
    }
  });
}

class _FakeAnalyticsController extends AnalyticsController {
  _FakeAnalyticsController(AnalyticsState initialState)
      : super(_EmptyMockRepository()) {
    state = initialState;
  }

  @override
  Future<void> loadHistory() async {}
}

class _EmptyMockRepository implements AnalyticsRepository {
  @override
  Future<List<UsageHistoryRecord>> getDailyUsageHistory({int days = 7}) async => [];

  @override
  Future<List<UsageHistoryRecord>> getUsageHistory() async => [];

  @override
  Future<void> seedMockHistoryIfNeeded() async {}
}
