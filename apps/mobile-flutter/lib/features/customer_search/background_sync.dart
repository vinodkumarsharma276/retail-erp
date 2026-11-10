import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:workmanager/workmanager.dart';
import '../../core/api_client.dart';
import '../../core/api_config.dart';
import '../../core/session_models.dart';
import '../../core/session_store.dart';
import 'customer_search_controller.dart';
import 'register_files.dart';
import 'register_sync.dart';

const registerTaskName = 'retailerp.registerSync';

/// Android background entry point (WorkManager). Runs in its own isolate.
@pragma('vm:entry-point')
void registerCallbackDispatcher() {
  Workmanager().executeTask((task, input) async {
    WidgetsFlutterBinding.ensureInitialized();
    await runBackgroundRegisterSync();
    // Always "done": the next period tries again; no retry storms.
    return true;
  });
}

/// One background update of the signed-in user's register copy.
Future<void> runBackgroundRegisterSync() async {
  ApiClient? api;
  try {
    final config = ApiConfig(
      const String.fromEnvironment('API_BASE_URL'),
      allowHttp: kDebugMode,
    );
    final store = SecureSessionStore();
    api = ApiClient(config: config, store: store);
    if (!await api.restoreStored()) return;
    final Identity identity;
    try {
      identity = Identity.fromJson(await api.request('GET', 'auth/me'));
    } on ApiException catch (error) {
      if (error.network) return;
      rethrow;
    }
    if (identity.tenantSlug != api.credentials?.tenantSlug) return;
    await store.writeIdentity(identity.toJson());
    if (!canUseRegister(identity)) {
      // The server confirms access is gone: delete this user's copy.
      await RegisterFiles().delete(identity.tenantId, identity.userId);
      await scheduleRegisterUpdates(0);
      return;
    }
    final db = await RegisterFiles().open(identity.tenantId, identity.userId);
    try {
      await RegisterSync(api, db, owner: 'background').run();
    } finally {
      await db.close();
    }
  } on Object catch (error) {
    debugPrint('Background register update failed: $error');
  } finally {
    api?.close();
  }
}

/// Schedules (or with 0 cancels) the periodic background update.
Future<void> scheduleRegisterUpdates(int minutes) async {
  if (kIsWeb || !Platform.isAndroid) return;
  final workmanager = Workmanager();
  if (minutes == 0) {
    await workmanager.cancelByUniqueName(registerTaskName);
    return;
  }
  await workmanager.registerPeriodicTask(
    registerTaskName,
    registerTaskName,
    frequency: Duration(minutes: minutes),
    constraints: Constraints(networkType: NetworkType.connected),
    existingWorkPolicy: ExistingPeriodicWorkPolicy.update,
  );
}
