import 'dart:async';
import 'dart:typed_data';

import 'package:claudecode_mobile/src/app/chat_screen.dart';
import 'package:claudecode_mobile/src/app/connect_controller.dart';
import 'package:claudecode_mobile/src/app/providers.dart';
import 'package:claudecode_mobile/src/chat/sessions_store.dart';
import 'package:claudecode_mobile/src/profiles/profile_store.dart';
import 'package:claudecode_mobile/src/protocol/protocol.dart';
import 'package:claudecode_mobile/src/theme/skin_palette.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

class _MemoryKv implements SecureKeyValueStore {
  @override
  Future<void> delete(String key) async {}

  @override
  Future<String?> read(String key) async => null;

  @override
  Future<void> write(String key, String value) async {}
}

class _ReadyConnectController extends ConnectController {
  _ReadyConnectController(this.snapshot)
      : super(
          kv: _MemoryKv(),
          confirmer: (String _, Uint8List __) async => true,
        );

  final SessionStateSnapshot snapshot;

  @override
  ConnectState get state => ConnectReady(
        snapshot: snapshot,
        endpoint: 'test:8080',
      );
}

SessionStateSnapshot _snapshot(String sessionId) => SessionStateSnapshot(
      sessionId: sessionId,
      cwd: '/tmp',
      permissionMode: PermissionMode.default_,
      runtimeStatus: SessionRuntimeStatus.idle,
      attachedCount: 1,
      lastEventId: 0,
      lastEventAt: 0,
      tokensIn: 0,
      tokensOut: 0,
    );

void _finishAttachment(
  StreamController<ServerMessage> messages,
  ClientHello hello,
) {
  final String sessionId = hello.sessionId!;
  messages.add(ServerReady(
    state: _snapshot(sessionId),
    attachId: hello.attachId,
    sessionId: sessionId,
    replayMode: ReplayMode.delta,
    historyStatus: HistoryStatus.ready,
  ));
  messages.add(ServerSdkEventBatch(
    events: const <SdkEventEntry>[],
    attachId: hello.attachId,
    sessionId: sessionId,
    replayComplete: true,
  ));
}

void main() {
  testWidgets('composer preserves draft while the target attachment syncs',
      (WidgetTester tester) async {
    final messages = StreamController<ServerMessage>();
    final sent = <ClientMessage>[];
    final store = SessionsStore.forTest(
      messages: messages.stream,
      send: sent.add,
    );
    final connectController = _ReadyConnectController(_snapshot('A'));

    store.switchTo('A');
    final helloA = sent.last as ClientHello;
    _finishAttachment(messages, helloA);
    await Future<void>.delayed(Duration.zero);

    await tester.pumpWidget(ProviderScope(
      overrides: [
        connectControllerProvider.overrideWithValue(connectController),
        sessionsStoreProvider.overrideWithValue(store),
        palettePrvider.overrideWithValue(paletteFor(SkinId.warm)),
      ],
      child: const MaterialApp(
        home: Scaffold(body: ChatScreen()),
      ),
    ));
    await tester.pump();

    final textField = find.byType(TextField);
    expect(tester.widget<TextField>(textField).enabled, isTrue);
    await tester.enterText(textField, 'keep this draft');

    store.switchTo('B');
    final helloB = sent.last as ClientHello;
    await tester.pump();

    expect(tester.widget<TextField>(textField).enabled, isFalse);
    expect(tester.widget<TextField>(textField).controller?.text, 'keep this draft');
    await tester.tap(find.byIcon(Icons.arrow_upward_rounded));
    await tester.pump();
    expect(
      sent.whereType<ClientAttachmentCommand>().where(
            (ClientAttachmentCommand message) =>
                message.command is ClientUserMessage,
          ),
      isEmpty,
    );
    expect(tester.widget<TextField>(textField).controller?.text, 'keep this draft');

    _finishAttachment(messages, helloB);
    await tester.pump();
    expect(tester.widget<TextField>(textField).enabled, isTrue);
    expect(tester.widget<TextField>(textField).controller?.text, 'keep this draft');

    await tester.tap(find.byIcon(Icons.arrow_upward_rounded));
    await tester.pump();
    final scoped = sent.whereType<ClientAttachmentCommand>().singleWhere(
          (ClientAttachmentCommand message) =>
              message.command is ClientUserMessage,
        );
    final user = scoped.command as ClientUserMessage;
    expect(user.text, 'keep this draft');
    expect(tester.widget<TextField>(textField).controller?.text, isEmpty);

    await tester.pumpWidget(const SizedBox.shrink());
    await messages.close();
    store.dispose();
    connectController.dispose();
  });

  testWidgets('history failure keeps composer disabled and offers retry',
      (WidgetTester tester) async {
    final messages = StreamController<ServerMessage>();
    final sent = <ClientMessage>[];
    final store = SessionsStore.forTest(
      messages: messages.stream,
      send: sent.add,
    );
    final connectController = _ReadyConnectController(_snapshot('A'));

    store.switchTo('A');
    final hello = sent.last as ClientHello;
    messages.add(ServerReady(
      state: _snapshot('A'),
      attachId: hello.attachId,
      sessionId: 'A',
      replayMode: ReplayMode.full,
      historyStatus: HistoryStatus.loading,
    ));
    messages.add(ServerSdkEventBatch(
      events: const <SdkEventEntry>[],
      attachId: hello.attachId,
      sessionId: 'A',
      replayComplete: true,
      historyStatus: HistoryStatus.error,
    ));
    await Future<void>.delayed(Duration.zero);

    await tester.pumpWidget(ProviderScope(
      overrides: [
        connectControllerProvider.overrideWithValue(connectController),
        sessionsStoreProvider.overrideWithValue(store),
        palettePrvider.overrideWithValue(paletteFor(SkinId.warm)),
      ],
      child: const MaterialApp(
        home: Scaffold(body: ChatScreen()),
      ),
    ));
    await tester.pump();

    expect(find.text('History could not be loaded.'), findsOneWidget);
    expect(tester.widget<TextField>(find.byType(TextField)).enabled, isFalse);

    sent.clear();
    await tester.tap(find.widgetWithText(TextButton, 'Retry'));
    await tester.pump();
    final retry = sent.single as ClientHello;
    expect(retry.sessionId, 'A');
    expect(retry.lastEventId, 0);
    expect(retry.attachId, isNot(hello.attachId));

    await tester.pumpWidget(const SizedBox.shrink());
    await messages.close();
    store.dispose();
    connectController.dispose();
  });
}
