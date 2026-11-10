import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:workmanager/workmanager.dart';
import 'app/app_shell.dart';
import 'app/retailerp_app.dart';
import 'core/api_client.dart';
import 'core/api_config.dart';
import 'core/session_controller.dart';
import 'core/session_store.dart';
import 'features/customer_search/background_sync.dart';
import 'features/customer_search/register_files.dart';
import 'features/customer_search/sync_settings.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    final config = ApiConfig(
      const String.fromEnvironment('API_BASE_URL'),
      allowHttp: kDebugMode,
    );
    if (!kIsWeb && Platform.isAndroid) {
      unawaited(Workmanager().initialize(registerCallbackDispatcher));
    }
    final files = RegisterFiles();
    runApp(
      RetailErpApp(
        session: SessionController(
          ApiClient(config: config, store: SecureSessionStore()),
        ),
        register: RegisterServices(
          opener: files.open,
          remover: files.delete,
          settings: SyncSettings(),
          scheduleBackground: scheduleRegisterUpdates,
        ),
      ),
    );
  } on FormatException catch (error) {
    runApp(
      MaterialApp(
        theme: retailErpTheme(Brightness.light),
        home: Scaffold(
          body: SafeArea(
            child: Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  '${error.message}\n\nRun with --dart-define=API_BASE_URL=<your LAN or HTTPS server URL>.',
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
