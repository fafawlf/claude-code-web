import 'package:claudecode_mobile/src/profiles/auth_credential.dart';
import 'package:claudecode_mobile/src/profiles/connection_profile.dart';
import 'package:claudecode_mobile/src/profiles/profile_store.dart';
import 'package:flutter_test/flutter_test.dart';

/// In-memory fake of SecureKeyValueStore. Tests rely on this so we do NOT
/// touch FlutterSecureStorage (which requires platform channels).
class _InMemoryStore implements SecureKeyValueStore {
  final Map<String, String> _data = <String, String>{};

  @override
  Future<String?> read(String key) async => _data[key];

  @override
  Future<void> write(String key, String value) async {
    _data[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    _data.remove(key);
  }
}

ConnectionProfile _sampleProfile(String id) => ConnectionProfile(
      id: id,
      label: 'label-$id',
      host: 'host-$id',
      username: 'u',
      credential: const PasswordCredential(password: 'p'),
      serverPort: 8080,
      serverStartCommand: 'node s.js',
    );

void main() {
  late _InMemoryStore kv;
  late ProfileStore store;

  setUp(() {
    kv = _InMemoryStore();
    store = ProfileStore(kv);
  });

  test('listProfiles is empty by default', () async {
    final result = await store.listProfiles();
    expect(result, isEmpty);
  });

  test('save then read single profile', () async {
    final p = _sampleProfile('a');
    await store.saveProfile(p);
    final loaded = await store.readProfile('a');
    expect(loaded, p);
  });

  test('listProfiles returns stable sorted-by-label order', () async {
    await store.saveProfile(_sampleProfile('z').copyWithLabel('zeta'));
    await store.saveProfile(_sampleProfile('a').copyWithLabel('alpha'));
    await store.saveProfile(_sampleProfile('m').copyWithLabel('mu'));
    final ids = (await store.listProfiles()).map((p) => p.id).toList();
    expect(ids, <String>['a', 'm', 'z']);
  });

  test('deleteProfile removes it and its index entry', () async {
    await store.saveProfile(_sampleProfile('x'));
    await store.deleteProfile('x');
    expect(await store.readProfile('x'), isNull);
    expect(await store.listProfiles(), isEmpty);
  });

  test('save then save again overwrites by id', () async {
    final p1 = _sampleProfile('k');
    final p2 = ConnectionProfile(
      id: 'k',
      label: 'renamed',
      host: 'new-host',
      username: p1.username,
      credential: p1.credential,
      serverPort: p1.serverPort,
      serverStartCommand: p1.serverStartCommand,
    );
    await store.saveProfile(p1);
    await store.saveProfile(p2);
    expect(await store.readProfile('k'), p2);
    expect((await store.listProfiles()).length, 1);
  });

  test('readProfile on missing id returns null (not throw)', () async {
    expect(await store.readProfile('does-not-exist'), isNull);
  });

  test('save rejects empty id', () async {
    expect(
      () => store.saveProfile(_sampleProfile('')),
      throwsA(isA<ArgumentError>()),
    );
  });

  test('readProfile returns null (does not throw) when stored blob is not JSON', () async {
    await kv.write('profiles.profile.bad.v1', 'not json');
    expect(await store.readProfile('bad'), isNull);
  });

  test('listProfiles skips corrupt blobs, returns the valid ones', () async {
    await store.saveProfile(_sampleProfile('good1').copyWithLabel('a'));
    // Inject a corrupt blob directly into the kv and register it in the index.
    await kv.write('profiles.profile.bad.v1', 'this is not valid json');
    await kv.write('profiles.index.v1', '["good1","bad"]');
    await store.saveProfile(_sampleProfile('good2').copyWithLabel('b'));

    final list = await store.listProfiles();
    final ids = list.map((p) => p.id).toList();
    expect(ids, <String>['good1', 'good2']);
  });
}

extension _TestProfileExt on ConnectionProfile {
  ConnectionProfile copyWithLabel(String newLabel) => ConnectionProfile(
        id: id,
        label: newLabel,
        host: host,
        sshPort: sshPort,
        username: username,
        credential: credential,
        serverPort: serverPort,
        serverStartCommand: serverStartCommand,
      );
}
