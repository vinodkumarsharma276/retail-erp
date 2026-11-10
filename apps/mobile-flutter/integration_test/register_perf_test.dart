// On-device measurement of the Customer Searching copy against an ERP server
// holding SYNTHETIC data (never real customers). Run, for example:
//   adb reverse tcp:3101 tcp:3101
//   flutter test integration_test/register_perf_test.dart -d <device> \
//     --dart-define=API_BASE_URL=http://127.0.0.1:3101 \
//     --dart-define=PERF_TENANT=<slug> --dart-define=PERF_USER=<user> \
//     --dart-define=PERF_PASSWORD=<password>
// Prints one `PERF_RESULT {...}` line. Debug-mode timings are an upper bound.
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:retailerp_mobile/core/api_client.dart';
import 'package:retailerp_mobile/core/api_config.dart';
import 'package:retailerp_mobile/core/session_models.dart';
import 'package:retailerp_mobile/core/session_store.dart';
import 'package:retailerp_mobile/features/customer_search/register_files.dart';
import 'package:retailerp_mobile/features/customer_search/register_models.dart';
import 'package:retailerp_mobile/features/customer_search/register_sync.dart';

class _Store implements SessionStore {
  Credentials? value;
  Json? identity;
  @override
  Future<Credentials?> read() async => value;
  @override
  Future<void> write(Credentials credentials) async => value = credentials;
  @override
  Future<void> clear() async => value = null;
  @override
  Future<Json?> readIdentity() async => identity;
  @override
  Future<void> writeIdentity(Json next) async => identity = next;
}

Json _toApi(RegisterEntry e, String area) => {
  'id': e.id,
  'shopId': e.shopId,
  'accountNumber': e.accountNumber,
  'prefix': e.prefix,
  'seriesNo': e.seriesNo,
  'customerId': e.customerId,
  'customerName': e.customerName,
  'mobile': e.mobile,
  'address': e.address,
  'area': area,
  'coCustomerId': e.coCustomerId,
  'coName': e.coName,
  'coMobile': e.coMobile,
  'purchaseDate': e.purchaseDate,
  'categoryId': e.categoryId,
  'product': e.product,
  'brand': e.brand,
  'model': e.model,
  'issues': e.issues,
  'source': e.source,
  'customerCode': e.customerCode,
  'coCustomerCode': e.coCustomerCode,
  'createdAt': e.createdAt,
  'updatedAt': e.updatedAt,
};

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  test(
    'synthetic register: download, size, search and change timings',
    () async {
      final store = _Store();
      final api = ApiClient(
        config: ApiConfig(
          const String.fromEnvironment('API_BASE_URL'),
          allowHttp: true,
        ),
        store: store,
      );
      const tenant = String.fromEnvironment('PERF_TENANT');
      final login = await api.login(
        tenant,
        const String.fromEnvironment('PERF_USER'),
        const String.fromEnvironment('PERF_PASSWORD'),
      );
      await api.setSession(
        Credentials(
          apiUrl: api.config.baseUrl.toString(),
          tenantSlug: tenant,
          accessToken: requiredText(login, 'accessToken'),
          refreshToken: requiredText(login, 'refreshToken'),
          shopId: requiredText(object(login['shop']), 'id'),
        ),
      );
      final identity = Identity.fromJson(await api.request('GET', 'auth/me'));
      final files = RegisterFiles();
      await files.delete(identity.tenantId, identity.userId);
      final db = await files.open(identity.tenantId, identity.userId);
      final results = <String, Object?>{};
      try {
        final download = Stopwatch()..start();
        final first = await RegisterSync(api, db, owner: 'perf').run();
        download.stop();
        expect(
          first.outcome,
          RegisterSyncOutcome.updated,
          reason: '${first.error}',
        );
        final status = await db.status();
        results['entries'] = status.entries;
        results['downloadPages'] = first.pages;
        results['downloadMs'] = download.elapsedMilliseconds;
        results['dbBytes'] = await File(
          await files.pathOf(identity.tenantId, identity.userId),
        ).length();
        results['textIndex'] =
            (await db.db.query(
              'meta',
              where: 'key = ?',
              whereArgs: ['text_index'],
            )).first['value'] ==
            '1';

        final sample = (await db.search(
          const RegisterQuery(),
          limit: 1,
        )).entries.first;
        final queries = <String, RegisterQuery>{
          'name': const RegisterQuery(text: 'kumar'),
          'nameRare': const RegisterQuery(text: 'vinay saini'),
          'account': const RegisterQuery(text: 'bd-12'),
          'mobile': RegisterQuery(
            text: (sample.mobile ?? '9876543210').substring(3, 8),
          ),
          'area': const RegisterQuery(text: 'loni'),
          'issueAny': const RegisterQuery(issue: 'any'),
          'series': const RegisterQuery(prefix: 'CI2'),
          'browseAll': const RegisterQuery(),
          'nameAndFilter': const RegisterQuery(text: 'ram', issue: 'any'),
          'noMatch': const RegisterQuery(text: 'zzzzqq'),
        };
        final timings = <int>[];
        final perQuery = <String, int>{};
        for (final entry in queries.entries) {
          var worst = 0;
          for (var i = 0; i < 5; i++) {
            final sw = Stopwatch()..start();
            await db.search(entry.value, limit: 50);
            sw.stop();
            timings.add(sw.elapsedMilliseconds);
            if (sw.elapsedMilliseconds > worst) worst = sw.elapsedMilliseconds;
          }
          perQuery[entry.key] = worst;
        }
        timings.sort();
        results['searchP50Ms'] = timings[timings.length ~/ 2];
        results['searchP95Ms'] = timings[(timings.length * 0.95).floor() - 1];
        results['searchMaxMs'] = timings.last;
        results['searchWorstPerQueryMs'] = perQuery;

        // Applying 1,000 changed rows (the device-side cost of a delta).
        final changed = (await db.search(
          const RegisterQuery(),
          limit: 1000,
        )).entries;
        final apply = Stopwatch()..start();
        await db.applyPage({
          'phase': 'delta',
          'start': false,
          'entries': changed.map((e) => _toApi(e, 'Changed Area')).toList(),
          'deleted': <String>[],
          'next': (await db.cursor)!,
          'complete': true,
          'more': false,
        });
        apply.stop();
        results['apply1000Ms'] = apply.elapsedMilliseconds;

        final idle = Stopwatch()..start();
        final again = await RegisterSync(api, db, owner: 'perf').run();
        idle.stop();
        results['emptyDeltaMs'] = idle.elapsedMilliseconds;
        expect(again.outcome, RegisterSyncOutcome.updated);
      } finally {
        await db.close();
        await files.delete(identity.tenantId, identity.userId);
        api.close();
      }
      // ignore: avoid_print
      print('PERF_RESULT ${jsonEncode(results)}');
    },
    timeout: const Timeout(Duration(minutes: 15)),
  );
}
