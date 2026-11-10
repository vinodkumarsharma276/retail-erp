import 'dart:async';
import 'dart:math';
import '../../core/api_client.dart';
import '../../core/session_models.dart';
import 'register_database.dart';

enum RegisterSyncOutcome { updated, skipped, failed }

class RegisterSyncResult {
  const RegisterSyncResult(this.outcome, {this.error, this.pages = 0});
  final RegisterSyncOutcome outcome;
  final ApiException? error;
  final int pages;
}

/// Brings the device copy up to date through `GET customer-search/sync`.
/// One run at a time per process (single flight) and per device (a lease in
/// the database, shared with the background updater).
class RegisterSync {
  RegisterSync(
    this.api,
    this.db, {
    String? owner,
    DateTime Function()? clock,
    this.onProgress,
  }) : owner = owner ?? processOwner,
       _now = clock ?? DateTime.now;

  /// One lease owner per isolate: a screen reopened after its controller was
  /// disposed mid-download can take over its own lease instead of waiting
  /// for it to expire. The background isolate passes its own name.
  static final processOwner = 'app-${Random().nextInt(1 << 32)}';

  final ApiClient api;
  final RegisterDatabase db;
  final String owner;
  final DateTime Function() _now;
  final void Function()? onProgress;
  static const leaseTime = Duration(minutes: 5);
  Future<RegisterSyncResult>? _running;

  bool get running => _running != null;

  Future<RegisterSyncResult> run() =>
      _running ??= _run().whenComplete(() => _running = null);

  Future<RegisterSyncResult> _run() async {
    try {
      if (!await db.acquireLease(owner, leaseTime, _now())) {
        return const RegisterSyncResult(RegisterSyncOutcome.skipped);
      }
    } on Object catch (error) {
      return RegisterSyncResult(
        RegisterSyncOutcome.failed,
        error: ApiException('The saved register could not be opened: $error'),
      );
    }
    var pages = 0;
    var resets = 0;
    try {
      while (true) {
        final token = await db.cursor ?? await db.bootToken;
        final Json page;
        try {
          page = await api.request(
            'GET',
            token == null
                ? 'customer-search/sync'
                : 'customer-search/sync?token=${Uri.encodeQueryComponent(token)}',
          );
        } on ApiException catch (error) {
          if (error.statusCode == 410 && resets++ < 2) {
            // What the user may see changed: drop it before downloading again.
            if (error.details?['reason'] == 'projection') {
              await db.purge();
            } else {
              await db.restartDownload();
            }
            continue;
          }
          rethrow;
        }
        await db.applyPage(page);
        pages++;
        if (pages % 10 == 0) await db.acquireLease(owner, leaseTime, _now());
        onProgress?.call();
        if (page['more'] != true) break;
        if (pages > 100000) {
          throw const ApiException('The register update did not finish.');
        }
      }
      await db.recordSuccess(_now());
      return RegisterSyncResult(RegisterSyncOutcome.updated, pages: pages);
    } on ApiException catch (error) {
      await _quietly(() => db.recordError(error.message));
      return RegisterSyncResult(
        RegisterSyncOutcome.failed,
        error: error,
        pages: pages,
      );
    } on Object catch (error) {
      // e.g. the database was closed under us; never leave a run hanging.
      final failure = ApiException('The register update stopped: $error');
      await _quietly(() => db.recordError(failure.message));
      return RegisterSyncResult(
        RegisterSyncOutcome.failed,
        error: failure,
        pages: pages,
      );
    } finally {
      await _quietly(() => db.releaseLease(owner));
    }
  }

  static Future<void> _quietly(Future<void> Function() action) async {
    try {
      await action();
    } on Object {
      // Best effort: the copy may already be closed.
    }
  }
}
