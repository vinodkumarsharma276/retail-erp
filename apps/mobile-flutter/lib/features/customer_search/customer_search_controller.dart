import 'dart:async';
import 'package:flutter/widgets.dart';
import '../../core/session_controller.dart';
import '../../core/session_models.dart';
import 'register_database.dart';
import 'register_models.dart';
import 'register_sync.dart';
import 'sync_settings.dart';

typedef RegisterOpener =
    Future<RegisterDatabase> Function(String tenantId, String userId);
typedef RegisterRemover = Future<void> Function(String tenantId, String userId);
typedef BackgroundScheduler = Future<void> Function(int minutes);

bool canUseRegister(Identity identity) =>
    identity.flags['mobile_app'] == true &&
    identity.can('customer_search.list', feature: 'customer_search');

/// Owns the signed-in user's encrypted register copy while the app is open:
/// keeps it up to date (on open/resume, every 5 minutes, and when searching
/// at most once a minute) and deletes it if the server says access is gone.
class CustomerSearchController extends ChangeNotifier
    with WidgetsBindingObserver {
  CustomerSearchController({
    required this.session,
    required this.opener,
    required this.remover,
    required this.settings,
    this.scheduleBackground,
    DateTime Function()? clock,
  }) : _now = clock ?? DateTime.now;

  final SessionController session;
  final RegisterOpener opener;
  final RegisterRemover remover;
  final SyncSettings settings;
  final BackgroundScheduler? scheduleBackground;
  final DateTime Function() _now;

  static const foregroundEvery = Duration(minutes: 5);
  static const searchEvery = Duration(minutes: 1);

  RegisterDatabase? db;
  RegisterSync? _sync;
  RegisterStatus? status;
  bool syncing = false;
  String? syncError;
  bool lostAccess = false;
  int intervalMinutes = SyncSettings.defaultMinutes;
  List<RegisterCategory> categories = const [];
  List<RegisterShop> shops = const [];
  List<(String, int)> prefixes = const [];

  /// Bumped whenever the copy changes, so open lists query again.
  int revision = 0;
  DateTime? _lastAttempt;
  Timer? _timer;
  String? _owner;
  bool _disposed = false;

  Identity? get _identity => session.identity;

  Future<void> start() async {
    final identity = _identity;
    if (identity == null || !canUseRegister(identity)) return;
    _owner = '${identity.tenantId}/${identity.userId}';
    WidgetsBinding.instance.addObserver(this);
    session.addListener(_onSession);
    intervalMinutes = await settings.readMinutes();
    final opened = await opener(identity.tenantId, identity.userId);
    if (_disposed) {
      await opened.close();
      return;
    }
    db = opened;
    _sync = RegisterSync(session.api, opened, onProgress: _changed);
    await _reload();
    _timer = Timer.periodic(foregroundEvery, (_) => unawaited(syncNow()));
    unawaited(scheduleBackground?.call(intervalMinutes));
    unawaited(syncNow());
  }

  void _changed() => unawaited(_reload());

  Future<void> _reload() async {
    final current = db;
    if (current == null || _disposed) return;
    status = await current.status();
    categories = await current.categories();
    shops = await current.shops();
    prefixes = await current.prefixes();
    revision++;
    if (!_disposed) notifyListeners();
  }

  /// When the server confirms (online) that the user can no longer use the
  /// register, delete this user's copy.
  void _onSession() {
    final identity = _identity;
    if (identity == null || session.offline || lostAccess) return;
    if (!canUseRegister(identity)) unawaited(_dropCopy(identity));
  }

  Future<void> _dropCopy(Identity identity) async {
    lostAccess = true;
    _timer?.cancel();
    final current = db;
    db = null;
    _sync = null;
    await current?.close();
    await remover(identity.tenantId, identity.userId);
    status = null;
    if (!_disposed) notifyListeners();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(syncNow());
  }

  /// Opportunistic update while someone is searching.
  void searched() {
    final last = _lastAttempt;
    if (last == null || _now().difference(last) >= searchEvery) {
      unawaited(syncNow());
    }
  }

  Future<RegisterSyncResult?> syncNow() async {
    final sync = _sync;
    if (sync == null || _disposed) return null;
    _lastAttempt = _now();
    syncing = true;
    notifyListeners();
    final result = await sync.run();
    if (_disposed) return result;
    syncing = false;
    syncError = result.outcome == RegisterSyncOutcome.failed
        ? result.error?.message
        : null;
    final identity = _identity;
    if (result.error?.statusCode == 403 && identity != null) {
      // Could be lost access or a disabled feature: ask the server who we are.
      await session.revalidate();
    }
    await _reload();
    return result;
  }

  Future<void> setInterval(int minutes) async {
    intervalMinutes = minutes;
    await settings.writeMinutes(minutes);
    await scheduleBackground?.call(minutes);
    notifyListeners();
  }

  Duration? get age {
    final last = status?.lastSuccess;
    return last == null ? null : _now().difference(last);
  }

  /// Older than the chosen interval plus 5 minutes (owner decision).
  bool get stale {
    final current = age;
    if (current == null) return status?.hasCopy == true;
    final every = intervalMinutes == 0
        ? foregroundEvery.inMinutes
        : intervalMinutes;
    return current > Duration(minutes: every + 5);
  }

  String typePath(String? categoryId) {
    if (categoryId == null) return '';
    final byId = {for (final c in categories) c.id: c};
    final names = <String>[];
    var current = byId[categoryId];
    while (current != null && names.length < 10) {
      names.insert(0, current.name);
      current = current.parentId == null ? null : byId[current.parentId];
    }
    return names.join(' › ');
  }

  String shopLabel(String shopId) {
    for (final s in shops) {
      if (s.id == shopId) return s.code;
    }
    return '';
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    if (_owner != null) {
      WidgetsBinding.instance.removeObserver(this);
      session.removeListener(_onSession);
    }
    unawaited(db?.close());
    super.dispose();
  }
}
