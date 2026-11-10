import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:retailerp_mobile/core/api_client.dart';
import 'package:retailerp_mobile/core/api_config.dart';
import 'package:retailerp_mobile/core/session_models.dart';
import 'fixtures.dart';

void main() {
  late MemorySessionStore store;
  ApiClient makeClient(Future<http.Response> Function(http.Request) handler) {
    store = MemorySessionStore();
    final api = ApiClient(
      config: ApiConfig('http://192.0.2.1:3001', allowHttp: true),
      store: store,
      transport: MockClient(handler),
    );
    addTearDown(api.close);
    return api;
  }

  test('configuration normalizes the prefix and enforces release HTTPS', () {
    expect(
      ApiConfig(
        'https://example.invalid/api/v1/',
        allowHttp: false,
      ).baseUrl.toString(),
      'https://example.invalid/api/v1/',
    );
    for (final value in [
      '',
      'ftp://example.invalid',
      'https://user:pass@example.invalid',
      'https://example.invalid?q=x',
    ]) {
      expect(() => ApiConfig(value, allowHttp: true), throwsFormatException);
    }
    expect(
      () => ApiConfig('http://192.0.2.1', allowHttp: false),
      throwsFormatException,
    );
  });

  test(
    'login sends explicit tenant and preserves password whitespace',
    () async {
      final api = makeClient((request) async {
        expect(request.url.path, '/api/v1/auth/login');
        expect(request.headers['X-Tenant-Slug'], 'test-tenant');
        expect(request.headers.containsKey('Authorization'), false);
        expect(jsonDecode(request.body), {
          'username': 'person',
          'password': ' password ',
        });
        return success(loginData());
      });
      expect(
        (await api.login('test-tenant', ' person ', ' password '))['shop'],
        {'id': 'test-shop'},
      );
    },
  );

  test(
    'concurrent 401s rotate once, persist both tokens and retry with tenant/shop headers',
    () async {
      var refreshCount = 0;
      final api = makeClient((request) async {
        if (request.url.path.endsWith('/refresh')) {
          refreshCount++;
          expect(jsonDecode(request.body), {'refreshToken': 'test-refresh'});
          await Future<void>.delayed(const Duration(milliseconds: 10));
          return success({
            'accessToken': 'rotated-access',
            'refreshToken': 'rotated-refresh',
          });
        }
        expect(request.headers['X-Tenant-Slug'], 'test-tenant');
        expect(request.headers['X-Shop-Id'], 'test-shop');
        if (request.headers['Authorization'] == 'Bearer test-access') {
          return failure(401);
        }
        expect(request.headers['Authorization'], 'Bearer rotated-access');
        return success({'ok': true});
      });
      await api.setSession(fixtureCredentials);
      final results = await Future.wait([
        api.request('GET', 'first'),
        api.request('GET', 'second'),
      ]);
      expect(refreshCount, 1);
      expect(results, [
        {'ok': true},
        {'ok': true},
      ]);
      expect(store.value?.refreshToken, 'rotated-refresh');
    },
  );

  test(
    'invalid refresh expires locally; transient refresh errors retain credentials',
    () async {
      var refreshStatus = 503;
      var expirations = 0;
      final api = makeClient(
        (request) async => failure(
          request.url.path.endsWith('/refresh') ? refreshStatus : 401,
        ),
      );
      api.onSessionExpired = () => expirations++;
      await api.setSession(fixtureCredentials);
      await expectLater(
        api.request('GET', 'protected'),
        throwsA(isA<ApiException>()),
      );
      expect(store.value, isNotNull);
      expect(expirations, 0);
      refreshStatus = 401;
      await expectLater(
        api.request('GET', 'protected'),
        throwsA(isA<ApiException>()),
      );
      expect(api.credentials, isNull);
      expect(store.value, isNull);
      expect(expirations, 1);
    },
  );

  test('a second 401 stops after one retry and expires the session', () async {
    var calls = 0;
    final api = makeClient((request) async {
      calls++;
      return request.url.path.endsWith('/refresh')
          ? success({
              'accessToken': 'new-access',
              'refreshToken': 'new-refresh',
            })
          : failure(401);
    });
    await api.setSession(fixtureCredentials);
    await expectLater(
      api.request('GET', 'protected'),
      throwsA(isA<ApiException>()),
    );
    expect(calls, 3);
    expect(store.value, isNull);
  });

  test('403 is surfaced without retrying', () async {
    var calls = 0;
    final api = makeClient((request) async {
      calls++;
      return failure(403);
    });
    await api.setSession(fixtureCredentials);
    await expectLater(
      api.request('POST', 'protected', body: {'value': 1}),
      throwsA(isA<ApiException>()),
    );
    expect(calls, 1);
  });

  test(
    'network failure is explicit and an uncertain mutation is not retried',
    () async {
      var calls = 0;
      final api = makeClient((request) async {
        calls++;
        throw http.ClientException('test disconnected');
      });
      await api.setSession(fixtureCredentials);
      await expectLater(
        api.request('POST', 'protected', body: {'value': 1}),
        throwsA(
          isA<ApiException>().having(
            (e) => e.message,
            'message',
            contains('Cannot reach'),
          ),
        ),
      );
      expect(calls, 1);
      expect(store.value, isNotNull);
    },
  );

  test(
    'absolute and parent endpoints cannot forward credentials outside the API',
    () async {
      var calls = 0;
      final api = makeClient((request) async {
        calls++;
        return success({});
      });
      await api.setSession(fixtureCredentials);
      for (final endpoint in [
        'https://another.invalid/data',
        '/outside-api',
        '../outside-api',
      ]) {
        await expectLater(
          api.request('GET', endpoint),
          throwsA(isA<ApiException>()),
        );
      }
      expect(calls, 0);
    },
  );

  test('responses from a signed-out identity are discarded', () async {
    final response = Completer<http.Response>();
    final started = Completer<void>();
    final api = makeClient((request) async {
      started.complete();
      return response.future;
    });
    await api.setSession(fixtureCredentials);
    final request = api.request('GET', 'protected');
    final expectation = expectLater(request, throwsA(isA<ApiException>()));
    await started.future;
    await api.clearSession();
    response.complete(success({'private': 'synthetic'}));
    await expectation;
  });

  test(
    'list envelopes retain array data and pagination for feature modules',
    () async {
      final api = makeClient(
        (request) async => success(
          [
            {'id': 'one'},
          ],
          pagination: {'totalItems': 1},
        ),
      );
      await api.setSession(fixtureCredentials);
      final response = await api.requestEnvelope(
        'GET',
        'customer-search?page=1',
      );
      expect(response['data'], [
        {'id': 'one'},
      ]);
      expect(response['pagination'], {'totalItems': 1});
    },
  );

  test(
    'logout revokes the rotated refresh token and always removes local credentials',
    () async {
      final api = makeClient((request) async {
        if (request.url.path.endsWith('/refresh')) {
          return success({
            'accessToken': 'new-access',
            'refreshToken': 'new-refresh',
          });
        }
        if (request.url.path.endsWith('/logout')) {
          expect(jsonDecode(request.body), {'refreshToken': 'new-refresh'});
          return failure(500);
        }
        return request.headers['Authorization'] == 'Bearer test-access'
            ? failure(401)
            : success(identityData());
      });
      await api.setSession(fixtureCredentials);
      await expectLater(api.logout(), throwsA(isA<ApiException>()));
      expect(api.credentials, isNull);
      expect(store.value, isNull);
    },
  );

  test(
    'a refresh token rotated by the background updater is adopted instead of expiring the session',
    () async {
      var expirations = 0;
      final api = makeClient((request) async {
        if (request.url.path.endsWith('/refresh')) {
          // The phone's copy was already used by the other isolate.
          return failure(401);
        }
        final auth = request.headers['Authorization'] ?? '';
        return auth.endsWith('background-access')
            ? success({'ok': true})
            : failure(401);
      });
      api.onSessionExpired = () => expirations++;
      await api.setSession(fixtureCredentials);
      store.value = Credentials(
        apiUrl: fixtureCredentials.apiUrl,
        tenantSlug: fixtureCredentials.tenantSlug,
        accessToken: 'background-access',
        refreshToken: 'background-refresh',
        shopId: fixtureCredentials.shopId,
      );
      expect(await api.request('GET', 'protected'), {'ok': true});
      expect(expirations, 0);
      expect(api.credentials?.refreshToken, 'background-refresh');
    },
  );

  test('a rotation finishing after sign-out elsewhere is not saved', () async {
    final api = makeClient((request) async {
      if (request.url.path.endsWith('/refresh')) {
        store.value = null; // signed out in another isolate meanwhile
        return success({'accessToken': 'late', 'refreshToken': 'late'});
      }
      return failure(401);
    });
    await api.setSession(fixtureCredentials);
    await expectLater(
      api.request('GET', 'protected'),
      throwsA(isA<ApiException>()),
    );
    expect(store.value, isNull);
  });

  test(
    'error details and unreachable-server failures are distinguishable',
    () async {
      var offline = false;
      final api = makeClient((request) async {
        if (offline) throw http.ClientException('test offline');
        return http.Response(
          jsonEncode({
            'success': false,
            'error': 'Changed by someone else',
            'details': {
              'code': 'stale',
              'updatedAt': '2026-01-01T00:00:00.000Z',
            },
          }),
          409,
        );
      });
      await api.setSession(fixtureCredentials);
      final conflict = await api
          .request('PATCH', 'customer-search/x', body: {})
          .then<Object?>((_) => null, onError: (Object e) => e);
      expect(conflict, isA<ApiException>());
      expect((conflict as ApiException).code, 'stale');
      expect(conflict.network, false);
      offline = true;
      final unreachable = await api
          .request('GET', 'x')
          .then<Object?>((_) => null, onError: (Object e) => e);
      expect((unreachable as ApiException).network, true);
    },
  );

  test('an in-flight refresh cannot resurrect a cleared identity', () async {
    final refreshStarted = Completer<void>();
    final refreshResult = Completer<http.Response>();
    final api = makeClient((request) async {
      if (request.url.path.endsWith('/refresh')) {
        refreshStarted.complete();
        return refreshResult.future;
      }
      return failure(401);
    });
    await api.setSession(fixtureCredentials);
    final request = api.request('GET', 'protected');
    final expectation = expectLater(request, throwsA(isA<ApiException>()));
    await refreshStarted.future;
    await api.clearSession();
    refreshResult.complete(
      success({'accessToken': 'late-access', 'refreshToken': 'late-refresh'}),
    );
    await expectation;
    expect(api.credentials, isNull);
    expect(store.value, isNull);
  });
}
