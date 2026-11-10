import 'package:flutter/foundation.dart';
import 'api_client.dart';
import 'session_models.dart';

class SessionController extends ChangeNotifier {
  SessionController(this.api) {
    api.onSessionExpired = () {
      identity = null;
      offline = false;
      checkingAccess = false;
      error = 'Session expired. Sign in again.';
      notifyListeners();
    };
  }
  final ApiClient api;
  Identity? identity;
  bool initialized = false;
  bool busy = false;
  bool checkingAccess = false;

  /// The server could not be reached, so [identity] is the last one it
  /// confirmed. Cached screens stay usable; server checks still decide writes.
  bool offline = false;
  String? error;

  Future<void> initialize() async {
    busy = true;
    error = null;
    notifyListeners();
    try {
      final saved = await api.store.read();
      if (saved != null) {
        if (saved.apiUrl != api.config.baseUrl.toString()) {
          await api.clearSession();
          error = 'Server address changed. Sign in again.';
        } else {
          await api.setSession(saved);
          try {
            await _loadIdentity();
          } on ApiException catch (failure) {
            if (!failure.network || !await _startOffline(saved)) rethrow;
          }
        }
      }
      initialized = true;
    } on ApiException catch (failure) {
      error = failure.message;
      if (api.credentials == null && failure.statusCode == 401) {
        initialized = true;
      }
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  /// Continue with the last confirmed identity when the server is unreachable.
  Future<bool> _startOffline(Credentials saved) async {
    final snapshot = await api.store.readIdentity();
    if (snapshot == null) return false;
    try {
      final last = Identity.fromJson(snapshot);
      if (last.tenantSlug != saved.tenantSlug ||
          !last.shops.any((shop) => shop.id == saved.shopId)) {
        return false;
      }
      identity = last;
      offline = true;
      return true;
    } on ApiException {
      return false;
    }
  }

  Future<void> _loadIdentity() async {
    final next = Identity.fromJson(await api.request('GET', 'auth/me'));
    final current = api.credentials!;
    if (next.tenantSlug != current.tenantSlug) {
      await api.clearSession();
      throw const ApiException('The server returned a different tenant.');
    }
    if (!next.shops.any((shop) => shop.id == current.shopId)) {
      await api.clearSession();
      throw const ApiException(
        'The saved shop is no longer assigned. Sign in again.',
      );
    }
    identity = next;
    offline = false;
    await api.store.writeIdentity(next.toJson());
  }

  Future<void> signIn(String tenant, String username, String password) async {
    busy = true;
    error = null;
    notifyListeners();
    try {
      final slug = tenant.trim().toLowerCase();
      if (!RegExp(r'^[a-z0-9]+(?:-[a-z0-9]+)*$').hasMatch(slug)) {
        throw const ApiException('Enter a valid tenant slug.');
      }
      final data = await api.login(slug, username, password);
      final returnedTenant = object(data['tenant']);
      if (returnedTenant['slug'] != slug) {
        throw const ApiException('Tenant mismatch.');
      }
      await api.setSession(
        Credentials(
          apiUrl: api.config.baseUrl.toString(),
          tenantSlug: slug,
          accessToken: requiredText(data, 'accessToken'),
          refreshToken: requiredText(data, 'refreshToken'),
          shopId: requiredText(object(data['shop']), 'id'),
        ),
      );
      await _loadIdentity();
    } on ApiException catch (failure) {
      error = failure.message;
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> revalidate() async {
    if (busy || identity == null) return;
    checkingAccess = true;
    busy = true;
    error = null;
    notifyListeners();
    try {
      await _loadIdentity();
      checkingAccess = false;
    } on ApiException catch (failure) {
      if (failure.network && api.credentials != null) {
        // Unreachable is not a denial: keep the last confirmed access, offline.
        offline = true;
        checkingAccess = false;
      } else {
        error = failure.message;
      }
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> switchShop(String shopId) async {
    if (busy) return;
    busy = true;
    error = null;
    notifyListeners();
    try {
      if (identity?.can('shop.switch') != true ||
          identity?.shops.any((shop) => shop.id == shopId) != true) {
        throw const ApiException('You cannot switch to that shop.');
      }
      final next = await api.request(
        'POST',
        'auth/switch-shop',
        body: {'shopId': shopId},
      );
      final shop = Shop.fromJson(object(next['shop']));
      if (shop.id != shopId) {
        throw const ApiException('The server returned a different shop.');
      }
      await api.setSession(
        api.credentials!.withShop(shop.id, requiredText(next, 'accessToken')),
      );
    } on ApiException catch (failure) {
      error = failure.message;
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> signOut() async {
    if (busy) return;
    identity = null;
    offline = false;
    checkingAccess = false;
    busy = true;
    error = null;
    notifyListeners();
    try {
      if (api.credentials != null) {
        await api.logout();
      } else {
        await api.clearSession();
      }
      initialized = true;
    } on ApiException catch (failure) {
      initialized = true;
      error = 'Sign-out needs attention: ${failure.message}';
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  @override
  void dispose() {
    api.onSessionExpired = null;
    api.close();
    super.dispose();
  }
}
