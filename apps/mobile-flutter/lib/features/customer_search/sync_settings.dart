import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// How often this phone checks the register for changes (a per-phone choice).
/// 0 means only while the app is open. Android runs background work at most
/// every 15 minutes, and only when the system allows it.
class SyncSettings {
  SyncSettings({FlutterSecureStorage? storage})
    : _storage = storage ?? const FlutterSecureStorage();
  final FlutterSecureStorage _storage;
  static const _key = 'retailerp.registerSyncMinutes';
  static const choices = [15, 30, 60, 0];
  static const defaultMinutes = 15;

  Future<int> readMinutes() async {
    try {
      final value = int.tryParse(await _storage.read(key: _key) ?? '');
      return choices.contains(value) ? value! : defaultMinutes;
    } on Exception {
      return defaultMinutes;
    }
  }

  Future<void> writeMinutes(int minutes) =>
      _storage.write(key: _key, value: '$minutes');

  static String label(int minutes) =>
      minutes == 0 ? 'Only while the app is open' : 'Every $minutes minutes';
}
