import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:retailerp_mobile/core/api_client.dart';
import 'package:retailerp_mobile/core/api_config.dart';
import 'package:retailerp_mobile/core/session_models.dart';
import 'package:retailerp_mobile/features/customer_search/register_database.dart';
import 'package:retailerp_mobile/features/customer_search/register_models.dart';
import 'package:retailerp_mobile/features/customer_search/register_sync.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import '../fixtures.dart';

/// A small stand-in for `GET /customer-search/sync` with the same contract:
/// bootstrap pages by id, then a change log replayed as current rows.
class FakeRegisterServer {
  final entries = <String, Json>{};
  final log = <String>[];
  bool phones = true;
  int pageSize = 2;
  int batch = 3;
  int requests = 0;

  /// Fail the request with this number (1-based) as if the network dropped.
  int? dropRequest;

  void put(Json entry) {
    entries[entry['id'] as String] = entry;
    log.add(entry['id'] as String);
  }

  void remove(String id) {
    entries.remove(id);
    log.add(id);
  }

  String get _p => phones ? 'p1' : 'p0';

  Json _project(Json e) =>
      {...e, if (!phones) 'mobile': null, if (!phones) 'coMobile': null}
        ..removeWhere((k, v) => !phones && (k == 'mobile' || k == 'coMobile'));

  static final reference = {
    'shops': [
      {'id': 'shop-1', 'name': 'Vinod Electronics', 'code': 'VE'},
      {'id': 'shop-2', 'name': 'Naveen Electronics', 'code': 'NE'},
    ],
    'categories': [
      {
        'id': 'tv',
        'name': 'TV',
        'parentId': null,
        'path': 'tv',
        'level': 0,
        'isLeaf': false,
        'isActive': true,
        'displayOrder': 0,
      },
      {
        'id': 'led',
        'name': 'LED TV',
        'parentId': 'tv',
        'path': 'tv.led',
        'level': 1,
        'isLeaf': true,
        'isActive': true,
        'displayOrder': 0,
      },
      {
        'id': 'fridge',
        'name': 'Fridge',
        'parentId': null,
        'path': 'fridge',
        'level': 0,
        'isLeaf': true,
        'isActive': true,
        'displayOrder': 1,
      },
    ],
  };

  http.Response handle(http.Request request) {
    requests++;
    if (requests == dropRequest) throw http.ClientException('dropped');
    final token = request.url.queryParameters['token'];
    Json page;
    if (token == null || token.startsWith('b:')) {
      final parts = token?.split(':');
      if (parts != null && parts[1] != _p) return _gone('projection');
      final c0 = parts == null ? log.length : int.parse(parts[2]);
      final after = parts == null ? '' : parts.sublist(3).join(':');
      final ids = entries.keys.where((id) => id.compareTo(after) > 0).toList()
        ..sort();
      final rows = ids.take(pageSize).toList();
      final done = rows.length < pageSize;
      page = {
        'phase': 'bootstrap',
        'start': token == null,
        'entries': rows.map((id) => _project(entries[id]!)).toList(),
        'deleted': <String>[],
        'next': done ? 'd:$_p:$c0' : 'b:$_p:$c0:${rows.last}',
        'complete': done,
        'more': true,
        'projection': {'phones': phones, 'rawValues': false},
        if (done) 'reference': reference,
      };
    } else {
      final parts = token.split(':');
      if (parts[1] != _p) return _gone('projection');
      final from = int.parse(parts[2]);
      final changed = log.skip(from).take(batch).toList();
      final ids = changed.toSet();
      final more = changed.length == batch;
      page = {
        'phase': 'delta',
        'start': false,
        'entries': ids
            .where(entries.containsKey)
            .map((id) => _project(entries[id]!))
            .toList(),
        'deleted': ids.where((id) => !entries.containsKey(id)).toList(),
        'next': 'd:$_p:${from + changed.length}',
        'complete': true,
        'more': more,
        'projection': {'phones': phones, 'rawValues': false},
        if (!more) 'reference': reference,
      };
    }
    return success(page);
  }

  http.Response _gone(String reason) => http.Response(
    jsonEncode({
      'success': false,
      'error': 'Download again',
      'details': {'reset': true, 'reason': reason},
    }),
    410,
  );
}

Json entry(
  String id, {
  String account = '',
  String name = 'Synthetic Person',
  String? mobile = '9800000000',
  String? coName,
  String? coMobile,
  String? area,
  String? date,
  String? categoryId,
  String shopId = 'shop-1',
  String? customerId,
  String? customerCode,
  List<String> issues = const [],
  String? product,
}) {
  final prefix = RegExp(r'^[A-Z]+(\d(?=[-.]))?').stringMatch(account) ?? '';
  return {
    'id': id,
    'shopId': shopId,
    'accountNumber': account,
    'prefix': prefix,
    'seriesNo': int.tryParse(
      account.replaceFirst(RegExp(r'^[A-Z]+\d?[-.]?'), ''),
    ),
    'customerId': customerId,
    'customerName': name,
    'mobile': mobile,
    'address': null,
    'area': area,
    'coCustomerId': null,
    'coName': coName,
    'coMobile': coMobile,
    'purchaseDate': date,
    'categoryId': categoryId,
    'product': product,
    'brand': null,
    'model': null,
    'issues': issues,
    'source': 'import',
    'customerCode': customerCode,
    'coCustomerCode': null,
    'createdAt': '2026-01-01T00:00:00.000Z',
    'updatedAt': '2026-01-01T00:00:00.000Z',
  };
}

void main() {
  sqfliteFfiInit();
  late FakeRegisterServer server;
  late RegisterDatabase db;
  late ApiClient api;

  setUp(() async {
    server = FakeRegisterServer();
    final raw = await databaseFactoryFfi.openDatabase(
      inMemoryDatabasePath,
      options: OpenDatabaseOptions(
        version: schemaVersion,
        singleInstance: false,
        onConfigure: configureRegisterDb,
        onCreate: (db, _) => createRegisterSchema(db),
      ),
    );
    db = RegisterDatabase(raw);
    api = ApiClient(
      config: ApiConfig('http://192.0.2.1:3001', allowHttp: true),
      store: MemorySessionStore(),
      transport: MockClient((request) async => server.handle(request)),
    );
    await api.setSession(fixtureCredentials);
  });
  tearDown(() async {
    await db.close();
    api.close();
  });

  RegisterSync syncer([String owner = 'test']) =>
      RegisterSync(api, db, owner: owner);
  Future<Set<String>> ids() async => (await db.search(
    const RegisterQuery(),
    limit: 1000,
  )).entries.map((e) => e.id).toSet();

  test(
    'first download fills the copy page by page and records when it succeeded',
    () async {
      for (var i = 1; i <= 5; i++) {
        server.put(entry('id-$i', account: 'BD-$i'));
      }
      final result = await syncer().run();
      expect(result.outcome, RegisterSyncOutcome.updated);
      expect(await ids(), {'id-1', 'id-2', 'id-3', 'id-4', 'id-5'});
      final status = await db.status();
      expect(status.lastSuccess, isNotNull);
      expect(status.downloading, false);
      expect(status.phonesVisible, true);
      expect((await db.shops()).map((s) => s.code), ['NE', 'VE']);
    },
  );

  test(
    'an interrupted re-download keeps the old copy visible and resumes without duplicates',
    () async {
      for (var i = 1; i <= 5; i++) {
        server.put(entry('id-$i'));
      }
      await syncer().run();
      await db.restartDownload();
      server.put(entry('id-6'));
      server.dropRequest = server.requests + 2; // after the first new page
      final dropped = await syncer().run();
      expect(dropped.outcome, RegisterSyncOutcome.failed);
      expect(dropped.error?.network, true);
      final mid = await db.status();
      expect(mid.downloading, true);
      expect(mid.entries, 5, reason: 'previous copy still shown');
      expect(mid.lastError, contains('Cannot reach'));

      final resumed = await syncer().run();
      expect(resumed.outcome, RegisterSyncOutcome.updated);
      expect(await ids(), {for (var i = 1; i <= 6; i++) 'id-$i'});
      expect((await db.status()).lastError, isNull);
    },
  );

  test(
    'edits to old rows, deletions and additions arrive through changes, even across a dropped page',
    () async {
      for (var i = 1; i <= 4; i++) {
        server.put(entry('id-$i', name: 'Before $i'));
      }
      await syncer().run();
      server.put(entry('id-1', name: 'Edited Old Row'));
      server.remove('id-2');
      server.put(entry('id-9', name: 'Added Later'));
      server.put(entry('id-3', name: 'Edited Twice'));
      server.put(entry('id-3', name: 'Edited Thrice'));
      server.dropRequest = server.requests + 2;
      await syncer().run();
      await syncer().run();
      expect(await ids(), {'id-1', 'id-3', 'id-4', 'id-9'});
      expect((await db.entry('id-1'))!.customerName, 'Edited Old Row');
      expect((await db.entry('id-3'))!.customerName, 'Edited Thrice');
    },
  );

  test(
    'losing phone visibility drops the copy at once, then downloads it again without phones',
    () async {
      server.put(
        entry(
          'id-1',
          mobile: '9811111111',
          coName: 'Co',
          coMobile: '9822222222',
        ),
      );
      await syncer().run();
      expect((await db.entry('id-1'))!.mobile, '9811111111');
      server.phones = false;
      await syncer().run();
      final again = (await db.entry('id-1'))!;
      expect(again.mobile, isNull, reason: 'withheld, not an empty number');
      expect(again.coMobile, isNull);
      expect((await db.status()).phonesVisible, false);
    },
  );

  test(
    'one update at a time: a held lease skips, and concurrent calls share one run',
    () async {
      server.put(entry('id-1'));
      expect(
        await db.acquireLease(
          'background',
          RegisterSync.leaseTime,
          DateTime.now(),
        ),
        true,
      );
      expect((await syncer().run()).outcome, RegisterSyncOutcome.skipped);
      await db.releaseLease('background');
      final sync = syncer();
      final results = await Future.wait([sync.run(), sync.run()]);
      expect(identical(results[0], results[1]), true);
      expect(server.requests, 2); // one bootstrap page + one delta
    },
  );

  for (final indexed in [true, false]) {
    test(
      'search follows the web: per-field substring, account number, mobile digits, filters and order '
      '(${indexed ? 'trigram index' : 'scan'})',
      () async {
        server.pageSize = 50;
        server.put(
          entry(
            'a',
            account: 'BD-12',
            name: 'Ram Lal',
            mobile: '9876543210',
            date: '2025-01-05',
            categoryId: 'led',
            customerId: 'c1',
            customerCode: 'CUST-0042',
            area: 'Shastri Nagar',
          ),
        );
        server.put(
          entry(
            'b',
            account: 'BD-13',
            name: 'Sita Devi',
            coName: 'Ram Prasad',
            mobile: '',
            date: '2025-03-01',
            categoryId: 'fridge',
            customerId: 'c2',
            issues: ['missing_mobile'],
          ),
        );
        server.put(
          entry(
            'c',
            account: 'MJ12',
            name: 'Mohan',
            mobile: '9898989898',
            date: null,
            categoryId: null,
            customerId: 'c1',
            issues: ['duplicate_account', 'no_product_type'],
            shopId: 'shop-2',
          ),
        );
        await syncer().run();
        expect(
          await db.db.query(
            'meta',
            where: 'key = ?',
            whereArgs: ['text_index'],
          ),
          [
            {'key': 'text_index', 'value': '1'},
          ],
          reason: 'the host SQLite has FTS5 trigram, like the phone',
        );
        if (!indexed) {
          await db.db.update(
            'meta',
            {'value': '0'},
            where: 'key = ?',
            whereArgs: ['text_index'],
          );
          db = RegisterDatabase(db.db);
        }
        Future<List<String>> find(RegisterQuery q) async =>
            (await db.search(q)).entries.map((e) => e.id).toList();

        expect(
          await find(const RegisterQuery(text: 'ram')),
          ['b', 'a'],
          reason: 'name or co-applicant, newest first',
        );
        expect(await find(const RegisterQuery(text: 'bd-1')), ['b', 'a']);
        expect(
          await find(const RegisterQuery(text: 'mj 12')),
          ['c'],
          reason: 'spaces are removed from account numbers, as on the web',
        );
        expect(await find(const RegisterQuery(text: 'mj12')), ['c']);
        expect(await find(const RegisterQuery(text: '43210')), [
          'a',
        ], reason: 'mobile digits');
        expect(
          await find(const RegisterQuery(text: '12')),
          ['a', 'c'],
          reason: 'two digits are not a mobile search; account numbers match',
        );
        expect(await find(const RegisterQuery(text: 'led')), [
          'a',
        ], reason: 'product type name');
        expect(await find(const RegisterQuery(text: 'cust-0042')), ['a']);
        expect(await find(const RegisterQuery(text: 'shastri')), ['a']);
        expect(
          await find(const RegisterQuery(text: 'lal\u0001sita')),
          isEmpty,
          reason: 'no match across fields',
        );
        expect(await find(const RegisterQuery(issue: 'any')), ['b', 'c']);
        expect(await find(const RegisterQuery(issue: 'no_product_type')), [
          'c',
        ]);
        expect(await find(const RegisterQuery(prefix: 'bd')), ['b', 'a']);
        expect(
          await find(const RegisterQuery(categoryId: 'tv')),
          ['a'],
          reason: 'a type includes its sub-types',
        );
        expect(await find(const RegisterQuery(categoryId: 'none')), ['c']);
        expect(await find(const RegisterQuery(shopId: 'shop-2')), ['c']);
        expect(await find(const RegisterQuery(dateFrom: '2025-02-01')), ['b']);
        final page = await db.search(const RegisterQuery(), limit: 2);
        expect(page.total, 3);
        expect((await db.entry('a'))!.customerItemCount, 2);
        expect((await db.prefixes()), [('BD', 2), ('MJ', 1)]);

        // The "Search in" column picker narrows the same text to one column.
        Future<List<String>> inField(RegisterField field, String text) =>
            find(RegisterQuery(text: text, field: field));
        expect(await inField(RegisterField.name, 'ram'), [
          'a',
        ], reason: 'not the co-applicant');
        expect(await inField(RegisterField.coApplicant, 'ram'), ['b']);
        expect(await inField(RegisterField.account, 'bd-12'), ['a']);
        expect(await inField(RegisterField.mobile, '43210'), ['a']);
        expect(await inField(RegisterField.mobile, 'ram'), isEmpty);
        expect(await inField(RegisterField.area, 'shastri'), ['a']);
        expect(await inField(RegisterField.area, 'ram'), isEmpty);
        expect(await inField(RegisterField.product, 'led'), [
          'a',
        ], reason: 'product type name');
        expect(await inField(RegisterField.product, 'ram'), isEmpty);
        expect(await inField(RegisterField.all, 'ram'), ['b', 'a']);
      },
    );
  }

  test(
    'a run left unfinished by a closed screen does not block the next one',
    () async {
      server.put(entry('id-1'));
      // The previous controller of this app process died holding the lease.
      expect(
        await db.acquireLease(
          RegisterSync.processOwner,
          RegisterSync.leaseTime,
          DateTime.now(),
        ),
        true,
      );
      final result = await RegisterSync(api, db).run();
      expect(result.outcome, RegisterSyncOutcome.updated);
      expect(await ids(), {'id-1'});
    },
  );

  test(
    'an unexpected failure (the copy closed under it) ends the run instead of hanging',
    () async {
      final raw = await databaseFactoryFfi.openDatabase(
        inMemoryDatabasePath,
        options: OpenDatabaseOptions(
          version: schemaVersion,
          singleInstance: false,
          onConfigure: configureRegisterDb,
          onCreate: (db, _) => createRegisterSchema(db),
        ),
      );
      final closed = RegisterDatabase(raw);
      await raw.close();
      final result = await RegisterSync(api, closed).run();
      expect(result.outcome, RegisterSyncOutcome.failed);
      expect(result.error, isNotNull);
    },
  );

  test(
    'the text index follows edits, deletions and a fresh download',
    () async {
      server.put(entry('id-1', name: 'Original Name'));
      server.put(entry('id-2', name: 'Second Person'));
      await syncer().run();
      Future<List<String>> find(String text) async => (await db.search(
        RegisterQuery(text: text),
      )).entries.map((e) => e.id).toList();
      expect(await find('original'), ['id-1']);
      server.put(entry('id-1', name: 'Renamed Person'));
      server.remove('id-2');
      await syncer().run();
      expect(await find('original'), isEmpty);
      expect(await find('renamed'), ['id-1']);
      expect(await find('second'), isEmpty);
      await db.restartDownload();
      await syncer().run();
      expect(await find('renamed'), ['id-1']);
      expect(await find('person'), ['id-1']);
    },
  );
}
