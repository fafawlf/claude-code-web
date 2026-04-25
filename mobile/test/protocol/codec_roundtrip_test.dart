import 'package:flutter_test/flutter_test.dart';
import 'package:claudecode_mobile/src/protocol/protocol.dart';

void main() {
  test('encodeClientMessage emits JSON string', () {
    final frame = encodeClientMessage(const ClientUserMessage(text: 'hi'));
    expect(frame, '{"type":"user","text":"hi"}');
  });

  test('decodeServerFrame parses a ready frame', () {
    const wire =
        '{"type":"ready","state":{"sessionId":"s1","cwd":"/","permissionMode":"default","runtimeStatus":"idle","attachedCount":1,"lastEventId":0,"lastEventAt":1,"tokensIn":0,"tokensOut":0}}';
    final msg = decodeServerFrame(wire);
    expect(msg, isA<ServerReady>());
  });

  test('decodeServerFrame throws FormatException on bad JSON', () {
    expect(() => decodeServerFrame('not json'), throwsA(isA<FormatException>()));
  });

  test('decodeServerFrame throws FormatException on JSON number', () {
    expect(() => decodeServerFrame('42'), throwsA(isA<FormatException>()));
  });

  test('decodeServerFrame throws FormatException on JSON array', () {
    expect(() => decodeServerFrame('[1,2,3]'), throwsA(isA<FormatException>()));
  });
}
