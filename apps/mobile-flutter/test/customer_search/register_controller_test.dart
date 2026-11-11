import 'dart:io';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:path/path.dart' as p;
import 'package:retailerp_mobile/core/api_client.dart';
import 'package:retailerp_mobile/core/api_config.dart';
import 'package:retailerp_mobile/core/session_controller.dart';
import 'package:retailerp_mobile/features/customer_search/customer_search_controller.dart';
import 'package:retailerp_mobile/features/customer_search/register_database.dart';
import 'package:retailerp_mobile/features/customer_search/register_sync.dart';
import 'package:retailerp_mobile/features/customer_search/sync_settings.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import '../fixtures.dart';
import 'register_test.dart' show FakeRegisterServer, entry;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  sqfliteFfiInit();

  test('an update that finds the copy closed under it (e.g. by the background '
      'updater) reopens the copy and carries on', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final server = FakeRegisterServer()..pageSize = 10;
    server.put(entry('e1', account: 'BD-1', name: 'Synthetic One'));
    final dir = await Directory.systemTemp.createTemp('register_test');
    final file = p.join(dir.path, 'register.db');
    final opened = <RegisterDatabase>[];
    final session = SessionController(
      ApiClient(
        config: ApiConfig('http://192.0.2.1:3001', allowHttp: true),
        store: MemorySessionStore(),
        transport: MockClient((request) async {
          final path = request.url.path;
          if (path.endsWith('/login')) return success(loginData());
          if (path.endsWith('/auth/me')) return success(identityData());
          if (path.endsWith('/customer-search/sync')) {
            return server.handle(request);
          }
          return http.Response('{"success":false}', 404);
        }),
      ),
    );
    await session.initialize();
    await session.signIn('test-tenant', 'test-person', 'fixture-password');
    final register = CustomerSearchController(
      session: session,
      opener: (tenantId, userId) async {
        final db = RegisterDatabase(
          await databaseFactoryFfi.openDatabase(
            file,
            options: OpenDatabaseOptions(
              version: schemaVersion,
              singleInstance: false,
              onConfigure: configureRegisterDb,
              onCreate: (db, _) => createRegisterSchema(db),
            ),
          ),
        );
        opened.add(db);
        return db;
      },
      remover: (tenantId, userId) async {},
      settings: SyncSettings(),
    );
    try {
      await register.start();
      await register.syncNow();
      expect(register.status?.entries, 1);

      // Another owner closes the connection the open app is using.
      await opened.single.close();
      server.put(entry('e2', account: 'BD-2', name: 'Synthetic Two'));

      final result = await register.syncNow();
      expect(result?.outcome, RegisterSyncOutcome.updated);
      expect(register.syncError, isNull);
      expect(opened, hasLength(2));
      expect(register.db, same(opened.last));
      expect(register.status?.entries, 2);
    } finally {
      register.dispose();
      await opened.last.close();
      await dir.delete(recursive: true);
    }
  });
}
