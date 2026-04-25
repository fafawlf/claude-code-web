import 'dart:convert';

import 'package:flutter/foundation.dart';

import 'profile_store.dart';

sealed class HostKeyDecision {
  const HostKeyDecision();

  const factory HostKeyDecision.firstTime() = HostKeyFirstTime;
  const factory HostKeyDecision.match() = HostKeyMatch;
  const factory HostKeyDecision.mismatch({
    required Uint8List storedFingerprint,
    required Uint8List observedFingerprint,
    required String storedKeyType,
    required String observedKeyType,
  }) = HostKeyMismatch;
  const factory HostKeyDecision.corrupt() = HostKeyCorrupt;
}

class HostKeyFirstTime extends HostKeyDecision {
  const HostKeyFirstTime();

  @override
  bool operator ==(Object other) => other is HostKeyFirstTime;

  @override
  int get hashCode => (HostKeyFirstTime).hashCode;
}

class HostKeyMatch extends HostKeyDecision {
  const HostKeyMatch();

  @override
  bool operator ==(Object other) => other is HostKeyMatch;

  @override
  int get hashCode => (HostKeyMatch).hashCode;
}

class HostKeyMismatch extends HostKeyDecision {
  const HostKeyMismatch({
    required this.storedFingerprint,
    required this.observedFingerprint,
    required this.storedKeyType,
    required this.observedKeyType,
  });

  final Uint8List storedFingerprint;
  final Uint8List observedFingerprint;
  final String storedKeyType;
  final String observedKeyType;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is HostKeyMismatch &&
          runtimeType == other.runtimeType &&
          listEquals(storedFingerprint, other.storedFingerprint) &&
          listEquals(observedFingerprint, other.observedFingerprint) &&
          storedKeyType == other.storedKeyType &&
          observedKeyType == other.observedKeyType;

  @override
  int get hashCode => Object.hash(
        runtimeType,
        Object.hashAll(storedFingerprint),
        Object.hashAll(observedFingerprint),
        storedKeyType,
        observedKeyType,
      );
}

class HostKeyCorrupt extends HostKeyDecision {
  const HostKeyCorrupt();

  @override
  bool operator ==(Object other) => other is HostKeyCorrupt;

  @override
  int get hashCode => (HostKeyCorrupt).hashCode;
}

class HostKeyStore {
  HostKeyStore(this._kv);

  final SecureKeyValueStore _kv;

  static String _key(String profileId) => 'hostkey.$profileId.v1';

  Future<HostKeyDecision> checkFingerprint({
    required String profileId,
    required String keyType,
    required Uint8List fingerprint,
  }) async {
    final raw = await _kv.read(_key(profileId));
    if (raw == null) return const HostKeyDecision.firstTime();
    try {
      final decoded = Map<String, dynamic>.from(jsonDecode(raw) as Map);
      final storedHex = decoded['fingerprintHex'] as String;
      final storedType = decoded['keyType'] as String;
      final stored = _hexToBytes(storedHex);
      if (_bytesEqual(stored, fingerprint) && storedType == keyType) {
        return const HostKeyDecision.match();
      }
      return HostKeyDecision.mismatch(
        storedFingerprint: stored,
        observedFingerprint: fingerprint,
        storedKeyType: storedType,
        observedKeyType: keyType,
      );
    } on FormatException {
      return const HostKeyDecision.corrupt();
    } on TypeError {
      return const HostKeyDecision.corrupt();
    }
  }

  Future<void> pinFingerprint({
    required String profileId,
    required String keyType,
    required Uint8List fingerprint,
  }) async {
    final payload = jsonEncode(<String, dynamic>{
      'keyType': keyType,
      'fingerprintHex': _bytesToHex(fingerprint),
    });
    await _kv.write(_key(profileId), payload);
  }

  Future<void> unpin({required String profileId}) async {
    await _kv.delete(_key(profileId));
  }

  static String _bytesToHex(Uint8List b) {
    final sb = StringBuffer();
    for (final v in b) {
      sb.write(v.toRadixString(16).padLeft(2, '0'));
    }
    return sb.toString();
  }

  static Uint8List _hexToBytes(String hex) {
    final out = Uint8List(hex.length ~/ 2);
    for (var i = 0; i < out.length; i++) {
      out[i] = int.parse(hex.substring(i * 2, i * 2 + 2), radix: 16);
    }
    return out;
  }

  static bool _bytesEqual(Uint8List a, Uint8List b) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }
}
