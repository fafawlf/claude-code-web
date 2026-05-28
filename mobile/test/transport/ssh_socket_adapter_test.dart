import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:claudecode_mobile/src/transport/ssh_socket_adapter.dart';
import 'package:flutter_test/flutter_test.dart';

/// Fakes the role of `SSHForwardChannel` — a byte duplex that in production
/// is produced by dartssh2's `client.forwardLocal(...)`. Here it's a pair of
/// `StreamController`s bridged to a loopback `Socket` for determinism.
class _FakeForwardChannelFactory {
  _FakeForwardChannelFactory(this._remoteListener);

  final ServerSocket _remoteListener;

  Future<ByteDuplex> openChannel() async {
    final socket = await Socket.connect(
        _remoteListener.address.host, _remoteListener.port);
    return ByteDuplex(socket, socket);
  }
}

/// A channel factory whose [openChannel] always rejects with [StateError].
class _FailingChannelFactory {
  Future<ByteDuplex> openChannel() =>
      Future<ByteDuplex>.error(StateError('channel open rejected'));
}

void main() {
  test('openChannel failure closes the local socket and does not leak',
      () async {
    final factory = _FailingChannelFactory();
    final bridge = LoopbackBridge(openChannel: factory.openChannel);
    final localPort = await bridge.start();

    final client = await Socket.connect('127.0.0.1', localPort);
    final clientDone = Completer<void>();
    client.listen(
      (_) {},
      onDone: () {
        if (!clientDone.isCompleted) clientDone.complete();
      },
      onError: (Object _) {
        if (!clientDone.isCompleted) clientDone.complete();
      },
      cancelOnError: false,
    );

    // The bridge should close/destroy the local socket after openChannel fails.
    await clientDone.future.timeout(const Duration(seconds: 2));

    // stop() must complete without throwing even after the failure.
    await bridge.stop();
  });

  test('bridge forwards bytes both ways between loopback client and remote peer',
      () async {
    // Fake "remote" peer: echoes everything it receives.
    final remote = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
    final remoteDone = remote.listen((Socket s) {
      s.listen(s.add, onDone: () async { await s.close(); });
    });

    final factory = _FakeForwardChannelFactory(remote);
    final bridge = LoopbackBridge(openChannel: factory.openChannel);
    final localPort = await bridge.start();

    final client = await Socket.connect('127.0.0.1', localPort);
    final received = <int>[];
    final receivedFull = Completer<void>();
    client.listen(received.addAll, onDone: () {
      if (!receivedFull.isCompleted) receivedFull.complete();
    });

    client.add(Uint8List.fromList(<int>[1, 2, 3, 4, 5]));
    await client.flush();

    // Wait up to 2s for echo of exactly 5 bytes.
    await Future.any<void>(<Future<void>>[
      Future<void>.delayed(const Duration(seconds: 2)),
      () async {
        while (received.length < 5) {
          await Future<void>.delayed(const Duration(milliseconds: 10));
        }
      }(),
    ]);

    expect(received, <int>[1, 2, 3, 4, 5]);

    await client.close();
    await bridge.stop();
    await remote.close();
    await remoteDone.cancel();
  });
}
