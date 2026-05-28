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

  test('ClientUserMessage', () {
    expect(const ClientUserMessage(text: 'hi').toJson(), {'type': 'user', 'text': 'hi'});
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
