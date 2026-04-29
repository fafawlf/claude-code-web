import 'dart:convert';
import 'dart:io';

import 'package:claudecode_mobile/src/protocol/protocol.dart';
import 'package:claudecode_mobile/src/transport/ssh_socket_adapter.dart';
import 'package:claudecode_mobile/src/transport/ws_client.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shelf/shelf_io.dart' as shelf_io;
import 'package:shelf_web_socket/shelf_web_socket.dart' as sws;
import 'package:web_socket_channel/web_socket_channel.dart';

void main() {
  test(
      'connects through LoopbackBridge to a real WS server and round-trips a ready frame',
      () async {
    // 1) Real WS server on 127.0.0.1:<wsPort>.
    final handler = sws.webSocketHandler((WebSocketChannel ws, _) {
      ws.stream.listen((dynamic msg) {
        if (msg is String && msg.contains('"type":"hello"')) {
          ws.sink.add(jsonEncode(<String, dynamic>{
            'type': 'ready',
            'state': <String, dynamic>{
              'sessionId': 's1',
              'cwd': '/',
              'permissionMode': 'default',
              'runtimeStatus': 'idle',
              'attachedCount': 1,
              'lastEventId': 0,
              'lastEventAt': 1,
              'tokensIn': 0,
              'tokensOut': 0,
            },
          }));
        }
      });
    });
    final server = await shelf_io.serve(
      handler,
      InternetAddress.loopbackIPv4,
      0,
    );
    final wsPort = server.port;

    // 2) Bridge: open a byte channel to the WS server via a raw TCP socket.
    final bridge = LoopbackBridge(openChannel: () async {
      final s = await Socket.connect('127.0.0.1', wsPort);
      return ByteDuplex(s, s);
    });
    final localPort = await bridge.start();

    // 3) Standard WsClient.connect against ws://127.0.0.1:<localPort>/.
    final client =
        await WsClient.connect(Uri.parse('ws://127.0.0.1:$localPort/'));
    // Subscribe before sending to avoid missing the event.
    final first = client.messages.first;
    client.send(const ClientHello(cwd: '/tmp'));
    final msg = await first.timeout(const Duration(seconds: 3));

    expect(msg, isA<ServerReady>());

    await client.close();
    await bridge.stop();
    await server.close(force: true);
  });

  test('WsClient.connectViaLoopback composes URL correctly', () async {
    final handler = sws.webSocketHandler((WebSocketChannel ws, _) {
      // Echo whatever comes in so the test can assert the round-trip.
      ws.stream.listen((dynamic m) {
        ws.sink.add(m);
      });
    });
    final server =
        await shelf_io.serve(handler, InternetAddress.loopbackIPv4, 0);
    final bridge = LoopbackBridge(openChannel: () async {
      final s = await Socket.connect('127.0.0.1', server.port);
      return ByteDuplex(s, s);
    });
    final localPort = await bridge.start();

    final client = await WsClientTunnel.connectViaLoopback(
      localPort: localPort,
      token: 'tok-xyz',
      path: '/',
    );

    // Subscribe to decodeErrors before sending to avoid missing the event.
    final errorFuture = client.decodeErrors.first;
    client.send(const ClientUserMessage(text: 'ping'));
    // The echoed frame is raw JSON of ClientUserMessage — unknown by
    // ServerMessage.fromJson, so it arrives on decodeErrors as a
    // FormatException('Unknown ServerMessage type: user').
    final echoed = await errorFuture.timeout(const Duration(seconds: 2));
    expect(echoed, isA<FormatException>());
    expect(echoed.toString(), contains('user'));

    await client.close();
    await bridge.stop();
    await server.close(force: true);
  });
}
