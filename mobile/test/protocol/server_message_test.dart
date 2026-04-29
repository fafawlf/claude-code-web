import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:claudecode_mobile/src/protocol/session_state.dart';
import 'package:claudecode_mobile/src/protocol/server_message.dart';

void main() {
  group('PermissionMode', () {
    test('parses known string values', () {
      expect(PermissionMode.fromJson('default'), PermissionMode.default_);
      expect(PermissionMode.fromJson('acceptEdits'), PermissionMode.acceptEdits);
      expect(PermissionMode.fromJson('plan'), PermissionMode.plan);
      expect(PermissionMode.fromJson('bypassPermissions'), PermissionMode.bypassPermissions);
    });

    test('round-trips through JSON', () {
      for (final m in PermissionMode.values) {
        expect(PermissionMode.fromJson(m.toJson()), m);
      }
    });
  });

  group('SessionStateSnapshot', () {
    test('parses minimal payload with required fields', () {
      final snap = SessionStateSnapshot.fromJson(jsonDecode('''
        {
          "sessionId": "s1",
          "cwd": "/tmp/proj",
          "permissionMode": "default",
          "runtimeStatus": "idle",
          "attachedCount": 1,
          "lastEventId": 0,
          "lastEventAt": 1713907200000,
          "tokensIn": 0,
          "tokensOut": 0
        }
      ''') as Map<String, dynamic>);
      expect(snap.sessionId, 's1');
      expect(snap.permissionMode, PermissionMode.default_);
      expect(snap.runtimeStatus, SessionRuntimeStatus.idle);
    });
  });

  group('ServerMessage.fromJson', () {
    test('ready', () {
      final msg = ServerMessage.fromJson(
        jsonDecode(jsonEncode({
          'type': 'ready',
          'state': {
            'sessionId': 's1',
            'cwd': '/tmp',
            'permissionMode': 'default',
            'runtimeStatus': 'idle',
            'attachedCount': 1,
            'lastEventId': 0,
            'lastEventAt': 1,
            'tokensIn': 0,
            'tokensOut': 0,
          }
        })) as Map<String, dynamic>,
      );
      expect(msg, isA<ServerReady>());
      expect((msg as ServerReady).state.sessionId, 's1');
    });

    test('sdk_event preserves raw event', () {
      final msg = ServerMessage.fromJson(
        jsonDecode(jsonEncode({
          'type': 'sdk_event',
          'id': 5,
          'event': {'type': 'assistant', 'message': {'content': []}},
        })) as Map<String, dynamic>,
      );
      expect(msg, isA<ServerSdkEvent>());
      final e = msg as ServerSdkEvent;
      expect(e.id, 5);
      expect(e.event, isA<Map<dynamic, dynamic>>());
    });

    test('sdk_events_batch', () {
      final msg = ServerMessage.fromJson(
        jsonDecode(jsonEncode({
          'type': 'sdk_events_batch',
          'events': [
            {'id': 1, 'event': {'type': 'assistant'}},
            {'id': 2, 'event': {'type': 'result'}},
          ]
        })) as Map<String, dynamic>,
      );
      expect(msg, isA<ServerSdkEventBatch>());
      expect((msg as ServerSdkEventBatch).events.length, 2);
      expect(msg.events[0].id, 1);
    });

    test('permission_request', () {
      final msg = ServerMessage.fromJson(
        jsonDecode(jsonEncode({
          'type': 'permission_request',
          'reqId': 'r1',
          'toolName': 'Bash',
          'toolUseId': 'u1',
          'input': {'cmd': 'ls'},
          'title': 'Run ls',
        })) as Map<String, dynamic>,
      );
      expect(msg, isA<ServerPermissionRequest>());
      final p = msg as ServerPermissionRequest;
      expect(p.toolName, 'Bash');
      expect(p.input['cmd'], 'ls');
    });

    test('heartbeat', () {
      final msg = ServerMessage.fromJson(
        jsonDecode(jsonEncode({'type': 'heartbeat', 'now': 123})) as Map<String, dynamic>,
      );
      expect(msg, isA<ServerHeartbeat>());
      expect((msg as ServerHeartbeat).now, 123);
    });

    test('unknown type throws', () {
      expect(
        () => ServerMessage.fromJson({'type': 'wat'}),
        throwsA(isA<FormatException>()),
      );
    });

    test('sdk_events_batch preserves event payload', () {
      final msg = ServerMessage.fromJson(
        jsonDecode(jsonEncode({
          'type': 'sdk_events_batch',
          'events': [
            {'id': 1, 'event': {'type': 'assistant', 'message': {'content': []}}},
          ],
        })) as Map<String, dynamic>,
      );
      final batch = msg as ServerSdkEventBatch;
      expect(batch.events.first.event, isA<Map<dynamic, dynamic>>());
    });

    test('heartbeat with nested session snapshot', () {
      final msg = ServerMessage.fromJson(
        jsonDecode(jsonEncode({
          'type': 'heartbeat',
          'now': 123,
          'session': {
            'sessionId': 'sX',
            'cwd': '/',
            'permissionMode': 'default',
            'runtimeStatus': 'running',
            'attachedCount': 1,
            'lastEventId': 7,
            'lastEventAt': 456,
            'tokensIn': 10,
            'tokensOut': 20,
          },
        })) as Map<String, dynamic>,
      );
      final hb = msg as ServerHeartbeat;
      expect(hb.session, isNotNull);
      expect(hb.session!.sessionId, 'sX');
    });

    test('pending_control with plan kind', () {
      final msg = ServerMessage.fromJson(
        jsonDecode(jsonEncode({
          'type': 'pending_control',
          'sessionId': 's1',
          'control': {'kind': 'plan', 'reqId': 'r9', 'plan': 'do the thing'},
        })) as Map<String, dynamic>,
      );
      final pc = msg as ServerPendingControl;
      expect(pc.sessionId, 's1');
      expect(pc.control, isA<PendingPlan>());
      expect((pc.control as PendingPlan).plan, 'do the thing');
    });
  });

  test('ServerStateUpdate round-trips typed SessionStatePatch with only runtimeStatus set', () {
    final frame = jsonDecode(
      jsonEncode({'type': 'state_update', 'state': {'runtimeStatus': 'running'}}),
    ) as Map<String, dynamic>;
    final decoded = ServerMessage.fromJson(frame);
    expect(decoded, isA<ServerStateUpdate>());
    final update = decoded as ServerStateUpdate;
    expect(update.state.runtimeStatus, SessionRuntimeStatus.running);
    expect(update.state.sessionId, isNull);
    final roundTripped = ServerMessage.fromJson(
      jsonDecode(jsonEncode(update.toJson())) as Map<String, dynamic>,
    ) as ServerStateUpdate;
    expect(roundTripped, equals(update));
  });

  test('ServerStateUpdate patch with nested activeTool', () {
    final frame = jsonDecode(
      jsonEncode({
        'type': 'state_update',
        'state': {
          'activeTool': {'toolUseId': 't1', 'name': 'Bash', 'startedAt': 1},
        },
      }),
    ) as Map<String, dynamic>;
    final decoded = ServerMessage.fromJson(frame) as ServerStateUpdate;
    expect(decoded.state.activeTool?.name, 'Bash');
  });

  test('SessionStateSnapshot equality and hashCode are value-based', () {
    const a = SessionStateSnapshot(
      sessionId: 's1',
      cwd: '/tmp',
      permissionMode: PermissionMode.default_,
      runtimeStatus: SessionRuntimeStatus.idle,
      attachedCount: 1,
      lastEventId: 0,
      lastEventAt: 1000,
      tokensIn: 0,
      tokensOut: 0,
    );
    const b = SessionStateSnapshot(
      sessionId: 's1',
      cwd: '/tmp',
      permissionMode: PermissionMode.default_,
      runtimeStatus: SessionRuntimeStatus.idle,
      attachedCount: 1,
      lastEventId: 0,
      lastEventAt: 1000,
      tokensIn: 0,
      tokensOut: 0,
    );
    expect(a, equals(b));
    expect(a.hashCode, equals(b.hashCode));
    const c = SessionStateSnapshot(
      sessionId: 's2',
      cwd: '/tmp',
      permissionMode: PermissionMode.default_,
      runtimeStatus: SessionRuntimeStatus.idle,
      attachedCount: 1,
      lastEventId: 0,
      lastEventAt: 1000,
      tokensIn: 0,
      tokensOut: 0,
    );
    expect(a, isNot(equals(c)));
  });

  test('SessionStatePatch equality', () {
    const a = SessionStatePatch(runtimeStatus: SessionRuntimeStatus.running, tokensIn: 5);
    const b = SessionStatePatch(runtimeStatus: SessionRuntimeStatus.running, tokensIn: 5);
    const different = SessionStatePatch(runtimeStatus: SessionRuntimeStatus.idle, tokensIn: 5);
    expect(a, equals(b));
    expect(a.hashCode, equals(b.hashCode));
    expect(a, isNot(equals(different)));
  });

  test('ServerReady equality wraps snapshot equality', () {
    const snap1 = SessionStateSnapshot(
      sessionId: 's1',
      cwd: '/tmp',
      permissionMode: PermissionMode.default_,
      runtimeStatus: SessionRuntimeStatus.idle,
      attachedCount: 0,
      lastEventId: 0,
      lastEventAt: 0,
      tokensIn: 0,
      tokensOut: 0,
    );
    const snap2 = SessionStateSnapshot(
      sessionId: 's1',
      cwd: '/tmp',
      permissionMode: PermissionMode.default_,
      runtimeStatus: SessionRuntimeStatus.idle,
      attachedCount: 0,
      lastEventId: 0,
      lastEventAt: 0,
      tokensIn: 0,
      tokensOut: 0,
    );
    expect(const ServerReady(state: snap1), equals(const ServerReady(state: snap2)));
  });

  test('ServerSessionsUpdate with list of snapshots uses listEquals', () {
    const snap = SessionStateSnapshot(
      sessionId: 's1',
      cwd: '/tmp',
      permissionMode: PermissionMode.default_,
      runtimeStatus: SessionRuntimeStatus.idle,
      attachedCount: 0,
      lastEventId: 0,
      lastEventAt: 0,
      tokensIn: 0,
      tokensOut: 0,
    );
    const a = ServerSessionsUpdate(sessions: [snap]);
    const b = ServerSessionsUpdate(sessions: [
      SessionStateSnapshot(
        sessionId: 's1',
        cwd: '/tmp',
        permissionMode: PermissionMode.default_,
        runtimeStatus: SessionRuntimeStatus.idle,
        attachedCount: 0,
        lastEventId: 0,
        lastEventAt: 0,
        tokensIn: 0,
        tokensOut: 0,
      ),
    ]);
    expect(a, equals(b));
  });
}
