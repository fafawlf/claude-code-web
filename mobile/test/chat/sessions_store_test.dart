import 'dart:async';
import 'dart:io';

import 'package:claudecode_mobile/src/chat/chat_state.dart';
import 'package:claudecode_mobile/src/chat/sessions_store.dart';
import 'package:claudecode_mobile/src/protocol/protocol.dart';
import 'package:flutter_test/flutter_test.dart';

class _Harness {
  _Harness() {
    controller = StreamController<ServerMessage>();
    sent = <ClientMessage>[];
    store = SessionsStore.forTest(
      messages: controller.stream,
      send: sent.add,
    );
  }

  late final StreamController<ServerMessage> controller;
  late final List<ClientMessage> sent;
  late final SessionsStore store;
  bool _controllerClosed = false;

  Future<void> pump() => Future<void>.delayed(Duration.zero);

  ClientHello switchTo(String sessionId) {
    store.switchTo(sessionId);
    return sent.last as ClientHello;
  }

  void ready(ClientHello hello, {String? sessionId}) {
    final sid = sessionId ?? hello.sessionId!;
    controller.add(ServerReady(
      state: _snap(id: sid),
      attachId: hello.attachId,
      sessionId: sid,
      replayMode: ReplayMode.delta,
      historyStatus: HistoryStatus.ready,
    ));
  }

  void replayComplete(ClientHello hello, {String? sessionId}) {
    final sid = sessionId ?? hello.sessionId!;
    controller.add(ServerSdkEventBatch(
      events: const <SdkEventEntry>[],
      attachId: hello.attachId,
      sessionId: sid,
      replayComplete: true,
    ));
  }

  Future<ClientHello> attach(String sessionId) async {
    final hello = switchTo(sessionId);
    ready(hello);
    replayComplete(hello);
    await pump();
    return hello;
  }

  Future<void> disconnect() async {
    if (_controllerClosed) return;
    _controllerClosed = true;
    await controller.close();
    await pump();
  }

  Future<void> close() async {
    await disconnect();
    store.dispose();
  }
}

SessionStateSnapshot _snap({
  String id = 's1',
  String cwd = '/tmp',
  int lastEventId = 0,
  SessionRuntimeStatus status = SessionRuntimeStatus.idle,
}) =>
    SessionStateSnapshot(
      sessionId: id,
      cwd: cwd,
      permissionMode: PermissionMode.default_,
      runtimeStatus: status,
      attachedCount: 1,
      lastEventId: lastEventId,
      lastEventAt: 0,
      tokensIn: 0,
      tokensOut: 0,
    );

void main() {
  test('bootstrap ready seeds cache then starts a full scoped attachment', () async {
    final h = _Harness();
    h.controller.add(ServerReady(state: _snap(id: 'S1', lastEventId: 99)));
    await h.pump();

    expect(h.store.state.activeId, 'S1');
    expect(h.store.state.byId['S1']?.state?.sessionId, 'S1');
    final hello = h.sent.single as ClientHello;
    expect(hello.attachId, isNotEmpty);
    expect(hello.sessionId, 'S1');
    expect(hello.lastEventId, 0);
    expect(h.store.state.attachId, hello.attachId);
    expect(h.store.state.attachmentReady, isFalse);

    h.ready(hello);
    h.replayComplete(hello);
    await h.pump();
    expect(h.store.state.attachmentReady, isTrue);
    await h.close();
  });

  test('first attachment accepts legacy unscoped ready and replay batches', () async {
    final h = _Harness();
    final hello = h.switchTo('LEGACY');
    h.sent.clear();

    h.controller.add(ServerReady(state: _snap(id: 'LEGACY')));
    h.controller.add(ServerSdkEventBatch(
      events: <SdkEventEntry>[
        SdkEventEntry(id: 1, event: <String, dynamic>{
          'type': 'assistant',
          'message': {
            'content': [
              {'type': 'text', 'text': 'legacy history'},
            ],
          },
        }),
      ],
    ));
    await h.pump();

    expect(h.store.state.attachId, hello.attachId);
    expect(h.store.state.activeId, 'LEGACY');
    expect(h.store.state.attachmentReady, isTrue);
    expect(h.store.state.attachmentHistoryStatus, HistoryStatus.ready);
    final items = h.store.state.byId['LEGACY']!.items;
    expect((items.single as AssistantTextItem).text, 'legacy history');

    h.sent.clear();
    h.store.sendUser('works with the old server');
    expect(h.sent.single, isA<ClientAttachmentCommand>());
    await h.close();
  });

  test('unscoped legacy frames are rejected after an attachment switch', () async {
    final h = _Harness();
    h.switchTo('A');
    h.controller.add(ServerReady(state: _snap(id: 'A')));
    h.controller.add(ServerSdkEventBatch(
      events: <SdkEventEntry>[
        SdkEventEntry(id: 1, event: <String, dynamic>{
          'type': 'assistant',
          'message': {
            'content': [
              {'type': 'text', 'text': 'first A'},
            ],
          },
        }),
      ],
    ));
    await h.pump();

    final b = h.switchTo('B');
    h.controller.add(ServerReady(state: _snap(id: 'A', lastEventId: 2)));
    h.controller.add(ServerSdkEventBatch(
      events: <SdkEventEntry>[
        SdkEventEntry(id: 2, event: <String, dynamic>{
          'type': 'assistant',
          'message': {
            'content': [
              {'type': 'text', 'text': 'stale A'},
            ],
          },
        }),
      ],
    ));
    await h.pump();

    expect(h.store.state.activeId, 'B');
    expect(h.store.state.attachId, b.attachId);
    expect(h.store.state.attachmentReady, isFalse);
    expect(h.store.state.byId.containsKey('B'), isFalse);
    final aItems = h.store.state.byId['A']!.items;
    expect(
      aItems.map((ChatItem item) => (item as AssistantTextItem).text),
      <String>['first A'],
    );
    await h.close();
  });

  test('a reconnect resets legacy compatibility for its first attachment', () async {
    final h = _Harness();
    h.switchTo('A');
    h.switchTo('B');
    h.store.resetTransport();

    h.switchTo('RECONNECTED');
    h.controller.add(ServerReady(state: _snap(id: 'RECONNECTED')));
    await h.pump();

    expect(h.store.state.activeId, 'RECONNECTED');
    expect(h.store.state.attachmentReady, isTrue);
    expect(h.store.state.attachmentHistoryStatus, HistoryStatus.ready);
    await h.close();
  });

  test('the real provider resets transport and only replays an empty bootstrap', () {
    final source = File('lib/src/app/providers.dart').readAsStringSync();
    expect(source, contains('if (!nowReady && wasReady)'));
    expect(source, contains('store.resetTransport()'));
    expect(
      source,
      contains('attachClient(replayBootstrap: active == null && pending == null)'),
    );
    expect(source, contains('if (replayBootstrap && st is ConnectReady)'));
    expect(
      source.indexOf('final active = store.state.activeId;'),
      lessThan(source.indexOf('attachClient(replayBootstrap:')),
    );
  });

  test('ServerSessionsUpdate remains a global frame', () async {
    final h = _Harness();
    h.controller.add(ServerSessionsUpdate(sessions: <SessionStateSnapshot>[
      _snap(id: 'A'),
      _snap(id: 'B'),
    ]));
    await h.pump();

    expect(
      h.store.state.list.map((SessionStateSnapshot s) => s.sessionId),
      <String>['A', 'B'],
    );
    expect(h.store.state.byId.keys, containsAll(<String>['A', 'B']));
    await h.close();
  });

  test('scoped sdk event reduces onto its active session', () async {
    final h = _Harness();
    final hello = await h.attach('S1');
    h.controller.add(ServerSdkEvent(
      id: 7,
      event: <String, dynamic>{
        'type': 'assistant',
        'message': {
          'content': [
            {'type': 'text', 'text': 'hi'},
          ],
        },
      },
      attachId: hello.attachId,
      sessionId: 'S1',
    ));
    await h.pump();

    final cs = h.store.state.byId['S1']!;
    expect(cs.items, hasLength(1));
    expect((cs.items.single as AssistantTextItem).text, 'hi');
    expect(cs.lastEventId, 7);
    await h.close();
  });

  test('replay batch folds in order and completion unlocks sending', () async {
    final h = _Harness();
    final hello = h.switchTo('S1');
    h.ready(hello);
    await h.pump();
    expect(h.store.state.attachmentReady, isFalse);

    h.controller.add(ServerSdkEventBatch(
      events: <SdkEventEntry>[
        SdkEventEntry(id: 1, event: <String, dynamic>{'type': 'result'}),
        SdkEventEntry(id: 2, event: <String, dynamic>{
          'type': 'assistant',
          'message': {
            'content': [
              {'type': 'text', 'text': 'ok'},
            ],
          },
        }),
      ],
      attachId: hello.attachId,
      sessionId: 'S1',
      replayComplete: true,
    ));
    await h.pump();

    final cs = h.store.state.byId['S1']!;
    expect(cs.lastEventId, 2);
    expect(cs.items, hasLength(1));
    expect(h.store.state.attachmentReady, isTrue);
    await h.close();
  });

  test('sendUser is blocked until both ready and replayComplete', () async {
    final h = _Harness();
    final hello = h.switchTo('S1');
    h.sent.clear();

    h.store.sendUser('before ready');
    expect(h.sent, isEmpty);
    h.ready(hello);
    await h.pump();
    h.sent.clear();
    h.store.sendUser('during replay');
    expect(h.sent, isEmpty);

    h.replayComplete(hello);
    await h.pump();
    h.store.sendUser('hello');
    final cs = h.store.state.byId['S1']!;
    final user = cs.items.single as UserItem;
    expect(user.text, 'hello');
    expect(user.optimistic, isTrue);
    final sent = h.sent.single as ClientAttachmentCommand;
    expect(sent.command, isA<ClientUserMessage>());
    expect(sent.attachId, hello.attachId);
    expect(sent.sessionId, 'S1');
    await h.close();
  });

  test('all session commands carry the current attachment scope', () async {
    final h = _Harness();
    final hello = await h.attach('S1');
    h.sent.clear();

    h.store.respondPermission(
      reqId: 'permission-1',
      decision: PermissionDecision.allow,
    );
    h.store.respondPlan(reqId: 'plan-1', decision: PlanDecision.approve);
    h.store.interrupt();
    h.store.setModel('claude-opus-4-8');
    h.store.setMode(PermissionMode.plan);
    h.store.refreshHistory();
    h.store.sendUser('hello');

    expect(h.sent, hasLength(7));
    for (final ClientMessage message in h.sent) {
      final json = message.toJson();
      expect(json['attachId'], hello.attachId);
      expect(json['sessionId'], 'S1');
    }
    await h.close();
  });

  test('final replay metadata is retained for the active attachment', () async {
    final h = _Harness();
    final hello = h.switchTo('S1');
    h.ready(hello);
    h.controller.add(ServerSdkEventBatch(
      events: const <SdkEventEntry>[],
      attachId: hello.attachId,
      sessionId: 'S1',
      replayComplete: true,
      historyStatus: HistoryStatus.error,
      historyTruncated: true,
    ));
    await h.pump();

    expect(h.store.state.attachmentReady, isFalse);
    expect(h.store.state.attachmentHistoryStatus, HistoryStatus.error);
    expect(h.store.state.attachmentHistoryTruncated, isTrue);
    final item = h.store.state.byId['S1']!.items.single as SystemItem;
    expect(item.level, SystemLevel.error);
    await h.close();
  });

  test('full replay keeps a scoped history error and retry starts clean', () async {
    final h = _Harness();
    final hello = h.switchTo('S1');
    h.controller.add(ServerReady(
      state: _snap(id: 'S1'),
      attachId: hello.attachId,
      sessionId: 'S1',
      replayMode: ReplayMode.full,
      historyStatus: HistoryStatus.loading,
    ));
    h.controller.add(ServerError(
      message: 'transcript read failed',
      attachId: hello.attachId,
      sessionId: 'S1',
    ));
    h.controller.add(ServerSdkEventBatch(
      events: const <SdkEventEntry>[],
      attachId: hello.attachId,
      sessionId: 'S1',
      replayComplete: true,
      historyStatus: HistoryStatus.error,
    ));
    await h.pump();

    expect(h.store.state.attachmentReady, isFalse);
    final errors = h.store.state.byId['S1']!.items.whereType<SystemItem>();
    expect(errors.map((SystemItem item) => item.text),
        contains('transcript read failed'));

    h.sent.clear();
    h.store.retryAttachment();
    final retry = h.sent.single as ClientHello;
    expect(retry.sessionId, 'S1');
    expect(retry.lastEventId, 0);
    expect(retry.attachId, isNot(hello.attachId));
    await h.close();
  });

  test('switchTo resumes only events materialised in the local cache', () async {
    final h = _Harness();
    h.controller.add(ServerSessionsUpdate(sessions: <SessionStateSnapshot>[
      _snap(id: 'A', lastEventId: 42),
      _snap(id: 'B', lastEventId: 7),
    ]));
    await h.pump();
    h.sent.clear();

    final first = h.switchTo('A');
    final second = h.switchTo('B');
    expect(first.sessionId, 'A');
    expect(first.lastEventId, 0);
    expect(first.attachId, isNotEmpty);
    expect(second.attachId, isNot(equals(first.attachId)));
    expect(h.store.state.activeId, 'B');
    expect(h.store.state.attachId, second.attachId);
    expect(h.store.state.attachmentReady, isFalse);
    await h.close();
  });

  test('full replay replaces cached history atomically', () async {
    final h = _Harness();
    final first = h.switchTo('A');
    h.ready(first);
    h.controller.add(ServerSdkEventBatch(
      events: <SdkEventEntry>[
        SdkEventEntry(id: 1, event: <String, dynamic>{
          'type': 'assistant',
          'message': {
            'content': [
              {'type': 'text', 'text': 'cached'},
            ],
          },
        }),
      ],
      attachId: first.attachId,
      sessionId: 'A',
      replayComplete: true,
    ));
    await h.pump();

    final refresh = h.switchTo('A');
    h.controller.add(ServerReady(
      state: _snap(id: 'A', lastEventId: 3),
      attachId: refresh.attachId,
      sessionId: 'A',
      replayMode: ReplayMode.full,
      historyStatus: HistoryStatus.loading,
    ));
    h.controller.add(ServerSdkEventBatch(
      events: <SdkEventEntry>[
        SdkEventEntry(id: 2, event: <String, dynamic>{
          'type': 'assistant',
          'message': {
            'content': [
              {'type': 'text', 'text': 'fresh one'},
            ],
          },
        }),
      ],
      attachId: refresh.attachId,
      sessionId: 'A',
    ));
    await h.pump();

    var items = h.store.state.byId['A']!.items;
    expect((items.single as AssistantTextItem).text, 'cached');

    h.controller.add(ServerSdkEventBatch(
      events: <SdkEventEntry>[
        SdkEventEntry(id: 3, event: <String, dynamic>{
          'type': 'assistant',
          'message': {
            'content': [
              {'type': 'text', 'text': 'fresh two'},
            ],
          },
        }),
      ],
      attachId: refresh.attachId,
      sessionId: 'A',
      replayComplete: true,
      historyStatus: HistoryStatus.ready,
    ));
    await h.pump();

    items = h.store.state.byId['A']!.items;
    expect(
      items.map((ChatItem item) => (item as AssistantTextItem).text),
      <String>['fresh one', 'fresh two'],
    );
    expect(h.store.state.attachmentReady, isTrue);
    await h.close();
  });

  test('full replay preserves control and heartbeat frames that overtake replay completion', () async {
    final h = _Harness();
    final hello = h.switchTo('A');
    h.controller.add(ServerReady(
      state: _snap(id: 'A', lastEventId: 1),
      attachId: hello.attachId,
      sessionId: 'A',
      replayMode: ReplayMode.full,
      historyStatus: HistoryStatus.loading,
    ));
    h.controller.add(ServerPermissionRequest(
      reqId: 'permission-during-replay',
      toolName: 'Bash',
      input: const <String, dynamic>{'command': 'pwd'},
      attachId: hello.attachId,
      sessionId: 'A',
    ));
    h.controller.add(ServerPendingControl(
      sessionId: 'A',
      attachId: hello.attachId,
      control: const PendingPlan(
        reqId: 'plan-during-replay',
        plan: 'Keep this plan visible',
      ),
    ));
    h.controller.add(ServerHeartbeat(
      now: 4000,
      session: _snap(id: 'A', lastEventId: 1),
      noActivityMs: 4000,
      attachId: hello.attachId,
      sessionId: 'A',
    ));
    h.controller.add(ServerSdkEventBatch(
      events: const <SdkEventEntry>[],
      attachId: hello.attachId,
      sessionId: 'A',
      replayComplete: true,
      historyStatus: HistoryStatus.ready,
    ));
    await h.pump();

    final ChatState state = h.store.state.byId['A']!;
    expect(state.pendingPermission?.reqId, 'permission-during-replay');
    expect(state.pendingPlan?.reqId, 'plan-during-replay');
    expect(state.heartbeatInactiveSeconds, 4);
    expect(h.store.state.attachmentReady, isTrue);
    await h.close();
  });

  test('newSession sends scoped hello and waits for assigned session id', () async {
    final h = _Harness();
    h.store.newSession('/home/me/repo');

    expect(h.store.state.activeId, isNull);
    final hello = h.sent.single as ClientHello;
    expect(hello.attachId, isNotEmpty);
    expect(hello.cwd, '/home/me/repo');
    expect(hello.sessionId, isNull);
    expect(h.store.state.attachmentReady, isFalse);

    h.controller.add(ServerReady(
      state: _snap(id: 'NEW'),
      attachId: hello.attachId,
      sessionId: 'NEW',
      replayMode: ReplayMode.full,
      historyStatus: HistoryStatus.ready,
    ));
    h.controller.add(ServerSdkEventBatch(
      events: const <SdkEventEntry>[],
      attachId: hello.attachId,
      sessionId: 'NEW',
      replayComplete: true,
    ));
    await h.pump();
    expect(h.store.state.activeId, 'NEW');
    expect(h.store.state.attachmentSessionId, 'NEW');
    expect(h.store.state.attachmentReady, isTrue);
    await h.close();
  });

  test('matching attachment accepts recovered ready with a fresh session id', () async {
    final h = _Harness();
    final hello = h.switchTo('EXPIRED');

    h.controller.add(ServerReady(
      state: _snap(id: 'RECOVERED'),
      attachId: hello.attachId,
      sessionId: 'RECOVERED',
      replayMode: ReplayMode.full,
      historyStatus: HistoryStatus.ready,
    ));
    h.controller.add(ServerSdkEventBatch(
      events: const <SdkEventEntry>[],
      attachId: hello.attachId,
      sessionId: 'RECOVERED',
      replayComplete: true,
      historyStatus: HistoryStatus.ready,
    ));
    await h.pump();

    expect(h.store.state.activeId, 'RECOVERED');
    expect(h.store.state.attachmentSessionId, 'RECOVERED');
    expect(h.store.state.attachmentReady, isTrue);
    expect(h.sent.whereType<ClientListSessions>(), hasLength(1));
    await h.close();
  });

  test('late A frames cannot overwrite B after rapid A to B switch', () async {
    final h = _Harness();
    final a = h.switchTo('A');
    final b = h.switchTo('B');

    h.ready(a);
    h.replayComplete(a);
    h.ready(b);
    h.replayComplete(b);
    h.controller.add(ServerSdkEvent(
      id: 1,
      event: <String, dynamic>{
        'type': 'assistant',
        'message': {
          'content': [
            {'type': 'text', 'text': 'stale A'},
          ],
        },
      },
      attachId: a.attachId,
      sessionId: 'A',
    ));
    h.controller.add(ServerSdkEvent(
      id: 2,
      event: <String, dynamic>{
        'type': 'assistant',
        'message': {
          'content': [
            {'type': 'text', 'text': 'current B'},
          ],
        },
      },
      attachId: b.attachId,
      sessionId: 'B',
    ));
    await h.pump();

    expect(h.store.state.activeId, 'B');
    expect(h.store.state.byId['A']?.items ?? const <ChatItem>[], isEmpty);
    final bItems = h.store.state.byId['B']!.items;
    expect((bItems.single as AssistantTextItem).text, 'current B');
    await h.close();
  });

  test('rapid A to B to C accepts only the last attachment', () async {
    final h = _Harness();
    final a = h.switchTo('A');
    final b = h.switchTo('B');
    final c = h.switchTo('C');

    h.ready(b);
    h.replayComplete(a);
    h.ready(c);
    h.replayComplete(b);
    await h.pump();
    expect(h.store.state.activeId, 'C');
    expect(h.store.state.attachmentReady, isFalse);

    h.replayComplete(c);
    await h.pump();
    expect(h.store.state.attachId, c.attachId);
    expect(h.store.state.attachmentSessionId, 'C');
    expect(h.store.state.attachmentReady, isTrue);
    await h.close();
  });

  test('matching attachId with wrong sessionId is ignored', () async {
    final h = _Harness();
    final hello = h.switchTo('A');
    h.controller.add(ServerReady(
      state: _snap(id: 'B'),
      attachId: hello.attachId,
      sessionId: 'B',
    ));
    await h.pump();

    expect(h.store.state.activeId, 'A');
    expect(h.store.state.byId.containsKey('B'), isFalse);
    expect(h.store.state.attachmentReady, isFalse);
    await h.close();
  });

  test('scoped errors affect only the current attachment', () async {
    final h = _Harness();
    final a = h.switchTo('A');
    final b = await h.attach('B');
    h.controller.add(ServerError(
      message: 'old error',
      attachId: a.attachId,
      sessionId: 'A',
    ));
    h.controller.add(ServerError(
      message: 'current error',
      attachId: b.attachId,
      sessionId: 'B',
    ));
    await h.pump();

    expect(h.store.state.byId['A']?.items ?? const <ChatItem>[], isEmpty);
    final item = h.store.state.byId['B']!.items.single as SystemItem;
    expect(item.text, 'current error');
    expect(item.level, SystemLevel.error);
    await h.close();
  });

  test('disconnect clears readiness and blocks later sends', () async {
    final h = _Harness();
    await h.attach('S1');
    expect(h.store.state.attachmentReady, isTrue);
    h.sent.clear();

    await h.disconnect();
    expect(h.store.state.activeId, 'S1');
    expect(h.store.state.attachId, isNull);
    expect(h.store.state.attachmentReady, isFalse);
    h.store.sendUser('lost');
    expect(h.sent, isEmpty);
    expect(h.store.state.byId['S1']!.items, isEmpty);
    await h.close();
  });
}
