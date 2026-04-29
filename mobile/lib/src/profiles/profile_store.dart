import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'connection_profile.dart';

/// Narrow interface so tests don't touch platform channels.
abstract class SecureKeyValueStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class FlutterSecureKvAdapter implements SecureKeyValueStore {
  FlutterSecureKvAdapter([FlutterSecureStorage? storage])
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(),
              iOptions: IOSOptions(
                accessibility: KeychainAccessibility.first_unlock_this_device,
              ),
            );

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

class ProfileStore {
  ProfileStore(this._kv);

  final SecureKeyValueStore _kv;

  static const String _indexKey = 'profiles.index.v1';
  static String _profileKey(String id) => 'profiles.profile.$id.v1';

  Future<List<ConnectionProfile>> listProfiles() async {
    final List<String> ids = await _readIndex();
    final List<ConnectionProfile> profiles = <ConnectionProfile>[];
    for (final String id in ids) {
      final ConnectionProfile? p = await readProfile(id);
      if (p != null) profiles.add(p);
    }
    profiles.sort((ConnectionProfile a, ConnectionProfile b) =>
        a.label.compareTo(b.label));
    return profiles;
  }

  Future<ConnectionProfile?> readProfile(String id) async {
    final String? raw = await _kv.read(_profileKey(id));
    if (raw == null) return null;
    try {
      return ConnectionProfile.fromJson(
        Map<String, dynamic>.from(jsonDecode(raw) as Map),
      );
    } on FormatException {
      return null;
    } on TypeError {
      return null;
    }
  }

  Future<void> saveProfile(ConnectionProfile profile) async {
    if (profile.id.isEmpty) {
      throw ArgumentError.value(profile.id, 'profile.id', 'must not be empty');
    }
    await _kv.write(_profileKey(profile.id), jsonEncode(profile.toJson()));
    final Set<String> ids = (await _readIndex()).toSet()..add(profile.id);
    await _writeIndex(ids.toList(growable: false));
  }

  Future<void> deleteProfile(String id) async {
    await _kv.delete(_profileKey(id));
    final List<String> ids = (await _readIndex())
        .where((String e) => e != id)
        .toList(growable: false);
    await _writeIndex(ids);
  }

  Future<List<String>> _readIndex() async {
    final String? raw = await _kv.read(_indexKey);
    if (raw == null) return const <String>[];
    final Object? decoded = jsonDecode(raw);
    // Tolerant of corrupt index: individual profile blobs are still on disk and
    // recoverable by id, but listProfiles can't enumerate them until the index is rewritten.
    if (decoded is! List) return const <String>[];
    return decoded.cast<String>();
  }

  Future<void> _writeIndex(List<String> ids) async {
    await _kv.write(_indexKey, jsonEncode(ids));
  }
}
