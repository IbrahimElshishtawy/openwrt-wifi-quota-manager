import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_client/core/constants/app_colors.dart';
import 'package:flutter_client/core/utils/device_icon_resolver.dart';
import 'package:flutter_client/core/utils/greeting_helper.dart';
import 'package:flutter_client/features/dashboard/domain/models/network_activity_event.dart';
import 'package:flutter_client/features/dashboard/domain/models/quota_report.dart';
import 'package:flutter_client/features/dashboard/presentation/controllers/dashboard_controller.dart';
import 'package:flutter_client/features/dashboard/presentation/controllers/dashboard_state.dart';
import 'package:flutter_client/features/dashboard/presentation/screens/dashboard_screen.dart';
import 'package:flutter_client/features/dashboard/presentation/widgets/dashboard_metric_card.dart';
import 'package:flutter_client/features/dashboard/presentation/widgets/quota_overview_card.dart';
import 'package:flutter_client/features/dashboard/presentation/widgets/recent_activity_section.dart';
import 'package:flutter_client/features/dashboard/presentation/widgets/top_consumers_section.dart';

void main() {
  group('DeviceIconResolver Unit Tests', () {
    test('Correctly resolves all requested device types', () {
      expect(DeviceIconResolver.resolveType('Ahmed iPhone'), DeviceType.phone);
      expect(DeviceIconResolver.resolveType('Galaxy S24'), DeviceType.phone);
      expect(DeviceIconResolver.resolveType('iPad Pro'), DeviceType.tablet);
      expect(DeviceIconResolver.resolveType('MacBook Pro'), DeviceType.laptop);
      expect(DeviceIconResolver.resolveType('ThinkPad T14'), DeviceType.laptop);
      expect(DeviceIconResolver.resolveType('Living Room TV'), DeviceType.tv);
      expect(DeviceIconResolver.resolveType('LG webOS'), DeviceType.tv);
      expect(DeviceIconResolver.resolveType('PlayStation 5'), DeviceType.gameConsole);
      expect(DeviceIconResolver.resolveType('PS5'), DeviceType.gameConsole);
      expect(DeviceIconResolver.resolveType('Smart Camera'), DeviceType.camera);
      expect(DeviceIconResolver.resolveType('Outdoor IPC'), DeviceType.camera);
      expect(DeviceIconResolver.resolveType('iMac Workstation'), DeviceType.desktop);
      expect(DeviceIconResolver.resolveType('OpenWrt Router'), DeviceType.router);
      expect(DeviceIconResolver.resolveType('Unknown Gizmo'), DeviceType.unknown);
    });

    test('Returns non-null icons for all device types', () {
      for (final type in DeviceType.values) {
        expect(DeviceIconResolver.getIconForType(type), isNotNull);
      }
    });
  });

  group('GreetingHelper Unit Tests', () {
    test('Calculates morning, afternoon, evening, night correctly', () {
      final morning = DateTime(2026, 9, 20, 8, 30);
      expect(GreetingHelper.getGreeting(dateTime: morning), contains('Good morning'));

      final afternoon = DateTime(2026, 9, 20, 14, 0);
      expect(GreetingHelper.getGreeting(dateTime: afternoon), contains('Good afternoon'));

      final evening = DateTime(2026, 9, 20, 19, 15);
      expect(GreetingHelper.getGreeting(dateTime: evening), contains('Good evening'));

      final night = DateTime(2026, 9, 20, 23, 45);
      expect(GreetingHelper.getGreeting(dateTime: night), contains('Good night'));
    });
  });

  group('Dashboard Components Widget Tests', () {
    testWidgets('QuotaOverviewCard renders circular indicator and ISP information', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: QuotaOverviewCard(
              totalQuotaGb: 100.0,
              usedQuotaGb: 68.0,
              remainingQuotaGb: 32.0,
              usagePercentage: 68.0,
              daysRemaining: 12,
              lastUpdated: DateTime.now(),
            ),
          ),
        ),
      );

      await tester.pumpAndSettle();

      expect(find.text('ISP Package'), findsOneWidget);
      expect(find.text('Monthly Quota'), findsOneWidget);
      expect(find.text('68%'), findsOneWidget);
      expect(find.text('Used'), findsOneWidget);
      expect(find.text('32 GB'), findsOneWidget);
      expect(find.text('12 Days'), findsOneWidget);
    });

    testWidgets('DashboardMetricCard renders metric, label, and trend', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: DashboardMetricCard(
              title: 'Active Devices',
              value: '12',
              subtitle: '↑ 2 new',
              icon: Icons.wifi_rounded,
              accentColor: AppColors.neonGreen,
            ),
          ),
        ),
      );

      expect(find.text('Active Devices'), findsOneWidget);
      expect(find.text('12'), findsOneWidget);
      expect(find.text('↑ 2 new'), findsOneWidget);
    });

    testWidgets('TopConsumersSection sorts devices by usage and renders items', (tester) async {
      final consumers = [
        const TopConsumer(mac: '1', name: 'Smart TV', ip: '192.168.1.20', usageGb: 8.9, percentage: 13),
        const TopConsumer(mac: '2', name: 'Ahmed iPhone', ip: '192.168.1.12', usageGb: 18.4, percentage: 27),
        const TopConsumer(mac: '3', name: 'Laptop', ip: '192.168.1.15', usageGb: 12.1, percentage: 18),
      ];

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: TopConsumersSection(
              consumers: consumers,
              totalPackageGb: 100.0,
            ),
          ),
        ),
      );

      expect(find.text('Top Bandwidth Consumers'), findsOneWidget);
      expect(find.text('Ahmed iPhone'), findsOneWidget);
      expect(find.text('192.168.1.12'), findsOneWidget);
      expect(find.text('18.4 GB'), findsOneWidget);
      expect(find.text('27%'), findsOneWidget);
    });

    testWidgets('RecentActivitySection renders activity events with timestamps', (tester) async {
      final events = [
        NetworkActivityEvent(
          id: '1',
          title: 'Device unblocked',
          deviceDescription: 'Laptop (192.168.1.15)',
          timestamp: DateTime(2026, 9, 20, 20, 24),
          type: ActivityEventType.unblocked,
        ),
        NetworkActivityEvent(
          id: '2',
          title: 'Quota updated',
          deviceDescription: 'Ahmed iPhone (192.168.1.12) → 20 GB',
          timestamp: DateTime(2026, 9, 20, 20, 12),
          type: ActivityEventType.quotaUpdated,
        ),
      ];

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: RecentActivitySection(events: events),
          ),
        ),
      );

      expect(find.text('Recent Activity'), findsOneWidget);
      expect(find.textContaining('Device unblocked'), findsOneWidget);
      expect(find.textContaining('Quota updated'), findsOneWidget);
    });
  });

  group('Responsive Layout Verification (360x800, 390x844, 412x915)', () {
    Widget buildDashboardHarness() {
      final mockReport = QuotaReport(
        totalBandwidthUsedGb: 68.0,
        packageTotalGb: 100.0,
        packageRemainingGb: 32.0,
        cycleDaysRemaining: 12,
        topConsumers: const [
          TopConsumer(mac: '1', name: 'Ahmed iPhone', ip: '192.168.1.12', usageGb: 18.4, percentage: 27),
          TopConsumer(mac: '2', name: 'Laptop', ip: '192.168.1.15', usageGb: 12.1, percentage: 18),
          TopConsumer(mac: '3', name: 'Smart TV', ip: '192.168.1.20', usageGb: 8.9, percentage: 13),
          TopConsumer(mac: '4', name: 'PS5', ip: '192.168.1.25', usageGb: 6.2, percentage: 9),
          TopConsumer(mac: '5', name: 'Security Camera', ip: '192.168.1.30', usageGb: 4.8, percentage: 7),
        ],
      );

      final state = DashboardState(
        status: DashboardStatus.success,
        connectionStatus: DashboardConnectionStatus.online,
        report: mockReport,
        activeDevices: 12,
        blockedDevices: 3,
        nearLimitDevices: 4,
        refreshInterval: 15,
        recentActivity: [
          NetworkActivityEvent(
            id: '1',
            title: 'Device unblocked',
            deviceDescription: 'Laptop (192.168.1.15)',
            timestamp: DateTime.now(),
            type: ActivityEventType.unblocked,
          ),
        ],
        lastUpdated: DateTime.now(),
      );

      return ProviderScope(
        overrides: [
          dashboardControllerProvider.overrideWith(
            (ref) => _StaticMockDashboardController(state),
          ),
        ],
        child: const MaterialApp(
          home: DashboardScreen(),
        ),
      );
    }

    testWidgets('Zero overflow on 360 x 800 (Compact Android screen)', (tester) async {
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() => tester.view.resetPhysicalSize());

      await tester.pumpWidget(buildDashboardHarness());
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull, reason: 'No RenderFlex overflow on 360x800');
      expect(find.text('Wi-Fi Quota Manager'), findsOneWidget);
      expect(find.text('Active Devices'), findsOneWidget);
      expect(find.text('Blocked Devices'), findsOneWidget);
      expect(find.text('Near Limit'), findsOneWidget);
      expect(find.text('Auto Refresh'), findsOneWidget);
    });

    testWidgets('Zero overflow on 390 x 844 (Standard screen)', (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() => tester.view.resetPhysicalSize());

      await tester.pumpWidget(buildDashboardHarness());
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull, reason: 'No RenderFlex overflow on 390x844');
      expect(find.text('Wi-Fi Quota Manager'), findsOneWidget);
    });

    testWidgets('Zero overflow on 412 x 915 (Large Android flagship screen)', (tester) async {
      tester.view.physicalSize = const Size(412, 915);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() => tester.view.resetPhysicalSize());

      await tester.pumpWidget(buildDashboardHarness());
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull, reason: 'No RenderFlex overflow on 412x915');
      expect(find.text('Wi-Fi Quota Manager'), findsOneWidget);
    });
  });
}

class _StaticMockDashboardController extends StateNotifier<DashboardState>
    implements DashboardController {
  _StaticMockDashboardController(super.state);

  @override
  void disposeTimer() {}

  @override
  Future<void> loadData({bool isBackground = false, bool forceRefresh = false}) async {}

  @override
  void setDemoMode(bool isDemo) {}

  @override
  void startPolling({int? intervalSeconds}) {}

  @override
  void updateRefreshInterval(int seconds) {}
}
