import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
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
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import '../fixtures.dart';
import 'register_test.dart' show FakeRegisterServer, entry;

typedef Handler = Future<http.Response?> Function(http.Request request);

/// Signs in and opens Customer Searching against [server]; [handler] answers
/// form requests (return null for the default behaviour).
Future<void> openRegister(
  WidgetTester tester,
  FakeRegisterServer server,
  Handler handler,
) async {
  FlutterSecureStorage.setMockInitialValues({});
  final session = SessionController(
    ApiClient(
      config: ApiConfig('http://192.0.2.1:3001', allowHttp: true),
      store: MemorySessionStore(),
      transport: MockClient((request) async {
        final custom = await handler(request);
        if (custom != null) return custom;
        final path = request.url.path;
        if (path.endsWith('/login')) return success(loginData());
        if (path.endsWith('/logout')) return success({});
        if (path.endsWith('/customer-search/sync')) {
          return server.handle(request);
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
        if (path.contains('/customer-search/')) {
          return success({'id': 'x'});
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
        remover: (tenantId, userId) async {},
        settings: SyncSettings(),
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
  await tester.tap(find.text('Customer Searching'));
  await tester.pumpAndSettle();
}

Finder field(String label) => find.widgetWithText(TextFormField, label);

Future<void> reveal(WidgetTester tester, Finder finder) =>
    tester.scrollUntilVisible(
      finder,
      200,
      scrollable: find
          .descendant(of: find.byType(Form), matching: find.byType(Scrollable))
          .first,
    );

/// The Save at the top of the form (always on screen).
Future<void> tapSave(WidgetTester tester) async {
  FocusManager.instance.primaryFocus?.unfocus();
  await tester.pumpAndSettle();
  await tester.tap(
    find.descendant(of: find.byType(AppBar), matching: find.text('Save')),
  );
  await tester.pumpAndSettle();
}

Future<void> pick(WidgetTester tester, String label, String option) async {
  await reveal(tester, find.text(label));
  final dropdown = find.ancestor(
    of: find.text(label),
    matching: find.byType(DropdownButtonFormField<String>),
  );
  await tester.tap(dropdown);
  await tester.pumpAndSettle();
  await tester.tap(find.text(option).last);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'new entry: a dropped connection keeps the input, the retry reuses the same request id, and a reused number needs Save anyway',
    (tester) async {
      final server = FakeRegisterServer()..pageSize = 10;
      server.put(entry('e1', account: 'BD 1', name: 'Ram Lal'));
      final posts = <Map<String, dynamic>>[];
      await openRegister(tester, server, (request) async {
        if (request.method == 'POST' &&
            request.url.path.endsWith('/customer-search')) {
          final body = jsonDecode(request.body) as Map<String, dynamic>;
          posts.add(body);
          if (posts.length == 1) throw http.ClientException('dropped');
          if (posts.length == 2) {
            return http.Response(
              jsonEncode({
                'success': false,
                'error':
                    'Account Number BD 1 is already used for Ram Lal (TS).',
                'details': {
                  'code': 'duplicate_account',
                  'nextAccountNumber': 'BD 2',
                },
              }),
              409,
            );
          }
          server.put(
            entry('e2', account: 'BD 1', name: 'Asha New', date: '2026-01-01'),
          );
          return http.Response(
            jsonEncode({
              'success': true,
              'data': {'id': 'e2'},
            }),
            201,
          );
        }
        return null;
      });

      await tester.tap(find.text('New entry'));
      await tester.pumpAndSettle();
      await tester.enterText(field('Account number *'), 'BD-1');
      await tester.enterText(field('Customer name *'), 'Asha New');
      await reveal(tester, find.text('Choose a date'));
      await tester.tap(find.text('Choose a date'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      await pick(tester, 'Product type *', 'TV');
      await pick(tester, 'Sub-type (optional)', 'LED TV');

      await tapSave(tester);
      expect(find.textContaining("Couldn't confirm the save"), findsOneWidget);

      await tapSave(tester);
      expect(find.text('Account number already used'), findsOneWidget);
      await tester.tap(find.text('Save anyway'));
      await tester.pumpAndSettle();

      expect(posts, hasLength(3));
      expect(posts.map((p) => p['clientRequestId']).toSet(), hasLength(1));
      expect(
        posts.map((p) => p['customerName']).toSet(),
        {'Asha New'},
        reason: 'input kept across failures',
      );
      expect(posts[0]['categoryId'], 'led');
      expect(posts[0]['allowDuplicate'], isNull);
      expect(posts[2]['allowDuplicate'], true);
      expect(
        find.text('New entry'),
        findsOneWidget,
        reason: 'back on the list',
      );
      expect(find.textContaining('Asha New'), findsOneWidget);
    },
  );

  testWidgets(
    'edit: a change saved elsewhere meanwhile is refused, then this person’s change is kept on top of the latest version',
    (tester) async {
      final server = FakeRegisterServer()..pageSize = 10;
      server.put(
        entry('e1', account: 'BD 1', name: 'Ram Lal', area: 'Old Area'),
      );
      final patches = <Map<String, dynamic>>[];
      await openRegister(tester, server, (request) async {
        if (request.method == 'PATCH') {
          final body = jsonDecode(request.body) as Map<String, dynamic>;
          patches.add(body);
          if (patches.length == 1) {
            // Someone else renamed the customer first.
            server.put({
              ...entry(
                'e1',
                account: 'BD 1',
                name: 'Ram Lal Sharma',
                area: 'Old Area',
              ),
              'updatedAt': '2026-02-01T00:00:00.000Z',
            });
            return http.Response(
              jsonEncode({
                'success': false,
                'error': 'Someone else changed this entry.',
                'details': {
                  'code': 'stale',
                  'updatedAt': '2026-02-01T00:00:00.000Z',
                },
              }),
              409,
            );
          }
          server.put({
            ...entry(
              'e1',
              account: 'BD 1',
              name: 'Ram Lal Sharma',
              area: 'New Area',
            ),
            'updatedAt': '2026-02-02T00:00:00.000Z',
          });
          return success({'id': 'e1'});
        }
        return null;
      });

      await tester.tap(find.textContaining('Ram Lal'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Edit'));
      await tester.pumpAndSettle();
      await reveal(tester, field('Area'));
      await tester.enterText(field('Area'), 'New Area');
      await tapSave(tester);

      expect(find.text('Changed by someone else'), findsOneWidget);
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('Ram Lal Sharma'),
        -300,
        scrollable: find
            .descendant(
              of: find.byType(Form),
              matching: find.byType(Scrollable),
            )
            .first,
      );
      expect(
        find.text('Ram Lal Sharma'),
        findsOneWidget,
        reason: 'their change shown',
      );
      expect(
        find.text('New Area'),
        findsOneWidget,
        reason: 'this person’s change kept',
      );

      await tapSave(tester);
      expect(patches, hasLength(2));
      expect(patches[0], {
        'area': 'New Area',
        'expectedUpdatedAt': '2026-01-01T00:00:00.000Z',
      });
      expect(patches[1], {
        'area': 'New Area',
        'expectedUpdatedAt': '2026-02-01T00:00:00.000Z',
      });
      expect(
        find.text('Edit entry'),
        findsNothing,
        reason: 'form closed after saving',
      );
    },
  );

  testWidgets(
    'new entry: a quantity and another product are saved together under one account number',
    (tester) async {
      final server = FakeRegisterServer()..pageSize = 10;
      final posts = <Map<String, dynamic>>[];
      await openRegister(tester, server, (request) async {
        if (request.method == 'POST' &&
            request.url.path.endsWith('/customer-search')) {
          posts.add(jsonDecode(request.body) as Map<String, dynamic>);
          return http.Response(
            jsonEncode({
              'success': true,
              'data': {'id': 'n1', 'itemsSaved': 5},
            }),
            201,
          );
        }
        return null;
      });

      await tester.tap(find.text('New entry'));
      await tester.pumpAndSettle();
      await tester.enterText(field('Account number *'), 'MI 7');
      await tester.enterText(field('Customer name *'), 'Many Items');
      await reveal(tester, find.text('Choose a date'));
      await tester.tap(find.text('Choose a date'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      await pick(tester, 'Product type *', 'TV');
      await reveal(tester, field('Quantity'));
      await tester.enterText(field('Quantity'), '2');
      await reveal(tester, find.text('Add another item'));
      await tester.tap(find.text('Add another item'));
      await tester.pumpAndSettle();

      // The new item's own type picker (the last "Product type *").
      await reveal(tester, find.text('Item 2'));
      final itemType = find.ancestor(
        of: find.text('Product type *').last,
        matching: find.byType(DropdownButtonFormField<String>),
      );
      await tester.tap(itemType);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Fridge').last);
      await tester.pumpAndSettle();
      await tester.enterText(
        find.descendant(of: find.byType(Card).last, matching: field('Brand')),
        'Whirlpool',
      );
      await tester.enterText(
        find.descendant(of: find.byType(Card).last, matching: field('Qty')),
        '3',
      );
      await tester.pumpAndSettle();
      expect(
        find.text('5 entries will be saved under this account number.'),
        findsOneWidget,
      );

      await tapSave(tester);
      expect(posts, hasLength(1));
      expect(posts.single['categoryId'], 'tv');
      expect(posts.single['quantity'], 2);
      expect(posts.single['moreItems'], [
        {
          'categoryId': 'fridge',
          'brand': 'Whirlpool',
          'model': null,
          'quantity': 3,
        },
      ]);
    },
  );
}
