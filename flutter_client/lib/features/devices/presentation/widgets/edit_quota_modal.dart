import 'package:flutter/material.dart';
import '../../../../core/constants/app_colors.dart';
import '../../domain/models/device_model.dart';

class EditQuotaModal extends StatefulWidget {
  final DeviceModel device;
  final Future<void> Function(double newQuota, bool enabled) onSave;

  const EditQuotaModal({
    super.key,
    required this.device,
    required this.onSave,
  });

  @override
  State<EditQuotaModal> createState() => _EditQuotaModalState();
}

class _EditQuotaModalState extends State<EditQuotaModal> {
  late TextEditingController _quotaController;
  late bool _enabled;
  bool _isSaving = false;

  @override
  void initState() {
    super.initState();
    _quotaController = TextEditingController(text: widget.device.quotaGb.toStringAsFixed(1));
    _enabled = widget.device.enabled;
  }

  @override
  void dispose() {
    _quotaController.dispose();
    super.dispose();
  }

  void _addQuota(double amount) {
    final current = double.tryParse(_quotaController.text) ?? widget.device.quotaGb;
    final next = (current + amount).clamp(1.0, 500.0);
    _quotaController.text = next.toStringAsFixed(1);
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;

    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: bottomInset + 24,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Drag handle
          Center(
            child: Container(
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.cardBorderDark,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 16),

          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Configure Quota for ${widget.device.name}',
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  Text(
                    'MAC: ${widget.device.mac}',
                    style: const TextStyle(
                      fontSize: 11,
                      color: AppColors.textTertiary,
                      fontFamily: 'monospace',
                    ),
                  ),
                ],
              ),
              IconButton(
                onPressed: () => Navigator.pop(context),
                icon: const Icon(Icons.close, color: AppColors.textSecondary),
              ),
            ],
          ),

          const SizedBox(height: 20),

          // Internet Access Toggle
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: AppColors.surfaceDark,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Internet Access Rule',
                      style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14, color: AppColors.textPrimary),
                    ),
                    Text(
                      'Toggle firewall permit on router',
                      style: TextStyle(fontSize: 11, color: AppColors.textTertiary),
                    ),
                  ],
                ),
                Switch(
                  value: _enabled,
                  activeThumbColor: Colors.white,
                  activeTrackColor: AppColors.success,
                  onChanged: (val) {
                    setState(() => _enabled = val);
                  },
                ),
              ],
            ),
          ),

          const SizedBox(height: 18),

          // Quota Limit Input
          const Text(
            'Monthly Quota Limit (GB)',
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: AppColors.textSecondary,
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _quotaController,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: AppColors.primary),
            decoration: const InputDecoration(
              suffixText: 'GB',
              suffixStyle: TextStyle(fontWeight: FontWeight.w600, color: AppColors.textSecondary),
              hintText: 'e.g. 25.0',
            ),
          ),

          const SizedBox(height: 12),

          // Quick preset chips
          Wrap(
            spacing: 8,
            children: [
              ActionChip(
                label: const Text('+5 GB'),
                backgroundColor: AppColors.surfaceDark,
                side: const BorderSide(color: AppColors.cardBorderDark),
                onPressed: () => _addQuota(5),
              ),
              ActionChip(
                label: const Text('+10 GB'),
                backgroundColor: AppColors.surfaceDark,
                side: const BorderSide(color: AppColors.cardBorderDark),
                onPressed: () => _addQuota(10),
              ),
              ActionChip(
                label: const Text('+25 GB'),
                backgroundColor: AppColors.surfaceDark,
                side: const BorderSide(color: AppColors.cardBorderDark),
                onPressed: () => _addQuota(25),
              ),
              ActionChip(
                label: const Text('Reset (20 GB)'),
                backgroundColor: AppColors.surfaceDark,
                side: const BorderSide(color: AppColors.cardBorderDark),
                onPressed: () {
                  _quotaController.text = '20.0';
                  setState(() {});
                },
              ),
            ],
          ),

          const SizedBox(height: 24),

          // Save button
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _isSaving
                  ? null
                  : () async {
                      final val = double.tryParse(_quotaController.text);
                      if (val == null || val <= 0) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Please enter a valid quota greater than 0')),
                        );
                        return;
                      }

                      final navigator = Navigator.of(context);
                      final messenger = ScaffoldMessenger.of(context);

                      setState(() => _isSaving = true);
                      try {
                        await widget.onSave(val, _enabled);
                        if (mounted) navigator.pop();
                      } catch (e) {
                        if (mounted) {
                          messenger.showSnackBar(
                            SnackBar(content: Text('Error saving: $e')),
                          );
                        }
                      } finally {
                        if (mounted) setState(() => _isSaving = false);
                      }
                    },
              child: _isSaving
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black),
                    )
                  : const Text('Save Quota to Router'),
            ),
          ),
        ],
      ),
    );
  }
}
