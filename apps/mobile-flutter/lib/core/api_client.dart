import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'api_config.dart';
import 'session_models.dart';
import 'session_store.dart';

class ApiClient {
  ApiClient({required this.config, required this.store, http.Client? transport})
    : _transport = transport ?? http.Client();
  final ApiConfig config;
  final SessionStore store;
  final http.Client _transport;
  Credentials? _credentials;
  Credentials? get credentials => _credentials;
  int _version = 0;
  Future<void>? _refresh;
  Future<void> _storageTail = Future.value();
  void Function()? onSessionExpired;

  Future<void> _store(Future<void> Function() action) {
    // Serialize writes/deletes so an old refresh cannot restore a signed-out session.
    final next = _storageTail.then(
      (_) => action(),
      onError: (Object error, StackTrace stack) => action(),
    );
    _storageTail = next;
    return next;
  }

  Future<void> setSession(Credentials credentials) async {
    final version = ++_version;
    _refresh = null;
    await _store(() => store.write(credentials));
    if (version != _version) throw const ApiException('Session changed.');
    _credentials = credentials;
  }

  Future<void> clearSession() async {
    _version++;
    _credentials = null;
    _refresh = null;
    await _store(store.clear);
  }

  Future<Json> _send(
    String method,
    String endpoint, {
    required String tenant,
    Credentials? credentials,
    Json? body,
  }) async {
    final relative = Uri.parse(endpoint);
    if (relative.hasScheme ||
        relative.hasAuthority ||
        relative.path.startsWith('/') ||
        relative.pathSegments.contains('..')) {
      throw const ApiException(
        'API endpoints must be relative to the configured server.',
      );
    }
    final request = http.Request(method, config.baseUrl.resolveUri(relative));
    request.headers.addAll({
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Tenant-Slug': tenant,
      if (credentials != null) ...{
        'Authorization': 'Bearer ${credentials.accessToken}',
        'X-Shop-Id': credentials.shopId,
      },
    });
    if (body != null) request.body = jsonEncode(body);
    late final http.Response response;
    try {
      response = await _transport
          .send(request)
          .then(http.Response.fromStream)
          .timeout(const Duration(seconds: 30));
    } on TimeoutException {
      throw const ApiException(
        'The server timed out. Check the connection.',
        network: true,
      );
    } on http.ClientException {
      throw const ApiException(
        'Cannot reach the ERP server. Check your network.',
        network: true,
      );
    }
    late final Json envelope;
    try {
      envelope = object(jsonDecode(response.body));
    } on FormatException {
      throw ApiException(
        'The server returned invalid JSON.',
        statusCode: response.statusCode,
      );
    }
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        envelope['success'] != true) {
      final details = envelope['details'];
      throw ApiException(
        envelope['error'] is String
            ? envelope['error'] as String
            : 'Request failed (${response.statusCode}).',
        statusCode: response.statusCode,
        details: details is Map<String, dynamic>
            ? Map<String, Object?>.from(details)
            : null,
      );
    }
    return envelope;
  }

  Future<Json> login(String tenant, String username, String password) async =>
      object(
        (await _send(
          'POST',
          'auth/login',
          tenant: tenant,
          body: {'username': username.trim(), 'password': password},
        ))['data'],
      );

  Future<Json> request(String method, String endpoint, {Json? body}) async =>
      object((await requestEnvelope(method, endpoint, body: body))['data']);

  Future<Json> requestEnvelope(
    String method,
    String endpoint, {
    Json? body,
  }) async {
    final original = _credentials;
    final version = _version;
    if (original == null) throw const ApiException('Sign in to continue.');
    try {
      final data = await _send(
        method,
        endpoint,
        tenant: original.tenantSlug,
        credentials: original,
        body: body,
      );
      if (version != _version) throw const ApiException('Session changed.');
      return data;
    } on ApiException catch (error) {
      if (error.statusCode != 401) rethrow;
    }
    if (version != _version) throw const ApiException('Session changed.');
    if (_credentials?.accessToken == original.accessToken) {
      await _refreshSession(version);
    }
    final current = _credentials;
    if (current == null || version != _version) {
      throw const ApiException('Session expired. Sign in again.');
    }
    try {
      final result = await _send(
        method,
        endpoint,
        tenant: current.tenantSlug,
        credentials: current,
        body: body,
      );
      if (version != _version) throw const ApiException('Session changed.');
      return result;
    } on ApiException catch (error) {
      if (error.statusCode == 401) await _expire(version);
      rethrow;
    }
  }

  Future<void> _refreshSession(int version) async {
    final pending = _refresh;
    if (pending != null) return pending;
    final job = _rotate(version);
    _refresh = job;
    try {
      await job;
    } finally {
      if (identical(_refresh, job)) _refresh = null;
    }
  }

  Future<void> _rotate(int version) async {
    final current = _credentials;
    if (current == null) throw const ApiException('Session expired.');
    // The background updater may already have rotated the shared refresh token.
    if (await _adoptNewerStored(current, version)) return;
    try {
      final data = object(
        (await _send(
          'POST',
          'auth/refresh',
          tenant: current.tenantSlug,
          body: {'refreshToken': current.refreshToken},
        ))['data'],
      );
      final rotated = current.withTokens(data);
      await _store(() async {
        if (version != _version) throw const ApiException('Session changed.');
        // Signed out meanwhile (possibly in another isolate): don't bring it back.
        if (await _readStored() == null) {
          throw const ApiException('Session expired. Sign in again.');
        }
        await store.write(rotated);
      });
      if (version != _version) throw const ApiException('Session changed.');
      _credentials = rotated;
    } on ApiException catch (error) {
      if (error.statusCode == 401 || error.statusCode == 403) {
        // Lost a race with another isolate presenting the same token.
        if (await _adoptNewerStored(current, version)) return;
        await _expire(version);
      }
      rethrow;
    }
  }

  Future<Credentials?> _readStored() async {
    try {
      return await store.read();
    } on ApiException {
      return null;
    }
  }

  Future<bool> _adoptNewerStored(Credentials current, int version) async {
    final stored = await _readStored();
    if (stored == null ||
        version != _version ||
        stored.apiUrl != current.apiUrl ||
        stored.tenantSlug != current.tenantSlug ||
        stored.refreshToken == current.refreshToken) {
      return false;
    }
    _credentials = stored;
    return true;
  }

  /// Uses the stored session without writing it (background isolate start).
  Future<bool> restoreStored() async {
    final stored = await _readStored();
    if (stored == null || stored.apiUrl != config.baseUrl.toString()) {
      return false;
    }
    _version++;
    _refresh = null;
    _credentials = stored;
    return true;
  }

  Future<void> _expire(int version) async {
    if (version != _version) return;
    try {
      await clearSession();
    } finally {
      onSessionExpired?.call();
    }
  }

  Future<void> logout() async {
    try {
      // Refresh first, since the API rotates the refresh token on access expiry.
      await request('GET', 'auth/me');
      final current = _credentials!;
      await _send(
        'POST',
        'auth/logout',
        tenant: current.tenantSlug,
        credentials: current,
        body: {'refreshToken': current.refreshToken},
      );
    } finally {
      await clearSession();
    }
  }

  void close() => _transport.close();
}
