import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/constants/app_colors.dart';
import '../controllers/devices_controller.dart';
import '../controllers/devices_state.dart';
import '../widgets/device_card.dart';

class DevicesScreen extends ConsumerWidget {
  const DevicesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(devicesControllerProvider);
    final controller = ref.read(devicesControllerProvider.notifier);

    final filteredDevices = state.filteredDevices;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Connected Devices'),
        actions: [
          IconButton(
            tooltip: 'Refresh Devices',
            onPressed: () => controller.loadDevices(forceRefresh: true),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: RefreshIndicator(
        color: AppColors.primary,
        backgroundColor: AppColors.cardDark,
        onRefresh: () => controller.loadDevices(forceRefresh: true),
        child: Column(
          children: [
            // Search Box
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: TextField(
                onChanged: controller.setSearchQuery,
                decoration: InputDecoration(
                  hintText: 'Search by device name, IP, or MAC...',
                  prefixIcon: const Icon(Icons.search, color: AppColors.textTertiary),
                  suffixIcon: state.searchQuery.isNotEmpty
                      ? IconButton(
                          icon: const Icon(Icons.clear, size: 18),
                          onPressed: () => controller.setSearchQuery(''),
                        )
                      : null,
                ),
              ),
            ),

            // Filter Chips
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              child: Row(
                children: [
                  _buildFilterChip(
                    label: 'All (${state.devices.length})',
                    isSelected: state.filter == DeviceFilter.all,
                    onTap: () => controller.setFilter(DeviceFilter.all),
                  ),
                  const SizedBox(width: 8),
                  _buildFilterChip(
                    label: 'Allowed (${state.devices.where((d) => d.enabled && !d.isBlocked).length})',
                    isSelected: state.filter == DeviceFilter.active,
                    onTap: () => controller.setFilter(DeviceFilter.active),
                  ),
                  const SizedBox(width: 8),
                  _buildFilterChip(
                    label: 'Blocked (${state.devices.where((d) => d.isBlocked || !d.enabled).length})',
                    isSelected: state.filter == DeviceFilter.blocked,
                    onTap: () => controller.setFilter(DeviceFilter.blocked),
                  ),
                  const SizedBox(width: 8),
                  _buildFilterChip(
                    label: 'Near Limit >85%',
                    isSelected: state.filter == DeviceFilter.nearQuota,
                    onTap: () => controller.setFilter(DeviceFilter.nearQuota),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 8),

            // Devices List or Empty State
            Expanded(
              child: state.isLoading && state.devices.isEmpty
                  ? const Center(child: CircularProgressIndicator(color: AppColors.primary))
                  : filteredDevices.isEmpty
                      ? Center(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(Icons.devices_other, size: 64, color: AppColors.textTertiary.withValues(alpha: 0.5)),
                              const SizedBox(height: 12),
                              const Text(
                                'No matching devices found',
                                style: TextStyle(color: AppColors.textSecondary, fontSize: 16, fontWeight: FontWeight.w600),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                state.searchQuery.isNotEmpty
                                    ? 'Try changing your search term or filter'
                                    : 'Connect devices to OpenWrt router to manage quotas',
                                style: const TextStyle(color: AppColors.textTertiary, fontSize: 13),
                              ),
                            ],
                          ),
                        )
                      : ListView.builder(
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                          itemCount: filteredDevices.length,
                          itemBuilder: (context, index) {
                            final device = filteredDevices[index];
                            return DeviceCard(
                              device: device,
                              onToggleBlock: (block) {
                                controller.toggleBlock(mac: device.mac, block: block);
                              },
                              onSaveQuota: (newQuota, enabled) async {
                                await controller.updateQuota(
                                  mac: device.mac,
                                  quotaGb: newQuota,
                                  enabled: enabled,
                                );
                              },
                            );
                          },
                        ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFilterChip({
    required String label,
    required bool isSelected,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: isSelected ? AppColors.primary.withValues(alpha: 0.15) : AppColors.cardDark,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isSelected ? AppColors.primary : AppColors.cardBorderDark,
            width: 1,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: isSelected ? AppColors.primary : AppColors.textSecondary,
            fontSize: 12,
            fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
          ),
        ),
      ),
    );
  }
}
