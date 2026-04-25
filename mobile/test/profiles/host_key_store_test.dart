import 'dart:typed_data';

import 'package:claudecode_mobile/src/profiles/host_key_store.dart';
import 'package:claudecode_mobile/src/profiles/profile_store.dart';
import 'package:flutter_test/flutter_test.dart';

class _InMemoryStore implements SecureKeyValueStore {
  final Map<String, String> _data = <String, String>{};
  @override
  Future<String?> read(String key) async => _data[key];
  @override
  Future<void> write(String key, String value) async => _data[key] = value;
  @override
  Future<void> delete(String key) async => _data.remove(key);
}

Uint8List _fp(String hex) {
  final bytes = <int>[];
  for (var i = 0; i < hex.length; i += 2) {
    bytes.add(int.parse(hex.substring(i, i + 2), radix: 16));
  }
  return Uint8List.fromList(bytes);
}

void main() {
  late _InMemoryStore kv;
  late HostKeyStore store;

  setUp(() {
    kv = _InMemoryStore();
    store = HostKeyStore(kv);
  });

  test('unknown profile → decision = firstTime', () async {
    final decision = await store.checkFingerprint(
      profileId: 'p1',
      keyType: 'ssh-ed25519',
      fingerprint: _fp('aabbccdd'),
    );
    expect(decision, const HostKeyDecision.firstTime());
  });

  test('pinned then matching → decision = match', () async {
    const keyType = 'ssh-ed25519';
    final fp = _fp('aabbccdd');
    await store.pinFingerprint(profileId: 'p1', keyType: keyType, fingerprint: fp);
    final decision = await store.checkFingerprint(
      profileId: 'p1', keyType: keyType, fingerprint: fp,
    );
    expect(decision, const HostKeyDecision.match());
  });

  test('pinned then mismatching → decision = mismatch carrying stored fp', () async {
    final stored = _fp('aabbccdd');
    final observed = _fp('11223344');
    await store.pinFingerprint(profileId: 'p1', keyType: 'ssh-ed25519', fingerprint: stored);
    final decision = await store.checkFingerprint(
      profileId: 'p1',
      keyType: 'ssh-ed25519',
      fingerprint: observed,
    );
    expect(decision, isA<HostKeyMismatch>());
    expect((decision as HostKeyMismatch).storedFingerprint, stored);
    expect(decision.observedFingerprint, observed);
  });

  test('pinning overwrites previous entry', () async {
    await store.pinFingerprint(profileId: 'p1', keyType: 't', fingerprint: _fp('aa'));
    await store.pinFingerprint(profileId: 'p1', keyType: 't', fingerprint: _fp('bb'));
    final decision = await store.checkFingerprint(
      profileId: 'p1', keyType: 't', fingerprint: _fp('bb'),
    );
    expect(decision, const HostKeyDecision.match());
  });

  test('unpin clears the record — next check returns firstTime', () async {
    await store.pinFingerprint(profileId: 'p1', keyType: 't', fingerprint: _fp('aa'));
    await store.unpin(profileId: 'p1');
    final decision = await store.checkFingerprint(
      profileId: 'p1', keyType: 't', fingerprint: _fp('aa'),
    );
    expect(decision, const HostKeyDecision.firstTime());
  });

  test('different profile ids are isolated', () async {
    await store.pinFingerprint(profileId: 'p1', keyType: 't', fingerprint: _fp('aa'));
    final decision = await store.checkFingerprint(
      profileId: 'p2', keyType: 't', fingerprint: _fp('aa'),
    );
    expect(decision, const HostKeyDecision.firstTime());
  });

  test('keyType-only mismatch (same bytes, different algorithm) → mismatch', () async {
    final fp = _fp('aabbccdd');
    await store.pinFingerprint(profileId: 'p1', keyType: 'ssh-ed25519', fingerprint: fp);
    final decision = await store.checkFingerprint(
      profileId: 'p1',
      keyType: 'ssh-rsa',
      fingerprint: fp,
    );
    expect(decision, isA<HostKeyMismatch>());
    expect((decision as HostKeyMismatch).storedKeyType, 'ssh-ed25519');
    expect(decision.observedKeyType, 'ssh-rsa');
  });

  test('corrupt stored blob → decision = corrupt (does not throw)', () async {
    await kv.write('hostkey.p1.v1', 'not json at all');
    final decision = await store.checkFingerprint(
      profileId: 'p1',
      keyType: 'ssh-ed25519',
      fingerprint: _fp('aabbccdd'),
    );
    expect(decision, const HostKeyDecision.corrupt());
  });

  test('corrupt stored blob (missing fields) → decision = corrupt', () async {
    await kv.write('hostkey.p1.v1', '{"keyType":"ssh-ed25519"}'); // no fingerprintHex
    final decision = await store.checkFingerprint(
      profileId: 'p1',
      keyType: 'ssh-ed25519',
      fingerprint: _fp('aabbccdd'),
    );
    expect(decision, const HostKeyDecision.corrupt());
  });
}
