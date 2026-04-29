import 'dart:async';

import 'package:flutter/foundation.dart';

import '../profiles/connection_profile.dart';
import '../profiles/host_key_store.dart';
import '../profiles/profile_store.dart';
import '../protocol/protocol.dart';
import '../transport/ssh_socket_adapter.dart';
import '../transport/ssh_tunnel.dart';
import '../transport/ws_client.dart';

typedef TofuConfirmer = Future<bool> Function(
    String keyType, Uint8List fingerprint);

sealed class ConnectTarget {
  const ConnectTarget();
}

/// Direct WebSocket connection — server must be reachable at [host]:[port].
/// Typical when server was started with `--host 0.0.0.0` on a trusted LAN, or
/// running on the same device.
class WsDirectTarget extends ConnectTarget {
  const WsDirectTarget({
    required this.host,
    required this.port,
    required this.token,
    this.secure = false,
  });

  final String host;
  final int port;
  final String token;
  final bool secure;
}

/// Tunneled connection via SSH — dartssh2 dials [profile.host] as [profile.username],
/// fetches token by running a remote command, opens a local 127.0.0.1 bridge to
/// `profile.host:profile.serverPort`, then connects WebSocket through the bridge.
class SshTunnelTarget extends ConnectTarget {
  const SshTunnelTarget({required this.profile});
  final ConnectionProfile profile;
}

sealed class ConnectState {
  const ConnectState();
}

class ConnectIdle extends ConnectState {
  const ConnectIdle();
}

class ConnectProgress extends ConnectState {
  const ConnectProgress(this.step);
  final String step;
}

class ConnectReady extends ConnectState {
  const ConnectReady({required this.snapshot, required this.endpoint});
  final SessionStateSnapshot snapshot;

  /// Human-readable "what host:port is the WS actually pointing at right now".
  /// For WS direct it is `host:port`. For SSH tunnel it is `127.0.0.1:<loopback>`.
  final String endpoint;
}

class ConnectFailed extends ConnectState {
  const ConnectFailed(this.message, {this.detail});
  final String message;
  final String? detail;
}

class ConnectController extends ChangeNotifier {
  ConnectController({required this.kv, required this.confirmer});

  final SecureKeyValueStore kv;
  final TofuConfirmer confirmer;

  SshTunnel? _tunnel;
  LoopbackBridge? _bridge;
  WsClient? _client;
  StreamSubscription<ServerMessage>? _msgSub;

  ConnectState _state = const ConnectIdle();
  ConnectState get state => _state;

  /// Exposes the live WebSocket client for UI subscribers. Null when not
  /// connected.
  WsClient? get client => _client;

  final List<String> _log = <String>[];
  List<String> get log => List<String>.unmodifiable(_log);

  Future<void> connect(ConnectTarget target) async {
    await _teardown();
    _clearLog();
    try {
      switch (target) {
        case WsDirectTarget():
          await _connectWsDirect(target);
        case SshTunnelTarget():
          await _connectSshTunnel(target);
      }
    } on Object catch (e, st) {
      await _teardown();
      debugPrint('Connect failed: $e\n$st');
      _set(ConnectFailed(_humanize(e), detail: e.toString()));
    }
  }

  Future<void> _connectWsDirect(WsDirectTarget t) async {
    _set(const ConnectProgress('Connecting WebSocket…'));
    final Uri uri = Uri(
      scheme: t.secure ? 'wss' : 'ws',
      host: t.host,
      port: t.port,
      path: '/ws',
      queryParameters: <String, String>{'t': t.token},
    );
    _append('Dialing ${uri.scheme}://${t.host}:${t.port}/ws');
    final WsClient client = await WsClient.connect(uri);
    _client = client;
    client.send(const ClientHello(cwd: '/tmp'));
    final ServerReady ready = await _handshake(client);
    _append('Got ServerReady for session ${ready.state.sessionId}');
    _subscribeAfterReady(client);
    _set(ConnectReady(
      snapshot: ready.state,
      endpoint: '${t.host}:${t.port}',
    ));
  }

  Future<void> _connectSshTunnel(SshTunnelTarget t) async {
    final ConnectionProfile profile = t.profile;
    _set(const ConnectProgress('Opening SSH tunnel…'));
    final HostKeyStore hostKeyStore = HostKeyStore(kv);
    final HostKeyVerifier verifier = HostKeyVerifier(
      profileId: profile.id,
      hostKeyStore: hostKeyStore,
      confirmUnknown: (String keyType, List<int> fp) =>
          confirmer(keyType, Uint8List.fromList(fp)),
    );
    final SshTunnel tunnel =
        await SshTunnel.open(profile: profile, verifier: verifier);
    _tunnel = tunnel;
    _append('SSH authenticated.');

    _set(const ConnectProgress('Fetching token…'));
    final String token = await tunnel.fetchToken();
    _append('Token: ${token.substring(0, token.length.clamp(0, 8))}…');

    _set(const ConnectProgress('Starting loopback bridge…'));
    final LoopbackBridge bridge = LoopbackBridge(openChannel: () async {
      return tunnel.forward(host: '127.0.0.1', port: profile.serverPort);
    });
    _bridge = bridge;
    final int localPort = await bridge.start();
    _append('Loopback on 127.0.0.1:$localPort');

    _set(const ConnectProgress('Connecting WebSocket…'));
    final WsClient client = await WsClientTunnel.connectViaLoopback(
      localPort: localPort,
      token: token,
    );
    _client = client;
    client.send(const ClientHello(cwd: '/tmp'));

    final ServerReady ready = await _handshake(client);
    _append('Got ServerReady for session ${ready.state.sessionId}');
    _subscribeAfterReady(client);
    _set(ConnectReady(
      snapshot: ready.state,
      endpoint: '127.0.0.1:$localPort (via SSH)',
    ));
  }

  /// Wait for the first [ServerReady] on the socket. Caller is responsible for
  /// sending [ClientHello] — Phase 3 [SessionsStore] owns hello semantics
  /// (cwd vs sessionId + lastEventId).
  Future<ServerReady> _handshake(WsClient client) async {
    final Future<ServerMessage> readyFuture = client.messages
        .firstWhere((ServerMessage m) => m is ServerReady)
        .timeout(const Duration(seconds: 15));
    return await readyFuture as ServerReady;
  }

  void _subscribeAfterReady(WsClient client) {
    _msgSub = client.messages.listen((ServerMessage m) {
      _append('recv ${m.runtimeType}');
    });
  }

  Future<void> disconnect() async {
    await _teardown();
    _set(const ConnectIdle());
  }

  Future<void> _teardown() async {
    try { await _msgSub?.cancel(); } on Object catch (_) {}
    _msgSub = null;
    try { await _client?.close(); } on Object catch (_) {}
    try { await _bridge?.stop(); } on Object catch (_) {}
    try { await _tunnel?.close(); } on Object catch (_) {}
    _client = null;
    _bridge = null;
    _tunnel = null;
  }

  void _set(ConnectState s) {
    _state = s;
    notifyListeners();
  }

  void _append(String line) {
    _log.add(line);
    notifyListeners();
  }

  void _clearLog() {
    _log.clear();
  }

  static String _humanize(Object e) {
    final String msg = e.toString();
    if (msg.contains('Unauthorized') ||
        msg.contains('WebSocket was not upgraded')) {
      return 'Server rejected the token. Check that you pasted the right token.';
    }
    if (msg.contains('SocketException') ||
        msg.contains('Connection refused') ||
        msg.contains('No route to host') ||
        msg.contains('Failed host lookup')) {
      return 'Cannot reach host. Check address, port, and that the server is listening on that address.';
    }
    if (msg.contains('SSHAuthFail') ||
        msg.contains('All authentication methods failed')) {
      return 'SSH authentication failed. Check user and key.';
    }
    if (msg.contains('host key') || msg.contains('hostkey') || msg.contains('verify')) {
      return 'Host key rejected. If the server was reinstalled, remove the pinned key to re-trust.';
    }
    if (msg.contains('No such file or directory') && msg.contains('token')) {
      return 'Token file not found. Is the claudecode-web server running on the remote?';
    }
    if (msg.contains('TimeoutException')) {
      return 'Timed out waiting for server ready.';
    }
    return 'Connection failed.';
  }

  @override
  void dispose() {
    // Fire and forget; controller is going away.
    unawaited(_teardown());
    super.dispose();
  }
}
