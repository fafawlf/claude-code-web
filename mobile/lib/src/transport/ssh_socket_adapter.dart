import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

/// A byte duplex: a stream of inbound bytes and a sink for outbound bytes.
/// Mirrors the shape of `SSHForwardChannel` but decoupled from dartssh2.
class ByteDuplex {
  ByteDuplex(this.stream, this.sink);

  final Stream<Uint8List> stream;
  final StreamSink<List<int>> sink;
}

typedef OpenChannel = Future<ByteDuplex> Function();

class LoopbackBridge {
  LoopbackBridge({required this.openChannel});

  final OpenChannel openChannel;

  ServerSocket? _server;
  final List<StreamSubscription<dynamic>> _subs = <StreamSubscription<dynamic>>[];
  final List<Socket> _sockets = <Socket>[];
  bool _stopped = false;

  /// Starts listening on 127.0.0.1:0, returns the bound port.
  Future<int> start() async {
    final server = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
    _server = server;
    _subs.add(server.listen(_onLocalConnect));
    return server.port;
  }

  Future<void> _onLocalConnect(Socket local) async {
    _sockets.add(local);
    try {
      final duplex = await openChannel();
      // Guard: stop() may have run while we were awaiting openChannel().
      if (_stopped) {
        local.destroy();
        _sockets.remove(local);
        return;
      }
      // Remote → local.
      //
      // Backpressure: a plain `duplex.stream.listen(local.add, ...)` does NOT
      // propagate congestion — `Socket.add` buffers in-process and the SSH
      // channel keeps pulling bytes from the server. That's the exact path
      // that let the server queue hundreds of MB of WS frames while the
      // mobile side couldn't drain them.
      //
      // Using `Socket.addStream` respects the socket's internal
      // write-buffer signaling: when the OS send queue is full, the stream
      // subscription is paused, which in turn pauses dartssh2's forwarded
      // channel, which propagates window updates back upstream over SSH.
      // On any error we cancel the remote-side subscription and destroy
      // the local socket.
      unawaited(local
          .addStream(duplex.stream)
          .catchError((Object _) {
            local.destroy();
          })
          .whenComplete(() async {
            try {
              await local.close();
            } on Object catch (_) {/* already closed */}
          }));

      // Local → remote: mirror via `sink.addStream` for the same reason.
      // The local socket's consumer (dartssh2's channel sink) pauses the
      // source stream when it can't accept more bytes.
      unawaited(duplex.sink
          .addStream(local)
          .catchError((Object _) async {
            await duplex.sink.close();
          })
          .whenComplete(() async {
            try {
              await duplex.sink.close();
            } on Object catch (_) {/* already closed */}
          }));
    } on Object catch (_) {
      local.destroy();
      _sockets.remove(local);
    }
  }

  Future<void> stop() async {
    _stopped = true;
    for (final sub in _subs) {
      await sub.cancel();
    }
    _subs.clear();
    for (final s in _sockets) {
      try { s.destroy(); } on Object catch (_) {}
    }
    _sockets.clear();
    final server = _server;
    _server = null;
    if (server != null) await server.close();
  }
}
