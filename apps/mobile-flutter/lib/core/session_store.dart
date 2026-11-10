import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'session_models.dart';

abstract interface class SessionStore {
  Future<Credentials?> read();
  Future<void> write(Credentials credentials);

  /// Removes the credentials and the saved identity (sign-out / expiry).
  Future<void> clear();

  /// The last server-confirmed identity, used only to start offline.
  Future<Json?> readIdentity();
  Future<void> writeIdentity(Json identity);
}

class SecureSessionStore implements SessionStore {
  SecureSessionStore({FlutterSecureStorage? storage})
    : _storage = storage ?? const FlutterSecureStorage();
  final FlutterSecureStorage _storage;
  static const _key = 'retailerp.session.v1';
  static const _identityKey = 'retailerp.identity.v1';

  @override
  Future<Credentials?> read() async {
    try {
      final value = await _storage.read(key: _key);
      return value == null
          ? null
          : Credentials.fromJson(object(jsonDecode(value)));
    } on FormatException {
      throw const ApiException(
        'Saved session is damaged. Clear it to sign in.',
      );
    } on PlatformException {
      throw const ApiException('Secure storage could not read the session.');
    }
  }

  @override
  Future<void> write(Credentials credentials) async {
    try {
      await _storage.write(key: _key, value: jsonEncode(credentials.toJson()));
    } on PlatformException {
      throw const ApiException('Secure storage could not save the session.');
    }
  }

  @override
  Future<void> clear() async {
    try {
      await _storage.delete(key: _key);
      await _storage.delete(key: _identityKey);
    } on PlatformException {
      throw const ApiException('Secure storage could not clear the session.');
    }
  }

  @override
  Future<Json?> readIdentity() async {
    try {
      final value = await _storage.read(key: _identityKey);
      return value == null ? null : object(jsonDecode(value));
    } on FormatException {
      return null;
    } on ApiException {
      return null;
    } on PlatformException {
      return null;
    }
  }

  @override
  Future<void> writeIdentity(Json identity) async {
    try {
      await _storage.write(key: _identityKey, value: jsonEncode(identity));
    } on PlatformException {
      // Only offline start depends on it; online use is unaffected.
    }
  }
}
