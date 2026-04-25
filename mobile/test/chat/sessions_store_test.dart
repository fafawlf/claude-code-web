import 'dart:async';

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

  Future<void> pump() => Future<void>.delayed(Duration.zero);

  Future<void> close() async {
    await controller.close();
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
  test('ServerReady sets activeId and seeds ChatState.state', () async {
    final h = _Harness();
    h.controller.add(ServerReady(state: _snap(id: 'S1')));
    await h.pump();
    expect(h.store.state.activeId, 'S1');
    expect(h.store.state.byId['S1']?.state?.sessionId, 'S1');
    await h.close();
  });

  test('ServerSessionsUpdate populates list and seeds empty byId entries', () async {
    final h = _Harness();
    h.controller.add(ServerSessionsUpdate(sessions: <SessionStateSnapshot>[
      _snap(id: 'A'),
      _snap(id: 'B'),
    ]));
    await h.pump();
    expect(h.store.state.list.map((SessionStateSnapshot s) => s.sessionId), <String>['A', 'B']);
    expect(h.store.state.byId.keys, containsAll(<String>['A', 'B']));
    await h.close();
  });

  test('ServerSdkEvent reduces onto active session', () async {
    final h = _Harness();
    h.controller.add(ServerReady(state: _snap(id: 'S1')));
    await h.pump();
    h.controller.add(ServerSdkEvent(id: 7, event: <String, dynamic>{
      'type': 'assistant',
      'message': {'content': [{'type': 'text', 'text': 'hi'}]},
    }));
    await h.pump();
    final cs = h.store.state.byId['S1']!;
    expect(cs.items, hasLength(1));
    expect((cs.items.single as AssistantTextItem).text, 'hi');
    expect(cs.lastEventId, 7);
    await h.close();
  });

  test('ServerSdkEventBatch folds events in order', () async {
    final h = _Harness();
    h.controller.add(ServerReady(state: _snap(id: 'S1')));
    await h.pump();
    h.controller.add(ServerSdkEventBatch(events: <SdkEventEntry>[
      SdkEventEntry(id: 1, event: <String, dynamic>{'type': 'result'}),
      SdkEventEntry(id: 2, event: <String, dynamic>{
        'type': 'assistant',
        'message': {'content': [{'type': 'text', 'text': 'ok'}]},
      }),
    ]));
    await h.pump();
    final cs = h.store.state.byId['S1']!;
    expect(cs.lastEventId, 2);
    expect(cs.items, hasLength(1));
    await h.close();
  });

  test('sendUser appends optimistic UserItem and sends ClientUserMessage frame', () async {
    final h = _Harness();
    h.controller.add(ServerReady(state: _snap(id: 'S1')));
    await h.pump();
    h.sent.clear();
    h.store.sendUser('hello');
    final cs = h.store.state.byId['S1']!;
    final u = cs.items.single as UserItem;
    expect(u.text, 'hello');
    expect(u.optimistic, isTrue);
    expect(h.sent.single, isA<ClientUserMessage>());
    expect((h.sent.single as ClientUserMessage).text, 'hello');
    await h.close();
  });

  test('switchTo sends ClientHello with sessionId + lastEventId', () async {
    final h = _Harness();
    h.controller.add(ServerSessionsUpdate(sessions: <SessionStateSnapshot>[
      _snap(id: 'A', lastEventId: 42),
    ]));
    await h.pump();
    h.sent.clear();
    h.store.switchTo('A');
    expect(h.sent.single, isA<ClientHello>());
    final hello = h.sent.single as ClientHello;
    expect(hello.sessionId, 'A');
    expect(hello.lastEventId, 42);
    await h.close();
  });

  test('newSession sends ClientHello with cwd and clears activeId', () async {
    final h = _Harness();
    h.controller.add(ServerReady(state: _snap(id: 'OLD')));
    await h.pump();
    h.sent.clear();
    h.store.newSession('/home/me/repo');
    expect(h.store.state.activeId, isNull);
    expect(h.sent.single, isA<ClientHello>());
    final hello = h.sent.single as ClientHello;
    expect(hello.cwd, '/home/me/repo');
    expect(hello.sessionId, isNull);
    await h.close();
  });

  test('ServerError appends SystemItem(error) on active', () async {
    final h = _Harness();
    h.controller.add(ServerReady(state: _snap(id: 'S1')));
    await h.pump();
    h.controller.add(const ServerError(message: 'bad thing'));
    await h.pump();
    final cs = h.store.state.byId['S1']!;
    final item = cs.items.single as SystemItem;
    expect(item.text, 'bad thing');
    expect(item.level, SystemLevel.error);
    await h.close();
  });
}
