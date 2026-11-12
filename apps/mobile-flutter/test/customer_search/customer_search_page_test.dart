import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:retailerp_mobile/app/app_shell.dart';
import 'package:retailerp_mobile/app/retailerp_app.dart';
import 'package:retailerp_mobile/core/api_client.dart';
import 'package:retailerp_mobile/core/api_config.dart';
import 'package:retailerp_mobile/core/session_controller.dart';
import 'package:retailerp_mobile/features/customer_search/register_database.dart';
import 'package:retailerp_mobile/features/customer_search/sync_settings.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import '../fixtures.dart';
import 'register_test.dart' show FakeRegisterServer, entry;

void main() {
  testWidgets(
    'Customer Searching downloads the register, searches it and opens an entry',
    (tester) async {
      FlutterSecureStorage.setMockInitialValues({});
      final server = FakeRegisterServer()..pageSize = 10;
      server.put(
        entry(
          'e1',
          account: 'BD 1',
          name: 'Ram Lal',
          mobile: '9876543210',
          date: '2025-01-05',
          categoryId: 'led',
        ),
      );
      server.put(
        entry(
          'e2',
          account: 'BD 2',
          name: 'Sita Devi',
          mobile: '9812345678',
          date: '2025-02-01',
          issues: ['no_product_type'],
        ),
      );
      final removed = <String>[];
      final scheduled = <int>[];
      final store = MemorySessionStore();
      final session = SessionController(
        ApiClient(
          config: ApiConfig('http://192.0.2.1:3001', allowHttp: true),
          store: store,
          transport: MockClient((request) async {
            final path = request.url.path;
            if (path.endsWith('/login')) return success(loginData());
            if (path.endsWith('/logout')) return success({});
            if (path.endsWith('/customer-search/sync')) {
              return server.handle(request);
            }
            if (path.endsWith('/customer-search/e1')) {
              return success({
                'id': 'e1',
                'creator': {'fullName': 'Synthetic Clerk'},
                'importBatch': null,
                'matchingSale': null,
              });
            }
            if (path.endsWith('/auth/me')) {
              return success(
                identityData(
                  permissions: [
                    'nav.customer_search',
                    'customer_search.list',
                    'customer_search.detail',
                    'customer_search.create',
                    'customer_search.edit',
                  ],
                ),
              );
            }
            return http.Response('{"success":false,"error":"unexpected"}', 404);
          }),
        ),
      );
      await tester.pumpWidget(
        RetailErpApp(
          session: session,
          register: RegisterServices(
            opener: (tenantId, userId) async => RegisterDatabase(
              await databaseFactoryFfiNoIsolate.openDatabase(
                inMemoryDatabasePath,
                options: OpenDatabaseOptions(
                  version: schemaVersion,
                  singleInstance: false,
                  onConfigure: configureRegisterDb,
                  onCreate: (db, _) => createRegisterSchema(db),
                ),
              ),
            ),
            remover: (tenantId, userId) async =>
                removed.add('$tenantId/$userId'),
            settings: SyncSettings(),
            scheduleBackground: (minutes) async => scheduled.add(minutes),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final fields = find.byType(TextFormField);
      await tester.enterText(fields.at(0), 'test-tenant');
      await tester.enterText(fields.at(1), 'test-person');
      await tester.enterText(fields.at(2), 'fixture-password');
      await tester.ensureVisible(find.text('Sign in'));
      await tester.tap(find.text('Sign in'));
      await tester.pumpAndSettle();
      expect(scheduled, [15]);

      await tester.tap(find.text('Customer Searching'));
      await tester.pumpAndSettle();
      expect(
        find.textContaining('Last updated just now · 2 entries'),
        findsOneWidget,
      );
      expect(find.textContaining('Ram Lal'), findsOneWidget);
      expect(find.textContaining('Sita Devi'), findsOneWidget);
      expect(find.text('New entry'), findsOneWidget);
      expect(
        find.textContaining('2 entries in the register', findRichText: true),
        findsOneWidget,
      );
      expect(find.textContaining('need review'), findsOneWidget);
      for (final removed in [
        'Needs review',
        'Series',
        'Product type',
        'Shop',
      ]) {
        expect(
          find.text(removed),
          findsNothing,
          reason: 'filter chips are gone',
        );
      }

      await tester.enterText(find.byType(TextField).first, 'sita');
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();
      expect(find.textContaining('Ram Lal'), findsNothing);
      expect(find.textContaining('Sita Devi'), findsOneWidget);
      // Two-line row: name + account, then what/when/mobile; issues are a dot.
      expect(find.text('BD 2'), findsOneWidget);
      expect(find.textContaining('1 Feb 2025'), findsOneWidget);
      expect(find.textContaining('98123 45678'), findsOneWidget);
      expect(find.byTooltip('No product type'), findsOneWidget);
      expect(find.textContaining('found of 2'), findsOneWidget);

      // "Search in" → Account number: "bd-1" no longer matches by name.
      expect(find.text('All'), findsOneWidget);
      await tester.tap(find.text('All'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Account number').last);
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).first, 'bd-1');
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();
      expect(find.textContaining('Ram Lal'), findsOneWidget);
      expect(find.textContaining('Sita Devi'), findsNothing);
      await tester.tap(find.text('Account number'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('All').last);
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField).first, 'ram');
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();
      await tester.tap(find.textContaining('Ram Lal'));
      await tester.pumpAndSettle();
      expect(
        find.text('LED TV').evaluate().isNotEmpty ||
            find.text('TV › LED TV').evaluate().isNotEmpty,
        true,
      );
      expect(find.text('9876543210'), findsOneWidget);
      expect(find.text('Synthetic Clerk'), findsOneWidget);
      await tester.pageBack();
      await tester.pumpAndSettle();

      // Re-checking access (as on every app resume) keeps this screen.
      await session.revalidate();
      await tester.pumpAndSettle();
      expect(find.text('Search in'), findsOneWidget);
      expect(find.textContaining('Ram Lal'), findsOneWidget);

      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();
      expect(find.text('Customer Searching on this phone'), findsOneWidget);
      expect(find.text('Every 15 minutes'), findsOneWidget);
      await tester.drag(find.byType(ListView).first, const Offset(0, -600));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Sign out'));
      await tester.pumpAndSettle();
      expect(find.text('Sign in to your business'), findsOneWidget);
      expect(removed, isEmpty, reason: 'the copy is kept on sign-out');
    },
  );
}
