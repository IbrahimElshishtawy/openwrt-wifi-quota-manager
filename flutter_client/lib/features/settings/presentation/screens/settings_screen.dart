import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/di/providers.dart';
import '../controllers/settings_controller.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  late TextEditingController _ipController;
  late TextEditingController _portController;
  late TextEditingController _tokenController;
  bool _isTesting = false;
  String? _testResult;

  @override
  void initState() {
    super.initState();
    final settings = ref.read(settingsControllerProvider);
    _ipController = TextEditingController(text: settings.routerIp);
    _portController = TextEditingController(text: settings.routerPort.toString());
    _tokenController = TextEditingController(text: settings.apiKey);
  }

  @override
  void dispose() {
    _ipController.dispose();
    _portController.dispose();
    _tokenController.dispose();
    super.dispose();
  }

  Future<void> _saveAll() async {
    final port = int.tryParse(_portController.text) ?? 8080;
    await ref.read(settingsControllerProvider.notifier).updateSettings(
      routerIp: _ipController.text.trim(),
      routerPort: port,
      apiKey: _tokenController.text.trim(),
    );

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Settings saved successfully'),
          backgroundColor: AppColors.success,
        ),
      );
    }
  }

  Future<void> _testConnection() async {
    setState(() {
      _isTesting = true;
      _testResult = null;
    });

    final success = await ref.read(settingsControllerProvider.notifier).testConnection();

    if (mounted) {
      setState(() {
        _isTesting = false;
        _testResult = success
            ? 'Connected successfully to OpenWrt Router!'
            : 'Connection failed. Verify IP, Port, and network status.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final settings = ref.watch(settingsControllerProvider);
    final controller = ref.read(settingsControllerProvider.notifier);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Router & App Settings'),
        actions: [
          IconButton(
            tooltip: 'Save Settings',
            onPressed: _saveAll,
            icon: const Icon(Icons.check, color: AppColors.primary),
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Mode Banner: Simulator vs Live OpenWrt
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: settings.isDemoMode
                    ? AppColors.info.withValues(alpha: 0.12)
                    : AppColors.primary.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: settings.isDemoMode
                      ? AppColors.info.withValues(alpha: 0.3)
                      : AppColors.primary.withValues(alpha: 0.3),
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    settings.isDemoMode ? Icons.science_outlined : Icons.router_outlined,
                    color: settings.isDemoMode ? AppColors.info : AppColors.primary,
                    size: 28,
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          settings.isDemoMode ? 'Simulator / Demo Mode Active' : 'Live OpenWrt LAN Mode',
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                            color: settings.isDemoMode ? AppColors.info : AppColors.primary,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          settings.isDemoMode
                              ? 'Using realistic mock responses matching openwrt/api specs.'
                              : 'Connecting directly to router via local network.',
                          style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
                        ),
                      ],
                    ),
                  ),
                  Switch(
                    value: settings.isDemoMode,
                    activeTrackColor: AppColors.info,
                    activeThumbColor: Colors.white,
                    onChanged: (val) {
                      controller.toggleDemoMode(val);
                    },
                  ),
                ],
              ),
            ),

            const SizedBox(height: 24),

            const Text(
              'OpenWrt Local Connection',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
            ),
            const SizedBox(height: 12),

            // Router IP
            TextField(
              controller: _ipController,
              decoration: const InputDecoration(
                labelText: 'Router IP / Gateway',
                hintText: '192.168.1.1',
                prefixIcon: Icon(Icons.lan_outlined),
              ),
            ),
            const SizedBox(height: 12),

            // Router Port
            TextField(
              controller: _portController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'API Port',
                hintText: '8080',
                prefixIcon: Icon(Icons.numbers_outlined),
              ),
            ),
            const SizedBox(height: 12),

            // API Token
            TextField(
              controller: _tokenController,
              obscureText: true,
              decoration: const InputDecoration(
                labelText: 'API Pre-Shared Bearer Token',
                hintText: 'Enter API Secret from Router',
                prefixIcon: Icon(Icons.key_outlined),
              ),
            ),

            const SizedBox(height: 16),

            // Test Connection Button
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _isTesting ? null : _testConnection,
                    icon: _isTesting
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.network_ping),
                    label: const Text('Test Connection'),
                  ),
                ),
                const SizedBox(width: 12),
                ElevatedButton(
                  onPressed: _saveAll,
                  child: const Text('Save Settings'),
                ),
              ],
            ),

            if (_testResult != null) ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: _testResult!.contains('success')
                      ? AppColors.success.withValues(alpha: 0.12)
                      : AppColors.danger.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  _testResult!,
                  style: TextStyle(
                    color: _testResult!.contains('success') ? AppColors.success : AppColors.danger,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],

            const SizedBox(height: 28),

            const Text(
              'Polling & Background Refresh',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
            ),
            const SizedBox(height: 12),

            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppColors.cardDark,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: AppColors.cardBorderDark),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'Refresh Interval',
                        style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: AppColors.textPrimary),
                      ),
                      Text(
                        '${settings.refreshInterval} seconds',
                        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.primary),
                      ),
                    ],
                  ),
                  Slider(
                    value: settings.refreshInterval.toDouble(),
                    min: 5,
                    max: 60,
                    divisions: 11,
                    activeColor: AppColors.primary,
                    inactiveColor: AppColors.surfaceDark,
                    label: '${settings.refreshInterval}s',
                    onChanged: (val) {
                      controller.updateSettings(refreshInterval: val.toInt());
                    },
                  ),
                ],
              ),
            ),

            const SizedBox(height: 28),

            const Text(
              'Database & Cache Management',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
            ),
            const SizedBox(height: 12),

            ListTile(
              tileColor: AppColors.cardDark,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
                side: const BorderSide(color: AppColors.cardBorderDark),
              ),
              leading: const Icon(Icons.delete_outline, color: AppColors.danger),
              title: const Text('Clear Local Isar Cache', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
              subtitle: const Text('Removes cached devices and offline snapshots', style: TextStyle(fontSize: 12)),
              trailing: TextButton(
                child: const Text('Clear', style: TextStyle(color: AppColors.danger)),
                onPressed: () async {
                  await ref.read(isarServiceProvider).clearCache();
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Isar local cache cleared successfully')),
                    );
                  }
                },
              ),
            ),

            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }
}
