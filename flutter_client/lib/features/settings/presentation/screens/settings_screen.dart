import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/di/providers.dart';
import '../../../../core/network/openwrt_client.dart';
import '../controllers/settings_controller.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  late TextEditingController _ipController;
  late TextEditingController _portController;
  late TextEditingController _usernameController;
  late TextEditingController _passwordController;
  late TextEditingController _tokenController;

  late String _protocol;
  bool _obscurePassword = true;
  bool _obscureToken = true;
  bool _isTesting = false;
  ConnectionTestResultInfo? _testResult;

  @override
  void initState() {
    super.initState();
    final settings = ref.read(settingsControllerProvider);
    _ipController = TextEditingController(text: settings.routerIp);
    _portController = TextEditingController(text: settings.routerPort.toString());
    _usernameController = TextEditingController(text: settings.username);
    _passwordController = TextEditingController(text: settings.password);
    _tokenController = TextEditingController(text: settings.apiKey);
    _protocol = settings.protocol;
  }

  @override
  void dispose() {
    _ipController.dispose();
    _portController.dispose();
    _usernameController.dispose();
    _passwordController.dispose();
    _tokenController.dispose();
    super.dispose();
  }

  Future<void> _saveAll() async {
    final port = int.tryParse(_portController.text.trim()) ?? 8080;
    await ref.read(settingsControllerProvider.notifier).updateSettings(
      routerIp: _ipController.text.trim(),
      routerPort: port,
      protocol: _protocol,
      username: _usernameController.text.trim(),
      password: _passwordController.text.trim(),
      apiKey: _tokenController.text.trim(),
    );

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('OpenWrt settings saved securely'),
          backgroundColor: AppColors.success,
        ),
      );
    }
  }

  Future<void> _testConnection() async {
    // First save in-memory settings to test with the entered parameters
    final port = int.tryParse(_portController.text.trim()) ?? 8080;
    await ref.read(settingsControllerProvider.notifier).updateSettings(
      routerIp: _ipController.text.trim(),
      routerPort: port,
      protocol: _protocol,
      username: _usernameController.text.trim(),
      password: _passwordController.text.trim(),
      apiKey: _tokenController.text.trim(),
    );

    setState(() {
      _isTesting = true;
      _testResult = null;
    });

    final result = await ref.read(settingsControllerProvider.notifier).testConnection();

    if (mounted) {
      setState(() {
        _isTesting = false;
        _testResult = result;
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
                          settings.isDemoMode ? 'Simulator / Demo Mode Active' : 'Live OpenWrt Router Mode',
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                            color: settings.isDemoMode ? AppColors.info : AppColors.primary,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          settings.isDemoMode
                              ? 'Operating with realistic offline mock data. No real router contacted.'
                              : 'Connecting directly to OpenWrt router over local network.',
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
              'OpenWrt Connection Configuration',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
            ),
            const SizedBox(height: 12),

            // Protocol Selection
            Row(
              children: [
                const Text('Protocol:', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                const SizedBox(width: 16),
                ChoiceChip(
                  label: const Text('HTTP'),
                  selected: _protocol == 'http',
                  onSelected: (selected) {
                    if (selected) setState(() => _protocol = 'http');
                  },
                ),
                const SizedBox(width: 8),
                ChoiceChip(
                  label: const Text('HTTPS'),
                  selected: _protocol == 'https',
                  onSelected: (selected) {
                    if (selected) setState(() => _protocol = 'https');
                  },
                ),
              ],
            ),
            const SizedBox(height: 12),

            // Router IP & Port Row
            Row(
              children: [
                Expanded(
                  flex: 3,
                  child: TextField(
                    controller: _ipController,
                    decoration: const InputDecoration(
                      labelText: 'Router IP / Gateway',
                      hintText: '192.168.1.1',
                      prefixIcon: Icon(Icons.lan_outlined),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  flex: 2,
                  child: TextField(
                    controller: _portController,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Port',
                      hintText: '8080',
                      prefixIcon: Icon(Icons.numbers_outlined),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),

            // Router Username
            TextField(
              controller: _usernameController,
              decoration: const InputDecoration(
                labelText: 'OpenWrt Username',
                hintText: 'root',
                prefixIcon: Icon(Icons.person_outline),
              ),
            ),
            const SizedBox(height: 12),

            // Router Password (Securely stored)
            TextField(
              controller: _passwordController,
              obscureText: _obscurePassword,
              decoration: InputDecoration(
                labelText: 'OpenWrt Password',
                hintText: 'Enter root router password',
                prefixIcon: const Icon(Icons.lock_outline),
                suffixIcon: IconButton(
                  icon: Icon(_obscurePassword ? Icons.visibility_off : Icons.visibility),
                  onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                ),
              ),
            ),
            const SizedBox(height: 12),

            // API Pre-Shared Bearer Token
            TextField(
              controller: _tokenController,
              obscureText: _obscureToken,
              decoration: InputDecoration(
                labelText: 'API Pre-Shared Bearer Token (Optional)',
                hintText: 'Enter API Secret from Router',
                prefixIcon: const Icon(Icons.key_outlined),
                suffixIcon: IconButton(
                  icon: Icon(_obscureToken ? Icons.visibility_off : Icons.visibility),
                  onPressed: () => setState(() => _obscureToken = !_obscureToken),
                ),
              ),
            ),

            const SizedBox(height: 16),

            // Test Connection & Save Buttons
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

            // Connection Diagnostic Result Card
            if (_testResult != null) ...[
              const SizedBox(height: 14),
              _buildTestResultCard(_testResult!),
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

  Widget _buildTestResultCard(ConnectionTestResultInfo result) {
    Color cardColor;
    IconData icon;

    switch (result.status) {
      case ConnectionTestStatus.connected:
        cardColor = AppColors.success;
        icon = Icons.check_circle_rounded;
        break;
      case ConnectionTestStatus.authenticationFailed:
        cardColor = AppColors.danger;
        icon = Icons.lock_clock_rounded;
        break;
      case ConnectionTestStatus.routerUnreachable:
        cardColor = AppColors.danger;
        icon = Icons.wifi_off_rounded;
        break;
      case ConnectionTestStatus.timeout:
        cardColor = AppColors.warning;
        icon = Icons.timer_off_rounded;
        break;
      case ConnectionTestStatus.invalidConfiguration:
        cardColor = AppColors.danger;
        icon = Icons.error_outline_rounded;
        break;
      case ConnectionTestStatus.unsupportedApi:
        cardColor = AppColors.warning;
        icon = Icons.warning_amber_rounded;
        break;
      case ConnectionTestStatus.unknownError:
        cardColor = AppColors.danger;
        icon = Icons.report_problem_rounded;
        break;
    }

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: cardColor.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: cardColor.withValues(alpha: 0.35), width: 1),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: cardColor, size: 22),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  result.message,
                  style: TextStyle(
                    color: cardColor,
                    fontSize: 13.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                if (result.details != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    result.details!,
                    style: TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: 12,
                    ),
                  ),
                ],
                if (result.responseTimeMs != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    'Response time: ${result.responseTimeMs} ms',
                    style: TextStyle(
                      color: cardColor,
                      fontSize: 11,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
