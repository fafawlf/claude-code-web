import 'dart:io';

import 'package:claudecode_mobile/src/profiles/auth_credential.dart';
import 'package:claudecode_mobile/src/profiles/connection_profile.dart';
import 'package:claudecode_mobile/src/profiles/host_key_store.dart';
import 'package:claudecode_mobile/src/profiles/profile_store.dart';
import 'package:claudecode_mobile/src/protocol/protocol.dart';
import 'package:claudecode_mobile/src/transport/ssh_socket_adapter.dart';
import 'package:claudecode_mobile/src/transport/ssh_tunnel.dart';
import 'package:claudecode_mobile/src/transport/ws_client.dart';
import 'package:flutter_test/flutter_test.dart';

class _MemoryKv implements SecureKeyValueStore {
  final Map<String, String> _m = <String, String>{};
  @override
  Future<String?> read(String k) async => _m[k];
  @override
  Future<void> write(String k, String v) async => _m[k] = v;
  @override
  Future<void> delete(String k) async => _m.remove(k);
}

void main() {
  test('phase 2 end-to-end against real SSH + server', () async {
    final host = Platform.environment['MANUAL_HOST'];
    final user = Platform.environment['MANUAL_USER'];
    final keyPath = Platform.environment['MANUAL_KEY'];
    final serverPortStr = Platform.environment['MANUAL_SERVER_PORT'] ?? '8080';

    if (host == null || user == null || keyPath == null) {
      markTestSkipped(
          'Set MANUAL_HOST, MANUAL_USER, MANUAL_KEY to run. '
          'Optional: MANUAL_SERVER_PORT (default 8080), MANUAL_SSH_PORT (default 22).');
      return;
    }

    final sshPort = int.parse(Platform.environment['MANUAL_SSH_PORT'] ?? '22');
    final serverPort = int.parse(serverPortStr);
    final pem = await File(keyPath).readAsString();

    final kv = _MemoryKv();
    final hostKeyStore = HostKeyStore(kv);
    final profile = ConnectionProfile(
      id: 'manual',
      label: 'manual',
      host: host,
      sshPort: sshPort,
      username: user,
      credential: PrivateKeyCredential(privateKeyPem: pem),
      serverPort: serverPort,
      serverStartCommand: 'node server/dist/bin/claudecode-web.js',
    );

    final verifier = HostKeyVerifier(
      profileId: profile.id,
      hostKeyStore: hostKeyStore,
      confirmUnknown: (type, fp) async {
        final hex = fp
            .map((b) => b.toRadixString(16).padLeft(2, '0'))
            .join(':');
        // ignore: avoid_print
        print('[TOFU] first sight — auto-trusting $type $hex');
        return true;
      },
    );

    // ignore: avoid_print
    print('Opening SSH tunnel to $host:$sshPort as $user...');
    final tunnel = await SshTunnel.open(profile: profile, verifier: verifier);
    // ignore: avoid_print
    print('SSH authenticated.');

    // ignore: avoid_print
    print('Fetching token...');
    final token = await tunnel.fetchToken();
    // ignore: avoid_print
    print('Token: ${token.substring(0, 8)}...');

    final bridge = LoopbackBridge(openChannel: () async {
      return tunnel.forward(host: '127.0.0.1', port: profile.serverPort);
    });
    final localPort = await bridge.start();
    // ignore: avoid_print
    print('Loopback on 127.0.0.1:$localPort');

    final client = await WsClientTunnel.connectViaLoopback(
      localPort: localPort,
      token: token,
      path: '/ws',
    );
    final readyFuture =
        client.messages.firstWhere((ServerMessage m) => m is ServerReady);
    client.send(const ClientHello(cwd: '/tmp'));

    final msg = await readyFuture.timeout(const Duration(seconds: 10));
    // ignore: avoid_print
    print('Got ${msg.runtimeType} ✓');

    expect(msg, isA<ServerReady>());

    await client.close();
    await bridge.stop();
    await tunnel.close();

    // Second verify with same fingerprint must NOT call confirmUnknown.
    var secondPrompt = false;
    final verifier2 = HostKeyVerifier(
      profileId: profile.id,
      hostKeyStore: hostKeyStore,
      confirmUnknown: (_, __) async {
        secondPrompt = true;
        return true;
      },
    );
    final tunnel2 = await SshTunnel.open(profile: profile, verifier: verifier2);
    expect(secondPrompt, isFalse,
        reason: 'pin should suppress second prompt for matching key');
    await tunnel2.close();
  }, timeout: const Timeout(Duration(minutes: 2)));
}
