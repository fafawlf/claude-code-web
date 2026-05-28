import 'dart:async';

import 'package:web_socket_channel/web_socket_channel.dart';

import '../protocol/protocol.dart';

class WsClient {
  WsClient._(this._channel) {
    _subscription = _channel.stream.listen(
      _onFrame,
      onError: _messagesController.addError,
      onDone: _messagesController.close,
    );
  }

  factory WsClient.fromChannel(WebSocketChannel channel) => WsClient._(channel);

  static Future<WsClient> connect(Uri url) async {
    final channel = WebSocketChannel.connect(url);
    await channel.ready;
    return WsClient._(channel);
  }

  final WebSocketChannel _channel;
  late final StreamSubscription<dynamic> _subscription;
  final _messagesController = StreamController<ServerMessage>.broadcast();
  final _decodeErrorsController = StreamController<Object>.broadcast();

  /// Frames received from the server as decoded [ServerMessage]s.
  ///
  /// This is a broadcast stream with no replay buffer, and the inner
  /// subscription to the WebSocket starts in the constructor — so frames that
  /// arrive before a listener attaches are dropped. The server sends state
  /// snapshots (`sessions_update`, etc.) immediately on connect, BEFORE the
  /// client sends hello. Callers MUST NOT use `.first` to wait for a specific
  /// message type; use `firstWhere((m) => m is T)` or subscribe and filter.
  Stream<ServerMessage> get messages => _messagesController.stream;
  Stream<Object> get decodeErrors => _decodeErrorsController.stream;

  void send(ClientMessage msg) {
    _channel.sink.add(encodeClientMessage(msg));
  }

  void _onFrame(dynamic raw) {
    if (raw is! String) {
      _decodeErrorsController.add(FormatException('Non-string frame: ${raw.runtimeType}'));
      return;
    }
    try {
      _messagesController.add(decodeServerFrame(raw));
    } on FormatException catch (e) {
      _decodeErrorsController.add(e);
    } on TypeError catch (e) {
      _decodeErrorsController.add(e);
    }
  }

  Future<void> close() async {
    // Initiate sink close but do not await it: the future only completes when
    // the remote side drains the channel, which may not happen in tests or on
    // abrupt disconnects.  Controllers are always closed so callers can be sure
    // no more events are emitted after close() returns.
    unawaited(_channel.sink.close());
    await _subscription.cancel();
    await _messagesController.close();
    await _decodeErrorsController.close();
  }
}

extension WsClientTunnel on WsClient {
  /// Convenience: given a pre-started [LoopbackBridge] local port and a token
  /// fetched via `SshTunnel.fetchToken`, build the standard loopback `ws://`
  /// URI and connect. The caller owns the bridge lifecycle.
  static Future<WsClient> connectViaLoopback({
    required int localPort,
    required String token,
    String path = '/ws',
  }) {
    final uri = Uri(
      scheme: 'ws',
      host: '127.0.0.1',
      port: localPort,
      path: path,
      queryParameters: <String, String>{'t': token},
    );
    return WsClient.connect(uri);
  }
}
