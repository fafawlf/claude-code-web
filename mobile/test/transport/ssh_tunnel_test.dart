import 'dart:typed_data';

import 'package:claudecode_mobile/src/profiles/host_key_store.dart';
import 'package:claudecode_mobile/src/profiles/profile_store.dart';
import 'package:claudecode_mobile/src/transport/ssh_tunnel.dart';
import 'package:flutter_test/flutter_test.dart';

class _InMemoryKv implements SecureKeyValueStore {
  final Map<String, String> _m = <String, String>{};

  @override
  Future<String?> read(String k) async => _m[k];

  @override
  Future<void> write(String k, String v) async => _m[k] = v;

  @override
  Future<void> delete(String k) async => _m.remove(k);
}

void main() {
  group('HostKeyVerifier — decision-only', () {
    test('first time: calls confirmUnknown; if approved, pins and returns true',
        () async {
      final kv = _InMemoryKv();
      final store = HostKeyStore(kv);
      final events = <String>[];
      final verifier = HostKeyVerifier(
        profileId: 'p1',
        hostKeyStore: store,
        confirmUnknown: (type, fp) async {
          events.add('confirmed:$type');
          return true;
        },
      );

      final ok = await verifier.verify(
        'ssh-ed25519',
        Uint8List.fromList(<int>[1, 2, 3]),
      );

      expect(ok, isTrue);
      expect(events, <String>['confirmed:ssh-ed25519']);

      // Pinned now. A second verify with same fp must NOT call confirmUnknown.
      events.clear();
      final ok2 = await verifier.verify(
        'ssh-ed25519',
        Uint8List.fromList(<int>[1, 2, 3]),
      );
      expect(ok2, isTrue);
      expect(events, isEmpty);
    });

    test(
        'first time: confirmUnknown returns false → verify returns false, no pin',
        () async {
      final kv = _InMemoryKv();
      final store = HostKeyStore(kv);
      final verifier = HostKeyVerifier(
        profileId: 'p1',
        hostKeyStore: store,
        confirmUnknown: (_, __) async => false,
      );

      final ok = await verifier.verify(
        'ssh-ed25519',
        Uint8List.fromList(<int>[1, 2, 3]),
      );
      expect(ok, isFalse);

      // Next time, still first-time (no pin).
      final decision = await store.checkFingerprint(
        profileId: 'p1',
        keyType: 'ssh-ed25519',
        fingerprint: Uint8List.fromList(<int>[1, 2, 3]),
      );
      expect(decision, const HostKeyDecision.firstTime());
    });

    test('mismatch → verify returns false regardless of confirmUnknown',
        () async {
      final kv = _InMemoryKv();
      final store = HostKeyStore(kv);
      await store.pinFingerprint(
        profileId: 'p1',
        keyType: 'ssh-ed25519',
        fingerprint: Uint8List.fromList(<int>[1, 2, 3]),
      );
      var confirmCalled = false;
      final verifier = HostKeyVerifier(
        profileId: 'p1',
        hostKeyStore: store,
        confirmUnknown: (_, __) async {
          confirmCalled = true;
          return true;
        },
      );
      final ok = await verifier.verify(
        'ssh-ed25519',
        Uint8List.fromList(<int>[9, 9, 9]),
      );
      expect(ok, isFalse);
      expect(confirmCalled, isFalse,
          reason: 'mismatch is a hard block; UI is not consulted');
    });

    test(
        'pinning approves one fingerprint; a different fingerprint for the same profile is hard-blocked',
        () async {
      final kv = _InMemoryKv();
      final store = HostKeyStore(kv);
      var confirmCalled = false;
      final verifier = HostKeyVerifier(
        profileId: 'p1',
        hostKeyStore: store,
        confirmUnknown: (_, __) async {
          confirmCalled = true;
          return true;
        },
      );

      // First verify: unknown → confirmUnknown returns true → pin + return true.
      final ok1 = await verifier.verify(
        'ssh-ed25519',
        Uint8List.fromList(<int>[1, 2, 3]),
      );
      expect(ok1, isTrue);
      expect(confirmCalled, isTrue);

      // Reset flag for the second verify.
      confirmCalled = false;

      // Second verify: different fingerprint → mismatch → hard block.
      final ok2 = await verifier.verify(
        'ssh-ed25519',
        Uint8List.fromList(<int>[9, 9, 9]),
      );
      expect(ok2, isFalse);
      expect(confirmCalled, isFalse,
          reason: 'a mismatched fingerprint is a hard block; UI is not consulted');
    });
  });
}
