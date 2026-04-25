import 'dart:convert';

import 'profile_store.dart';

/// Snapshot of the WS-direct fields the user last connected with, so we can
/// pre-fill the ConnectScreen and auto-connect on next launch.
class LastWsTarget {
  const LastWsTarget({
    required this.host,
    required this.port,
    required this.token,
    required this.secure,
  });

  final String host;
  final int port;
  final String token;
  final bool secure;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'host': host,
        'port': port,
        'token': token,
        'secure': secure,
      };

  static LastWsTarget? fromJson(Map<String, dynamic> j) {
    final Object? host = j['host'];
    final Object? port = j['port'];
    final Object? token = j['token'];
    final Object? secure = j['secure'];
    if (host is! String || host.isEmpty) return null;
    if (token is! String || token.isEmpty) return null;
    if (port is! int) return null;
    return LastWsTarget(
      host: host,
      port: port,
      token: token,
      secure: secure is bool ? secure : false,
    );
  }
}

/// Persists the last-used WS-direct target. SSH tunnel profiles have their own
/// store — this is only for the "just type host+port+token and go" mode.
class LastTargetStore {
  LastTargetStore(this._kv);
  final SecureKeyValueStore _kv;

  static const String _key = 'lastWsTarget.v1';

  Future<LastWsTarget?> read() async {
    final String? raw = await _kv.read(_key);
    if (raw == null || raw.isEmpty) return null;
    try {
      final Object? decoded = jsonDecode(raw);
      if (decoded is! Map) return null;
      return LastWsTarget.fromJson(Map<String, dynamic>.from(decoded));
    } on FormatException {
      return null;
    }
  }

  Future<void> write(LastWsTarget t) async {
    await _kv.write(_key, jsonEncode(t.toJson()));
  }

  Future<void> clear() async {
    await _kv.delete(_key);
  }
}
