import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path/path.dart' as p;
import 'package:sqflite_sqlcipher/sqflite.dart';
import 'register_database.dart';

/// Opens the encrypted register of one tenant + user. Each has its own file
/// and random key (kept in the platform's secure storage), so another
/// user's copy on a shared phone is never read.
class RegisterFiles {
  RegisterFiles({FlutterSecureStorage? storage})
    : _storage = storage ?? const FlutterSecureStorage();
  final FlutterSecureStorage _storage;

  String _name(String tenantId, String userId) =>
      'register_${_safe(tenantId)}_${_safe(userId)}.db';
  static String _safe(String id) => id.replaceAll(RegExp(r'[^A-Za-z0-9-]'), '');
  String _keyName(String tenantId, String userId) =>
      'retailerp.registerKey.${_safe(tenantId)}.${_safe(userId)}';

  Future<String> _path(String tenantId, String userId) async =>
      p.join(await getDatabasesPath(), _name(tenantId, userId));

  /// Where this user's copy lives (for size checks).
  Future<String> pathOf(String tenantId, String userId) =>
      _path(tenantId, userId);

  Future<String> _key(String tenantId, String userId) async {
    final name = _keyName(tenantId, userId);
    final existing = await _storage.read(key: name);
    if (existing != null) return existing;
    final random = Random.secure();
    final key = base64Url.encode(
      List<int>.generate(32, (_) => random.nextInt(256)),
    );
    await _storage.write(key: name, value: key);
    return key;
  }

  Future<RegisterDatabase> open(String tenantId, String userId) async {
    final path = await _path(tenantId, userId);
    final key = await _key(tenantId, userId);
    Future<Database> attempt() => openDatabase(
      path,
      password: key,
      version: schemaVersion,
      onConfigure: configureRegisterDb,
      onCreate: (db, _) => createRegisterSchema(db),
      onUpgrade: upgradeRegisterSchema,
      onDowngrade: upgradeRegisterSchema,
    );
    try {
      return RegisterDatabase(await attempt());
    } on DatabaseException {
      // Unreadable (e.g. the key was lost on reinstall): start a fresh copy.
      await deleteDatabase(path);
      return RegisterDatabase(await attempt());
    }
  }

  /// Removes the copy and its key (the user lost access to the register).
  Future<void> delete(String tenantId, String userId) async {
    final path = await _path(tenantId, userId);
    await deleteDatabase(path);
    for (final suffix in ['-wal', '-shm', '-journal']) {
      final extra = File('$path$suffix');
      if (await extra.exists()) await extra.delete();
    }
    await _storage.delete(key: _keyName(tenantId, userId));
  }
}
