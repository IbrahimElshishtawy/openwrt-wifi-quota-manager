import 'adapters/generic_router_adapter.dart';
import 'adapters/huawei_adapter.dart';
import 'adapters/openwrt_adapter.dart';
import 'adapters/tplink_adapter.dart';
import 'adapters/zte_adapter.dart';
import 'router_adapter.dart';
import 'router_profile.dart';

/// Central registry managing available router adapters and dynamic adapter resolution.
class RouterAdapterRegistry {
  final Map<String, RouterAdapter> _adapters = {};

  RouterAdapterRegistry();

  /// Registers an adapter instance into the registry.
  void register(RouterAdapter adapter) {
    _adapters[adapter.id] = adapter;
  }

  /// Removes an adapter by ID.
  void unregister(String id) {
    _adapters.remove(id);
  }

  /// Retrieves an adapter by ID.
  RouterAdapter? getAdapter(String id) {
    return _adapters[id];
  }

  /// Finds the most appropriate adapter for a given router vendor.
  /// Falls back to the generic adapter if no specialized adapter is found.
  RouterAdapter findBestAdapter(RouterVendor vendor) {
    for (final adapter in _adapters.values) {
      if (adapter.vendor == vendor) {
        return adapter;
      }
    }
    return _adapters['generic'] ?? GenericRouterAdapter();
  }

  /// Returns all registered adapters.
  List<RouterAdapter> get allAdapters => _adapters.values.toList();

  /// Creates a registry pre-populated with standard adapters.
  factory RouterAdapterRegistry.withDefaults({OpenWrtAdapter? openWrtAdapter}) {
    final registry = RouterAdapterRegistry();
    if (openWrtAdapter != null) {
      registry.register(openWrtAdapter);
    }
    registry.register(ZteAdapter());
    registry.register(HuaweiAdapter());
    registry.register(TpLinkAdapter());
    registry.register(GenericRouterAdapter());
    return registry;
  }
}
