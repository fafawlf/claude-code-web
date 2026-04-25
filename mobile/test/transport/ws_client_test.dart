import 'dart:async';

import 'package:claudecode_mobile/src/protocol/protocol.dart';
import 'package:claudecode_mobile/src/transport/ws_client.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stream_channel/stream_channel.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

// ---------------------------------------------------------------------------
// Minimal in-memory WebSocketChannel for testing (web_socket_channel v3).
// WebSocketChannel is abstract interface in v3, so we implement it directly.
// ---------------------------------------------------------------------------

class _InMemoryWebSocketSink implements WebSocketSink {
  _InMemoryWebSocketSink(this._sink);

  final StreamSink<dynamic> _sink;

  @override
  Future<dynamic> get done => _sink.done;

  @override
  void add(dynamic event) => _sink.add(event);

  @override
  void addError(Object error, [StackTrace? stackTrace]) =>
      _sink.addError(error, stackTrace);

  @override
  Future<dynamic> addStream(Stream<dynamic> stream) => _sink.addStream(stream);

  @override
  Future<dynamic> close([int? closeCode, String? closeReason]) => _sink.close();
}

class _InMemoryWebSocketChannel extends StreamChannelMixin<dynamic>
    implements WebSocketChannel {
  _InMemoryWebSocketChannel(StreamChannel<dynamic> inner)
      : stream = inner.stream,
        sink = _InMemoryWebSocketSink(inner.sink);

  @override
  final Stream<dynamic> stream;

  @override
  final WebSocketSink sink;

  @override
  String? get protocol => null;

  @override
  int? get closeCode => null;

  @override
  String? get closeReason => null;

  @override
  Future<void> get ready => Future<void>.value();
}

WebSocketChannel _pairInMemory(
    {required StreamChannelController<dynamic> controller}) {
  return _InMemoryWebSocketChannel(controller.foreign);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  test('sends hello frame on connect, decodes ready frame', () async {
    final ctrl = StreamChannelController<dynamic>(sync: true);
    final channel = _pairInMemory(controller: ctrl);
    final client = WsClient.fromChannel(channel);

    final received = <ServerMessage>[];
    final sub = client.messages.listen(received.add);

    client.send(const ClientHello(cwd: '/tmp'));

    final outgoing = await ctrl.local.stream.first as String;
    expect(outgoing, contains('"type":"hello"'));

    ctrl.local.sink.add(
      '{"type":"ready","state":{"sessionId":"s1","cwd":"/","permissionMode":"default","runtimeStatus":"idle","attachedCount":1,"lastEventId":0,"lastEventAt":1,"tokensIn":0,"tokensOut":0}}',
    );

    await Future<void>.delayed(Duration.zero);

    expect(received, hasLength(1));
    expect(received.first, isA<ServerReady>());

    await sub.cancel();
    await client.close();
  });

  test('malformed frame emits decode error via errors stream, keeps channel open',
      () async {
    final ctrl = StreamChannelController<dynamic>(sync: true);
    final client = WsClient.fromChannel(_pairInMemory(controller: ctrl));

    final errors = <Object>[];
    final sub = client.decodeErrors.listen(errors.add);

    ctrl.local.sink.add('not json');
    await Future<void>.delayed(Duration.zero);

    expect(errors, hasLength(1));
    expect(errors.first, isA<FormatException>());

    await sub.cancel();
    await client.close();
  });

  test('snapshot with missing required field routes TypeError to decodeErrors, not messages',
      () async {
    final ctrl = StreamChannelController<dynamic>(sync: true);
    final client = WsClient.fromChannel(_pairInMemory(controller: ctrl));

    final errors = <Object>[];
    final messages = <ServerMessage>[];
    final errSub = client.decodeErrors.listen(errors.add);
    final msgSub = client.messages.listen(messages.add);

    ctrl.local.sink.add(
      '{"type":"ready","state":{"sessionId":"s1","cwd":"/","permissionMode":"default","runtimeStatus":"idle","lastEventId":0,"lastEventAt":1,"tokensIn":0,"tokensOut":0}}',
    );
    await Future<void>.delayed(Duration.zero);

    expect(messages, isEmpty);
    expect(errors, hasLength(1));
    expect(errors.first, isA<TypeError>());

    await errSub.cancel();
    await msgSub.cancel();
    await client.close();
  });
}
