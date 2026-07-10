import 'package:flutter_test/flutter_test.dart';
import 'package:claudecode_mobile/src/protocol/client_message.dart';
import 'package:claudecode_mobile/src/protocol/session_state.dart';

void main() {
  test('ClientHello serializes with optional fields omitted', () {
    const m = ClientHello(cwd: '/tmp');
    expect(m.toJson(), {'type': 'hello', 'cwd': '/tmp'});
  });

  test('ClientHello includes lastEventId when provided', () {
    const m = ClientHello(cwd: '/tmp', lastEventId: 42, viewerMode: true);
    expect(m.toJson(), {
      'type': 'hello',
      'cwd': '/tmp',
      'lastEventId': 42,
      'viewerMode': true,
    });
  });

  test('ClientHello.attached generates and serializes a unique attachId', () {
    final first = ClientHello.attached(sessionId: 'A');
    final second = ClientHello.attached(sessionId: 'B');

    expect(first.attachId, isNotEmpty);
    expect(second.attachId, isNotEmpty);
    expect(first.attachId, isNot(second.attachId));
    expect(first.toJson(), {
      'type': 'hello',
      'attachId': first.attachId,
      'sessionId': 'A',
    });
  });

  test('ClientUserMessage', () {
    expect(const ClientUserMessage(text: 'hi').toJson(), {'type': 'user', 'text': 'hi'});
  });

  test('ClientAttachmentCommand adds the active scope', () {
    final message = ClientAttachmentCommand(
      command: const ClientUserMessage(text: 'hi'),
      attachId: 'attach-1',
      sessionId: 'session-1',
    );
    expect(message.toJson(), {
      'type': 'user',
      'text': 'hi',
      'attachId': 'attach-1',
      'sessionId': 'session-1',
    });
  });

  test('ClientPermissionResponse scope optional', () {
    expect(
      const ClientPermissionResponse(reqId: 'r1', decision: PermissionDecision.allow).toJson(),
      {'type': 'permission_response', 'reqId': 'r1', 'decision': 'allow'},
    );
    expect(
      const ClientPermissionResponse(
              reqId: 'r2',
              decision: PermissionDecision.deny,
              scope: PermissionScope.session)
          .toJson(),
      {'type': 'permission_response', 'reqId': 'r2', 'decision': 'deny', 'scope': 'session'},
    );
  });

  test('ClientSetMode uses PermissionMode wire value', () {
    expect(
      const ClientSetMode(mode: PermissionMode.acceptEdits).toJson(),
      {'type': 'set_permission_mode', 'mode': 'acceptEdits'},
    );
  });

  test('ClientInterrupt', () {
    expect(const ClientInterrupt().toJson(), {'type': 'interrupt'});
  });

  test('ClientHello includes permissionMode using its wire value', () {
    const m = ClientHello(permissionMode: PermissionMode.plan);
    expect(m.toJson(), {'type': 'hello', 'permissionMode': 'plan'});
  });

  test('ClientPermissionResponse with deny + scope once', () {
    expect(
      const ClientPermissionResponse(
        reqId: 'r3',
        decision: PermissionDecision.deny,
        scope: PermissionScope.once,
      ).toJson(),
      {
        'type': 'permission_response',
        'reqId': 'r3',
        'decision': 'deny',
        'scope': 'once',
      },
    );
  });
}
