import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:retailerp_mobile/core/session_models.dart';
import 'package:retailerp_mobile/core/session_store.dart';

const fixtureCredentials = Credentials(
  apiUrl: 'http://192.0.2.1:3001/api/v1/',
  tenantSlug: 'test-tenant',
  accessToken: 'test-access',
  refreshToken: 'test-refresh',
  shopId: 'test-shop',
);

Json identityData({
  List<String>? permissions,
  bool customerSearch = true,
  String? role,
  Map<String, bool>? flags,
}) => {
  'user': {'id': 'test-user', 'fullName': 'Test User', 'role': ?role},
  'tenant': {
    'id': 'test-tenant-id',
    'slug': 'test-tenant',
    'name': 'Test Business',
  },
  'permissions':
      permissions ??
      ['nav.customer_search', 'customer_search.list', 'shop.switch'],
  'features': {
    'flags': flags ?? {'mobile_app': true, 'customer_search': customerSearch},
  },
  'shops': [
    {'id': 'test-shop', 'name': 'Test Shop', 'code': 'TS'},
    {'id': 'other-shop', 'name': 'Other Shop', 'code': 'OS'},
  ],
};

Json loginData() => {
  ...fixtureCredentials.toJson(),
  'tenant': {'slug': 'test-tenant'},
  'shop': {'id': 'test-shop'},
};

http.Response success(Object? data, {Json? pagination}) => http.Response(
  jsonEncode({'success': true, 'data': data, 'pagination': ?pagination}),
  200,
);

http.Response failure(int status) => http.Response(
  jsonEncode({'success': false, 'error': 'Test API failure'}),
  status,
);

class MemorySessionStore implements SessionStore {
  Credentials? value;
  Json? identity;
  @override
  Future<Credentials?> read() async => value;
  @override
  Future<void> write(Credentials credentials) async {
    value = credentials;
  }

  @override
  Future<void> clear() async {
    value = null;
    identity = null;
  }

  @override
  Future<Json?> readIdentity() async => identity;
  @override
  Future<void> writeIdentity(Json next) async {
    identity = next;
  }
}
