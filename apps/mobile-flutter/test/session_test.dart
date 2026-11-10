import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:retailerp_mobile/core/api_client.dart';
import 'package:retailerp_mobile/core/api_config.dart';
import 'package:retailerp_mobile/core/session_controller.dart';
import 'package:retailerp_mobile/core/session_models.dart';
import 'package:retailerp_mobile/core/session_store.dart';
import 'package:retailerp_mobile/features/feature_catalog.dart';
import 'fixtures.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late MemorySessionStore store;
  SessionController controller(
    Future<http.Response> Function(http.Request) handler,
  ) {
    store = MemorySessionStore();
    final session = SessionController(
      ApiClient(
        config: ApiConfig('http://192.0.2.1:3001', allowHttp: true),
        store: store,
        transport: MockClient(handler),
      ),
    );
    addTearDown(session.dispose);
    return session;
  }

  test('login loads authoritative identity and persists no password', () async {
    final session = controller(
      (request) async => success(
        request.url.path.endsWith('/login') ? loginData() : identityData(),
      ),
    );
    await session.initialize();
    await session.signIn(' TEST-TENANT ', 'test-person', 'fixture-password');
    expect(session.identity?.tenantSlug, 'test-tenant');
    expect(session.error, isNull);
    expect(store.value?.toJson().containsKey('password'), false);
  });

  test(
    'startup with no confirmed identity on this phone blocks on network failure',
    () async {
      final session = controller((request) async {
        throw http.ClientException('test offline');
      });
      store.value = fixtureCredentials;
      await session.initialize();
      expect(session.initialized, false);
      expect(session.identity, isNull);
      expect(session.error, contains('Cannot reach'));
      expect(store.value, isNotNull);
    },
  );

  test(
    'startup offline continues with the last server-confirmed identity',
    () async {
      final session = controller((request) async {
        throw http.ClientException('test offline');
      });
      store.value = fixtureCredentials;
      store.identity = identityData();
      await session.initialize();
      expect(session.initialized, true);
      expect(session.offline, true);
      expect(session.identity?.userId, 'test-user');
      expect(session.error, isNull);
    },
  );

  test(
    'a confirmed identity is saved for offline start and removed on sign-out',
    () async {
      final session = controller((request) async {
        if (request.url.path.endsWith('/logout')) return success({});
        return success(
          request.url.path.endsWith('/login') ? loginData() : identityData(),
        );
      });
      await session.initialize();
      await session.signIn('test-tenant', 'test-person', 'fixture-password');
      expect(store.identity?['permissions'], contains('customer_search.list'));
      await session.signOut();
      expect(store.identity, isNull);
      expect(store.value, isNull);
    },
  );

  test(
    'a saved identity for another tenant or an unassigned shop is not used offline',
    () async {
      final session = controller((request) async {
        throw http.ClientException('test offline');
      });
      store.value = fixtureCredentials;
      store.identity = {
        ...identityData(),
        'shops': [
          {'id': 'other-shop', 'name': 'Other Shop', 'code': 'OS'},
        ],
      };
      await session.initialize();
      expect(session.identity, isNull);
      expect(session.initialized, false);
    },
  );

  test(
    'API-server change clears credentials instead of sending them to another server',
    () async {
      var calls = 0;
      final session = controller((request) async {
        calls++;
        return success(identityData());
      });
      store.value = Credentials(
        apiUrl: 'https://another.invalid/api/v1/',
        tenantSlug: 'test-tenant',
        accessToken: 'test-access',
        refreshToken: 'test-refresh',
        shopId: 'test-shop',
      );
      await session.initialize();
      expect(calls, 0);
      expect(store.value, isNull);
      expect(session.error, contains('Server address changed'));
    },
  );

  test(
    'feature access needs effective grants and enabled feature, independent of role names',
    () {
      final feature = featureCatalog.singleWhere(
        (f) => f.id == 'customer-searching',
      );
      expect(feature.visibleTo(Identity.fromJson(identityData())), true);
      expect(
        feature.visibleTo(
          Identity.fromJson(identityData(customerSearch: false)),
        ),
        false,
      );
      expect(
        feature.visibleTo(
          Identity.fromJson(identityData(permissions: ['nav.customer_search'])),
        ),
        false,
      );
    },
  );

  test(
    'shop selection updates both secure credentials and scoped headers',
    () async {
      final session = controller((request) async {
        if (request.url.path.endsWith('/switch-shop')) {
          return success({
            'accessToken': 'shop-access',
            'shop': {'id': 'other-shop', 'name': 'Other Shop', 'code': 'OS'},
          });
        }
        return success(identityData());
      });
      store.value = fixtureCredentials;
      await session.initialize();
      await session.switchShop('other-shop');
      expect(session.error, isNull);
      expect(store.value?.shopId, 'other-shop');
      expect(store.value?.accessToken, 'shop-access');
      await session.switchShop('unassigned-shop');
      expect(session.error, contains('cannot switch'));
      expect(store.value?.shopId, 'other-shop');
    },
  );

  test(
    'foreground revalidation: unreachable keeps confirmed access offline; a server failure blocks',
    () async {
      var mode = 'online';
      final session = controller((request) async {
        if (mode == 'offline') throw http.ClientException('test offline');
        if (mode == 'broken') return failure(500);
        return success(identityData());
      });
      store.value = fixtureCredentials;
      await session.initialize();
      mode = 'offline';
      await session.revalidate();
      expect(session.checkingAccess, false);
      expect(session.offline, true);
      expect(session.identity, isNotNull);
      mode = 'broken';
      await session.revalidate();
      expect(session.checkingAccess, true);
      expect(session.error, contains('Test API failure'));
      mode = 'online';
      await session.revalidate();
      expect(session.checkingAccess, false);
      expect(session.offline, false);
    },
  );

  test(
    'secure storage adapter roundtrips and clears only its session key',
    () async {
      FlutterSecureStorage.setMockInitialValues({'unrelated': 'keep'});
      final store = SecureSessionStore();
      await store.write(fixtureCredentials);
      expect((await store.read())?.refreshToken, 'test-refresh');
      await store.clear();
      expect(await store.read(), isNull);
      expect(await const FlutterSecureStorage().read(key: 'unrelated'), 'keep');
    },
  );
}
