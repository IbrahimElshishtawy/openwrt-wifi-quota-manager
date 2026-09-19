import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app.dart';
import 'core/di/providers.dart';
import 'core/storage/isar_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // 1. Initialize SharedPreferences for instant key-value configs
  final sharedPreferences = await SharedPreferences.getInstance();

  // 2. Initialize Isar NoSQL Database for offline-first telemetry and caching
  final isarService = IsarService();
  await isarService.init();

  runApp(
    ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(sharedPreferences),
        isarServiceProvider.overrideWithValue(isarService),
      ],
      child: const OpenWrtQuotaApp(),
    ),
  );
}
