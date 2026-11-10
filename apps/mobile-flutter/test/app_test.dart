import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';
import 'package:retailerp_mobile/app/retailerp_app.dart';
import 'package:retailerp_mobile/core/api_client.dart';
import 'package:retailerp_mobile/core/api_config.dart';
import 'package:retailerp_mobile/core/session_controller.dart';
import 'fixtures.dart';

void main() {
  testWidgets(
    'login, permission-gated placeholder navigation, account and logout',
    (tester) async {
      final store = MemorySessionStore();
      final session = SessionController(
        ApiClient(
          config: ApiConfig('http://192.0.2.1:3001', allowHttp: true),
          store: store,
          transport: MockClient(
            (request) async => success(
              request.url.path.endsWith('/login')
                  ? loginData()
                  : request.url.path.endsWith('/logout')
                  ? {'message': 'done'}
                  : identityData(),
            ),
          ),
        ),
      );
      await tester.pumpWidget(RetailErpApp(session: session));
      await tester.pumpAndSettle();
      expect(find.text('Sign in to your business'), findsOneWidget);
      final fields = find.byType(TextFormField);
      await tester.enterText(fields.at(0), 'test-tenant');
      await tester.enterText(fields.at(1), 'test-person');
      await tester.enterText(fields.at(2), 'fixture-password');
      await tester.ensureVisible(find.text('Sign in'));
      await tester.tap(find.text('Sign in'));
      await tester.pumpAndSettle();
      expect(find.text('Customer Searching'), findsOneWidget);
      expect(find.text('Sales'), findsNothing);
      await tester.tap(find.text('Customer Searching'));
      await tester.pumpAndSettle();
      expect(
        find.text('This feature is not implemented in Flutter yet.'),
        findsOneWidget,
      );
      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();
      expect(find.text('Test User'), findsOneWidget);
      await tester.tap(find.text('Sign out'));
      await tester.pumpAndSettle();
      expect(find.text('Sign in to your business'), findsOneWidget);
      expect(store.value, isNull);
    },
  );

  testWidgets('failed login keeps form input and displays the server error', (
    tester,
  ) async {
    final session = SessionController(
      ApiClient(
        config: ApiConfig('http://192.0.2.1:3001', allowHttp: true),
        store: MemorySessionStore(),
        transport: MockClient((_) async => failure(401)),
      ),
    );
    await tester.pumpWidget(RetailErpApp(session: session));
    await tester.pumpAndSettle();
    final fields = find.byType(TextFormField);
    await tester.enterText(fields.at(0), 'test-tenant');
    await tester.enterText(fields.at(1), 'test-person');
    await tester.enterText(fields.at(2), 'fixture-password');
    await tester.ensureVisible(find.text('Sign in'));
    await tester.tap(find.text('Sign in'));
    await tester.pumpAndSettle();
    expect(find.text('Test API failure'), findsOneWidget);
    expect(find.text('test-person'), findsOneWidget);
  });
}
