import 'dart:convert';
import 'package:sqflite_sqlcipher/sqflite.dart';
import '../../core/session_models.dart';
import 'register_models.dart';

const _entryColumns = '''
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  account_number TEXT NOT NULL,
  prefix TEXT NOT NULL,
  series_no INTEGER,
  customer_id TEXT,
  customer_name TEXT NOT NULL,
  mobile TEXT,
  alt_mobile TEXT,
  address TEXT,
  area TEXT,
  co_customer_id TEXT,
  co_name TEXT,
  co_mobile TEXT,
  co_alt_mobile TEXT,
  more_addresses TEXT,
  co_address TEXT,
  co_more_addresses TEXT,
  purchase_date TEXT,
  category_id TEXT,
  product TEXT,
  brand TEXT,
  model TEXT,
  issues TEXT NOT NULL,
  raw_values TEXT,
  source TEXT NOT NULL,
  customer_code TEXT,
  co_customer_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  search_text TEXT NOT NULL
''';

const schemaVersion = 6;

/// Per-connection settings. The larger page cache keeps decrypted pages in
/// memory between searches; incremental auto-vacuum (effective on a new
/// file) lets a finished download give back the space of the copy it
/// replaced; recursive triggers make `INSERT OR REPLACE` keep the text index.
Future<void> configureRegisterDb(Database db) async {
  await db.rawQuery('PRAGMA busy_timeout = 5000');
  await db.rawQuery('PRAGMA cache_size = -32768');
  await db.rawQuery('PRAGMA auto_vacuum = INCREMENTAL');
  await db.rawQuery('PRAGMA recursive_triggers = ON');
}

Future<void> _createEntryIndexes(DatabaseExecutor db) async {
  for (final column in [
    'customer_id',
    'prefix',
    'purchase_date',
    'category_id',
  ]) {
    await db.execute('CREATE INDEX entries_$column ON entries ($column)');
  }
}

/// Every mobile of the entry, for the phone-number index.
String _phones(String row) =>
    "coalesce(${row}mobile, '') || ' ' || coalesce(${row}alt_mobile, '') || ' ' || "
    "coalesce(${row}co_mobile, '') || ' ' || coalesce(${row}co_alt_mobile, '')";

final _textValues = 'new.account_number, new.search_text, ${_phones('new.')}';

/// Keeps `entry_text` (the substring index) in step with `entries`.
Future<void> _createTextTriggers(DatabaseExecutor db) async {
  await db.execute(
    'CREATE TRIGGER entries_text_insert AFTER INSERT ON entries BEGIN '
    'INSERT INTO entry_text (rowid, account, text, phones) VALUES (new.rowid, $_textValues); END',
  );
  await db.execute(
    'CREATE TRIGGER entries_text_delete AFTER DELETE ON entries BEGIN '
    'DELETE FROM entry_text WHERE rowid = old.rowid; END',
  );
  await db.execute(
    'CREATE TRIGGER entries_text_update AFTER UPDATE ON entries BEGIN '
    'DELETE FROM entry_text WHERE rowid = old.rowid; '
    'INSERT INTO entry_text (rowid, account, text, phones) VALUES (new.rowid, $_textValues); END',
  );
}

Future<void> createRegisterSchema(Database db) async {
  await db.execute('CREATE TABLE entries ($_entryColumns)');
  // The download in progress; renamed to `entries` only when complete.
  await db.execute('CREATE TABLE staging_entries ($_entryColumns)');
  await db.execute(
    'CREATE TABLE shops (id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL)',
  );
  await db.execute('''CREATE TABLE categories (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT, path TEXT NOT NULL,
    level INTEGER NOT NULL, is_leaf INTEGER NOT NULL, is_active INTEGER NOT NULL,
    display_order INTEGER NOT NULL)''');
  await db.execute(
    'CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  );
  await _createEntryIndexes(db);
  // A trigram index answers substring searches of 3+ characters without
  // reading every row. detail=column keeps it small (no positions; FTS5
  // confirms a phrase against the stored text). Builds without FTS5 scan.
  try {
    await db.execute(
      "CREATE VIRTUAL TABLE entry_text USING fts5(account, text, phones, tokenize = 'trigram', detail = 'column')",
    );
    await _createTextTriggers(db);
    await db.insert('meta', {'key': 'text_index', 'value': '1'});
  } on DatabaseException {
    await db.insert('meta', {'key': 'text_index', 'value': '0'});
  }
}

/// Versions 5 and 6 only added columns (second mobiles; more addresses and the
/// co-applicant's address), empty on every row until the next update, so a
/// version 4 or 5 copy gains them in place instead of downloading the register
/// again. Any other older layout is replaced; the copy can always be
/// downloaded again.
Future<void> upgradeRegisterSchema(Database db, int from, int to) async {
  if (from >= 4 && to == 6) {
    final columns = [
      if (from < 5) ...['alt_mobile', 'co_alt_mobile'],
      ...['more_addresses', 'co_address', 'co_more_addresses'],
    ];
    for (final table in ['entries', 'staging_entries']) {
      for (final column in columns) {
        await db.execute('ALTER TABLE $table ADD COLUMN $column TEXT');
      }
    }
    final index = await db.rawQuery(
      "SELECT value FROM meta WHERE key = 'text_index'",
    );
    if (from < 5 && index.isNotEmpty && index.first['value'] == '1') {
      for (final trigger in ['insert', 'delete', 'update']) {
        await db.execute('DROP TRIGGER IF EXISTS entries_text_$trigger');
      }
      await _createTextTriggers(db);
    }
    // Rows synced by the older app lack the new fields: download a fresh copy
    // in the background while this one stays on screen.
    await db.delete('staging_entries');
    await db.execute("DELETE FROM meta WHERE key IN ('cursor', 'boot_token')");
    return;
  }
  for (final table in [
    'entry_text',
    'entries',
    'staging_entries',
    'shops',
    'categories',
    'meta',
  ]) {
    await db.execute('DROP TABLE IF EXISTS $table');
  }
  await createRegisterSchema(db);
}

/// Where the device is in the register sync, and how fresh its copy is.
class RegisterStatus {
  const RegisterStatus({
    required this.entries,
    required this.downloading,
    required this.downloaded,
    required this.lastSuccess,
    required this.lastError,
    required this.phonesVisible,
  });
  final int entries;

  /// A full download is in progress (the previous copy is still shown).
  final bool downloading;
  final int downloaded;
  final DateTime? lastSuccess;
  final String? lastError;

  /// Whether this user's copy includes mobile numbers.
  final bool phonesVisible;
  bool get hasCopy => lastSuccess != null || entries > 0;
}

/// The encrypted on-device register of one tenant + user.
class RegisterDatabase {
  RegisterDatabase(this.db);
  final Database db;

  Future<String?> _meta(DatabaseExecutor ex, String key) async {
    final rows = await ex.query(
      'meta',
      columns: ['value'],
      where: 'key = ?',
      whereArgs: [key],
    );
    return rows.isEmpty ? null : rows.first['value'] as String;
  }

  Future<void> _setMeta(DatabaseExecutor ex, String key, String? value) =>
      value == null
      ? ex.delete('meta', where: 'key = ?', whereArgs: [key])
      : ex.insert('meta', {
          'key': key,
          'value': value,
        }, conflictAlgorithm: ConflictAlgorithm.replace);

  Future<String?> get cursor => _meta(db, 'cursor');
  Future<String?> get bootToken => _meta(db, 'boot_token');

  Future<RegisterStatus> status() async {
    final count = Sqflite.firstIntValue(
      await db.rawQuery('SELECT COUNT(*) FROM entries'),
    )!;
    final staged = Sqflite.firstIntValue(
      await db.rawQuery('SELECT COUNT(*) FROM staging_entries'),
    )!;
    final last = await _meta(db, 'last_success');
    final projection = await _meta(db, 'projection');
    return RegisterStatus(
      entries: count,
      downloading: await bootToken != null,
      downloaded: staged,
      lastSuccess: last == null ? null : DateTime.parse(last),
      lastError: await _meta(db, 'last_error'),
      phonesVisible:
          projection != null && jsonDecode(projection)['phones'] == true,
    );
  }

  Future<void> recordSuccess(DateTime at) async {
    await _setMeta(db, 'last_success', at.toUtc().toIso8601String());
    await _setMeta(db, 'last_error', null);
  }

  Future<void> recordError(String message) =>
      _setMeta(db, 'last_error', message);

  /// One owner at a time across isolates (app and background updater).
  Future<bool> acquireLease(String owner, Duration ttl, DateTime now) =>
      db.transaction((tx) async {
        final raw = await _meta(tx, 'lease');
        if (raw != null) {
          final lease = jsonDecode(raw) as Map<String, Object?>;
          final until = DateTime.parse(lease['until'] as String);
          if (lease['owner'] != owner && until.isAfter(now)) return false;
        }
        await _setMeta(
          tx,
          'lease',
          jsonEncode({
            'owner': owner,
            'until': now.add(ttl).toUtc().toIso8601String(),
          }),
        );
        return true;
      });

  Future<void> releaseLease(String owner) => db.transaction((tx) async {
    final raw = await _meta(tx, 'lease');
    if (raw != null && (jsonDecode(raw) as Map)['owner'] == owner) {
      await _setMeta(tx, 'lease', null);
    }
  });

  Future<void> _insertAll(
    Transaction tx,
    String table,
    List<RegisterEntry> rows,
  ) async {
    final batch = tx.batch();
    for (final row in rows) {
      batch.insert(
        table,
        row.toRow(),
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    }
    await batch.commit(noResult: true);
  }

  Future<void> _replaceReference(Transaction tx, Json? reference) async {
    if (reference == null) return;
    await tx.delete('shops');
    await tx.delete('categories');
    final batch = tx.batch();
    for (final s in (reference['shops'] as List).cast<Map>()) {
      batch.insert('shops', {
        'id': s['id'],
        'name': s['name'],
        'code': s['code'],
      });
    }
    for (final c in (reference['categories'] as List).cast<Map>()) {
      batch.insert('categories', {
        'id': c['id'],
        'name': c['name'],
        'parent_id': c['parentId'],
        'path': c['path'],
        'level': c['level'],
        'is_leaf': c['isLeaf'] == true ? 1 : 0,
        'is_active': c['isActive'] == true ? 1 : 0,
        'display_order': c['displayOrder'] ?? 0,
      });
    }
    await batch.commit(noResult: true);
  }

  /// Applies one `/sync` response and moves the position in the same
  /// transaction, so an interrupted run resumes without losing or skipping rows.
  Future<void> applyPage(Json page) async {
    final swapped = await db.transaction((tx) async {
      final entries = (page['entries'] as List)
          .map((e) => RegisterEntry.fromApi(object(e)))
          .toList();
      final next = requiredText(page, 'next');
      final reference = page['reference'] is Map
          ? object(page['reference'])
          : null;
      if (page['phase'] == 'bootstrap') {
        if (page['start'] == true) await tx.delete('staging_entries');
        await _insertAll(tx, 'staging_entries', entries);
        if (page['complete'] == true) {
          // Rename rather than copy, so the download is written only once.
          await tx.execute('DROP TABLE entries');
          await tx.execute('ALTER TABLE staging_entries RENAME TO entries');
          await tx.execute('CREATE TABLE staging_entries ($_entryColumns)');
          await _createEntryIndexes(tx);
          if (await _meta(tx, 'text_index') == '1') {
            await tx.execute('DELETE FROM entry_text');
            await tx.execute(
              'INSERT INTO entry_text (rowid, account, text, phones) '
              'SELECT rowid, account_number, search_text, ${_phones('')} FROM entries',
            );
            await _createTextTriggers(tx);
          }
          await _replaceReference(tx, reference);
          await _setMeta(tx, 'cursor', next);
          await _setMeta(tx, 'boot_token', null);
          await _setMeta(tx, 'projection', jsonEncode(page['projection']));
          return true;
        }
        await _setMeta(tx, 'boot_token', next);
        return false;
      }
      await _insertAll(tx, 'entries', entries);
      final deleted = (page['deleted'] as List).cast<String>();
      for (var i = 0; i < deleted.length; i += 500) {
        final ids = deleted.sublist(i, (i + 500).clamp(0, deleted.length));
        await tx.delete(
          'entries',
          where: 'id IN (${List.filled(ids.length, '?').join(',')})',
          whereArgs: ids,
        );
      }
      await _replaceReference(tx, reference);
      await _setMeta(tx, 'cursor', next);
      return false;
    });
    // Give back the space of the copy just replaced.
    if (swapped) await db.rawQuery('PRAGMA incremental_vacuum');
  }

  /// Start the download over but keep showing the current copy meanwhile.
  Future<void> restartDownload() => db.transaction((tx) async {
    await tx.delete('staging_entries');
    await _setMeta(tx, 'cursor', null);
    await _setMeta(tx, 'boot_token', null);
  });

  /// Drop every cached row now (e.g. the user may no longer see phones).
  Future<void> purge() => db.transaction((tx) async {
    await tx.delete('entries');
    await tx.delete('staging_entries');
    await tx.delete('shops');
    await tx.delete('categories');
    for (final key in ['cursor', 'boot_token', 'projection', 'last_success']) {
      await _setMeta(tx, key, null);
    }
  });

  Future<List<RegisterShop>> shops() async =>
      (await db.query('shops', orderBy: 'code'))
          .map(
            (r) => RegisterShop(
              r['id'] as String,
              r['name'] as String,
              r['code'] as String,
            ),
          )
          .toList();

  Future<List<RegisterCategory>> categories() async =>
      (await db.query('categories', orderBy: 'level, display_order, name'))
          .map(
            (r) => RegisterCategory(
              id: r['id'] as String,
              name: r['name'] as String,
              parentId: r['parent_id'] as String?,
              path: r['path'] as String,
              level: r['level'] as int,
              isLeaf: r['is_leaf'] == 1,
              isActive: r['is_active'] == 1,
              displayOrder: r['display_order'] as int,
            ),
          )
          .toList();

  Future<int> needsReviewCount() async => Sqflite.firstIntValue(
    await db.rawQuery("SELECT COUNT(*) FROM entries WHERE issues <> '[]'"),
  )!;

  /// Series in use with their entry counts, A–Z.
  Future<List<(String, int)>> prefixes() async => (await db.rawQuery(
    "SELECT prefix, COUNT(*) AS n FROM entries WHERE prefix <> '' GROUP BY prefix ORDER BY prefix",
  )).map((r) => (r['prefix'] as String, r['n'] as int)).toList();

  /// Areas already used (case variants merged, in capitals), most used first.
  /// Values without two letters in a row (a mobile typed into Area, often
  /// "9.91E+09") are left out.
  Future<List<String>> areas() async => (await db.rawQuery(
    "SELECT upper(trim(area)) AS a, COUNT(*) AS n FROM entries "
    "WHERE area GLOB '*[A-Za-z][A-Za-z]*' GROUP BY a ORDER BY n DESC, a",
  )).map((r) => r['a'] as String).toList();

  Future<RegisterEntry?> entry(String id) async {
    final rows = await db.rawQuery(
      'SELECT e.*, (SELECT COUNT(*) FROM entries c WHERE c.customer_id = e.customer_id) AS item_count '
      'FROM entries e WHERE e.id = ?',
      [id],
    );
    return rows.isEmpty ? null : RegisterEntry.fromRow(rows.first);
  }

  static String _like(String text) =>
      '%${text.replaceAll(r'\', r'\\').replaceAll('%', r'\%').replaceAll('_', r'\_')}%';

  bool? _textIndex;

  /// "Search in" one column: entries whose value is exactly the text,
  /// ignoring case and extra spaces, as on the web — "mn 1" finds MN 1, not
  /// MN 10…MN 199. A mobile is the full 10 digits and matches either number;
  /// a product type includes its sub-types; a brand matches one make of a
  /// cell naming several.
  void _fieldCondition(
    RegisterField field,
    String q,
    List<String> where,
    List<Object?> args,
  ) {
    final text = q.replaceAll(RegExp(r'\s+'), ' ').trim().toLowerCase();
    final digits = q.replaceAll(RegExp(r'\D'), '');
    final mobile =
        digits.length >= 10 &&
            digits.length == q.replaceAll(RegExp(r'[\s+-]'), '').length
        ? digits.substring(digits.length - 10)
        : null;
    switch (field) {
      case RegisterField.all:
        return;
      case RegisterField.account:
        where.add(
          '(upper(e.account_number) = ? OR upper(e.account_number) = ?)',
        );
        args.addAll([accountSearchText(q), normalizeAccountNumber(q)]);
      case RegisterField.name:
        where.add('lower(e.customer_name) = ?');
        args.add(text);
      case RegisterField.mobile:
        if (mobile == null) {
          where.add('0');
          return;
        }
        where.add('(e.mobile = ? OR e.alt_mobile = ?)');
        args.addAll([mobile, mobile]);
      case RegisterField.coApplicant:
        if (mobile != null) {
          where.add('(e.co_mobile = ? OR e.co_alt_mobile = ?)');
          args.addAll([mobile, mobile]);
        } else {
          where.add('lower(e.co_name) = ?');
          args.add(text);
        }
      case RegisterField.area:
        where.add('lower(trim(e.area)) = ?');
        args.add(text);
      case RegisterField.product:
        where.add(
          '(lower(e.product) = ? OR e.category_id IN ('
          'SELECT c.id FROM categories c JOIN categories t ON lower(t.name) = ? '
          "WHERE c.id = t.id OR c.path LIKE t.path || '.%'))",
        );
        args.addAll([text, text]);
      case RegisterField.brand:
        where.add(
          "(lower(e.brand) = ? OR lower(e.brand) LIKE ? ESCAPE '\\' "
          "OR lower(e.brand) LIKE ? ESCAPE '\\' OR lower(e.brand) LIKE ? ESCAPE '\\')",
        );
        final make = _escape(text);
        args.addAll([text, '$make, %', '%, $make', '%, $make, %']);
      case RegisterField.model:
        where.add('lower(e.model) = ?');
        args.add(text);
      case RegisterField.customerCode:
        where.add(
          '(upper(e.customer_code) = ? OR upper(e.co_customer_code) = ?)',
        );
        args.addAll([text.toUpperCase(), text.toUpperCase()]);
    }
  }

  static String _escape(String text) => text
      .replaceAll(r'\', r'\\')
      .replaceAll('%', r'\%')
      .replaceAll('_', r'\_');

  /// The web's register search (`whereFor`), on the device copy.
  Future<RegisterPage> search(
    RegisterQuery query, {
    int limit = 50,
    int offset = 0,
  }) async {
    _textIndex ??= await _meta(db, 'text_index') == '1';
    final where = <String>[];
    final args = <Object?>[];
    final q = query.text.trim();
    if (q.isNotEmpty) {
      final lower = q.toLowerCase();
      final account = accountSearchText(q);
      final digits = q.replaceAll(RegExp(r'\D'), '');
      final phone =
          digits.length >= 3 &&
          digits.length == q.replaceAll(RegExp(r'[\s+-]'), '').length;
      final tail = digits.length > 10
          ? digits.substring(digits.length - 10)
          : digits;
      // The trigram index serves LIKE on one column at a time, for patterns
      // of 3+ characters; anything else (or a % / _ in the text) scans.
      final wildcard = RegExp(r'[%_\\]');
      final indexed = _textIndex! && lower.length >= 3 && !wildcard.hasMatch(q);
      if (query.field != RegisterField.all) {
        _fieldCondition(query.field, q, where, args);
      } else if (indexed && account.length >= 3) {
        where.add(
          'e.rowid IN ('
          'SELECT rowid FROM entry_text WHERE account LIKE ? '
          'UNION SELECT rowid FROM entry_text WHERE text LIKE ? '
          '${phone ? 'UNION SELECT rowid FROM entry_text WHERE phones LIKE ? ' : ''}'
          "UNION SELECT rowid FROM entries WHERE category_id IN (SELECT id FROM categories WHERE lower(name) LIKE ? ESCAPE '\\'))",
        );
        args.addAll([
          '%$account%',
          '%$lower%',
          if (phone) '%$tail%',
          _like(lower),
        ]);
      } else {
        final or = <String>[
          r"e.account_number LIKE ? ESCAPE '\'",
          r"e.search_text LIKE ? ESCAPE '\'",
          r"e.category_id IN (SELECT id FROM categories WHERE lower(name) LIKE ? ESCAPE '\')",
        ];
        args.addAll([_like(account), _like(lower), _like(lower)]);
        if (phone) {
          or.addAll([
            'e.mobile LIKE ?',
            'e.alt_mobile LIKE ?',
            'e.co_mobile LIKE ?',
            'e.co_alt_mobile LIKE ?',
          ]);
          args.addAll(List.filled(4, '%$tail%'));
        }
        where.add('(${or.join(' OR ')})');
      }
    }
    if (query.prefix != null) {
      where.add('e.prefix = ?');
      args.add(normalizeAccountNumber(query.prefix!));
    }
    if (query.issue == 'any') {
      where.add("e.issues <> '[]'");
    } else if (query.issue != null) {
      where.add('instr(e.issues, ?) > 0');
      args.add('"${query.issue}"');
    }
    if ((query.area ?? '').trim().isNotEmpty) {
      where.add(r"lower(e.area) LIKE ? ESCAPE '\'");
      args.add(_like(query.area!.trim().toLowerCase()));
    }
    if (query.shopId != null) {
      where.add('e.shop_id = ?');
      args.add(query.shopId);
    }
    if (query.customerId != null) {
      where.add('(e.customer_id = ? OR e.co_customer_id = ?)');
      args.addAll([query.customerId, query.customerId]);
    }
    if (query.categoryId == 'none') {
      where.add('e.category_id IS NULL');
    } else if (query.categoryId != null) {
      where.add(
        "e.category_id IN (SELECT c.id FROM categories c, categories t WHERE t.id = ? AND (c.id = t.id OR c.path LIKE t.path || '.%'))",
      );
      args.add(query.categoryId);
    }
    if (query.dateFrom != null) {
      where.add('e.purchase_date >= ?');
      args.add(query.dateFrom);
    }
    if (query.dateTo != null) {
      where.add('e.purchase_date <= ?');
      args.add(query.dateTo);
    }
    final clause = where.isEmpty ? '' : 'WHERE ${where.join(' AND ')}';
    // Descending puts undated entries last (NULL sorts lowest), as on the web,
    // and lets the purchase_date index serve the order.
    const order = 'ORDER BY purchase_date DESC, account_number ASC';
    const itemCount =
        '(SELECT COUNT(*) FROM entries c WHERE c.customer_id = p.customer_id) AS item_count';
    if (q.isEmpty) {
      final total = Sqflite.firstIntValue(
        await db.rawQuery('SELECT COUNT(*) FROM entries e $clause', args),
      )!;
      final rows = await db.rawQuery(
        'SELECT p.*, $itemCount FROM (SELECT e.* FROM entries e $clause $order LIMIT ? OFFSET ?) p $order',
        [...args, limit, offset],
      );
      return RegisterPage(rows.map(RegisterEntry.fromRow).toList(), total);
    }
    // Text search: the page and the total from one pass over the matches.
    final rows = await db.rawQuery(
      'SELECT p.*, $itemCount '
      'FROM (SELECT e.*, COUNT(*) OVER () AS total_rows FROM entries e $clause $order LIMIT ? OFFSET ?) p '
      '$order',
      [...args, limit, offset],
    );
    final total = rows.isNotEmpty
        ? rows.first['total_rows'] as int
        : Sqflite.firstIntValue(
            await db.rawQuery('SELECT COUNT(*) FROM entries e $clause', args),
          )!;
    return RegisterPage(rows.map(RegisterEntry.fromRow).toList(), total);
  }

  Future<void> close() => db.close();
}
