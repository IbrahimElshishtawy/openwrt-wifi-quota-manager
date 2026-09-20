import '../../../../features/devices/domain/models/device_model.dart';
import 'router_adapter.dart';

/// Evaluation decision made by the QuotaEngine for a given device.
enum QuotaDecision {
  allow('Normal Traffic Allowed'),
  warn80('Warning: 80% Quota Exceeded'),
  warn90('Warning: 90% Quota Exceeded'),
  warn95('Warning: 95% Quota Exceeded'),
  block('Quota Exceeded: Traffic Blocked'),
  quotaExceededUnblocked('Quota Exceeded: Blocking Unsupported on this Router');

  final String description;
  const QuotaDecision(this.description);
}

/// Detailed quota metrics computed for a device.
class DeviceQuotaMetrics {
  final String mac;
  final double quotaGb;
  final double usageGb;
  final double remainingGb;
  final double usagePercentage;
  final QuotaDecision decision;
  final bool shouldBlock;
  final bool isEnforced;
  final String statusReason;

  const DeviceQuotaMetrics({
    required this.mac,
    required this.quotaGb,
    required this.usageGb,
    required this.remainingGb,
    required this.usagePercentage,
    required this.decision,
    required this.shouldBlock,
    required this.isEnforced,
    required this.statusReason,
  });
}

/// Standalone Quota Engine decoupled from router-specific firewalls.
///
/// Operates on top of any [RouterAdapter]. Handles:
/// - Quota thresholds & remaining allowance calculations
/// - Billing cycle evaluation
/// - Dynamic enforcement: calls adapter.blockDevice() only if capability is supported
/// - Soft alerts when router lacks hardware/firewall blocking
class QuotaEngine {
  final RouterAdapter _adapter;

  QuotaEngine(this._adapter);

  /// Evaluates device consumption against configured quota.
  DeviceQuotaMetrics evaluateDevice(DeviceModel device) {
    final quota = device.quotaGb;
    final usage = device.usageGb;
    final remaining = (quota - usage).clamp(0.0, double.infinity);
    final percentage = quota > 0 ? (usage / quota) * 100 : 0.0;

    QuotaDecision decision;
    bool shouldBlock = false;
    bool isEnforced = false;
    String statusReason;

    if (!device.enabled) {
      decision = QuotaDecision.allow;
      statusReason = 'Device quota monitoring disabled.';
    } else if (quota <= 0) {
      decision = QuotaDecision.allow;
      statusReason = 'Unlimited quota allocated.';
    } else if (usage >= quota) {
      shouldBlock = true;
      if (_adapter.capabilities.block) {
        decision = QuotaDecision.block;
        isEnforced = true;
        statusReason = 'Quota limit reached (100%). Transit traffic blocked by router.';
      } else {
        decision = QuotaDecision.quotaExceededUnblocked;
        isEnforced = false;
        statusReason =
            'Quota exceeded (100%), but this router does not support traffic blocking.';
      }
    } else if (percentage >= 95) {
      decision = QuotaDecision.warn95;
      statusReason = 'Critical: 95% quota consumed.';
    } else if (percentage >= 90) {
      decision = QuotaDecision.warn90;
      statusReason = 'Warning: 90% quota consumed.';
    } else if (percentage >= 80) {
      decision = QuotaDecision.warn80;
      statusReason = 'Notice: 80% quota consumed.';
    } else {
      decision = QuotaDecision.allow;
      statusReason = 'Usage within normal operating threshold.';
    }

    return DeviceQuotaMetrics(
      mac: device.mac,
      quotaGb: quota,
      usageGb: usage,
      remainingGb: remaining,
      usagePercentage: percentage,
      decision: decision,
      shouldBlock: shouldBlock,
      isEnforced: isEnforced,
      statusReason: statusReason,
    );
  }

  /// Evaluates and enforces quota decisions across all devices.
  /// If the router adapter supports blocking, enforces blocks on exceeded devices.
  Future<List<DeviceQuotaMetrics>> enforceAll(List<DeviceModel> devices) async {
    final results = <DeviceQuotaMetrics>[];

    for (final dev in devices) {
      final metrics = evaluateDevice(dev);
      results.add(metrics);

      if (metrics.shouldBlock && _adapter.capabilities.block && !dev.isBlocked) {
        try {
          await _adapter.blockDevice(dev.mac);
        } catch (_) {}
      } else if (!metrics.shouldBlock && _adapter.capabilities.unblock && dev.isBlocked) {
        try {
          await _adapter.unblockDevice(dev.mac);
        } catch (_) {}
      }
    }

    return results;
  }

  /// Calculates days remaining in a 30-day billing cycle starting on [cycleStartDay].
  static int calculateBillingCycleDaysRemaining(int cycleStartDay) {
    final now = DateTime.now();
    final currentDay = now.day;

    if (currentDay == cycleStartDay) {
      return 30;
    } else if (currentDay < cycleStartDay) {
      return cycleStartDay - currentDay;
    } else {
      // Crossed billing start date into next month
      final daysInMonth = DateTime(now.year, now.month + 1, 0).day;
      return (daysInMonth - currentDay) + cycleStartDay;
    }
  }
}
