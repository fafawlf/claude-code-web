import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../chat/sessions_store.dart';
import '../net/reconnect_orchestrator.dart';
import '../profiles/profile_store.dart';
import '../protocol/protocol.dart';
import '../theme/skin_palette.dart';
import '../theme/skin_store.dart';
import 'connect_controller.dart';

/// Wrapper so we can swap the underlying ConnectController in tests.
class ConnectControllerHandle implements ConnectSink {
  ConnectControllerHandle(this.controller);
  final ConnectController controller;

  @override
  Future<void> connect(ConnectTarget target) => controller.connect(target);

  @override
  Future<void> disconnect() => controller.disconnect();
}

/// Set by main.dart at app bootstrap. The provider throws until overridden so
/// forgetting to wire it is a loud error instead of a silent hang.
final connectControllerProvider = Provider<ConnectController>((Ref ref) {
  throw StateError(
      'connectControllerProvider must be overridden in ProviderScope');
});

final reconnectOrchestratorProvider =
    Provider<ReconnectOrchestrator>((Ref ref) {
  final ConnectController c = ref.watch(connectControllerProvider);
  final ReconnectOrchestrator orch =
      ReconnectOrchestrator(sink: ConnectControllerHandle(c));

  void onChange() {
    switch (c.state) {
      case ConnectReady():
        orch.notifyConnected();
      case ConnectFailed():
      case ConnectIdle():
        orch.notifyDisconnected();
      case ConnectProgress():
        break;
    }
  }

  c.addListener(onChange);
  ref.onDispose(() {
    c.removeListener(onChange);
    orch.dispose();
  });
  return orch;
});

/// Tracks the "connect-attempt count / gave-up" view for the UI pill.
class ReconnectUiState {
  const ReconnectUiState({this.attempt = 0, this.gaveUp = false});
  final int attempt;
  final bool gaveUp;
}

class ReconnectUiNotifier extends Notifier<ReconnectUiState> {
  @override
  ReconnectUiState build() => const ReconnectUiState();
  void set(ReconnectUiState next) => state = next;
}

final reconnectUiProvider =
    NotifierProvider<ReconnectUiNotifier, ReconnectUiState>(
        ReconnectUiNotifier.new);

/// SessionsStore wired to the real ConnectController. Listens to its state;
/// after each ConnectReady, resubscribes to the live WsClient messages and
/// sends the right ClientHello (fresh cwd or reconnect replay).
final sessionsStoreProvider = Provider<SessionsStore>((Ref ref) {
  final ConnectController c = ref.watch(connectControllerProvider);

  final StreamController<ServerMessage> relay =
      StreamController<ServerMessage>.broadcast();
  StreamSubscription<ServerMessage>? wsSub;

  void attachClient() {
    wsSub?.cancel();
    final client = c.client;
    if (client == null) return;
    wsSub = client.messages.listen(relay.add);
    // ConnectController's handshake consumes the first ServerReady via
    // firstWhere BEFORE we get a chance to attach, and messages is a broadcast
    // stream with no replay buffer. Replay the snapshot we already have so the
    // SessionsStore populates activeId and the UI can send user messages.
    final ConnectState st = c.state;
    if (st is ConnectReady) {
      relay.add(ServerReady(state: st.snapshot));
    }
  }

  final store = SessionsStore.forTest(
    messages: relay.stream,
    send: (msg) {
      final client = c.client;
      if (client == null) return;
      client.send(msg);
    },
  );

  // Only run the attach + hello flow on the EDGE from not-ready → ready.
  // ConnectController is a ChangeNotifier; it fires on every internal state
  // tweak (snapshot refresh, heartbeat-driven updates), so Ready → Ready
  // transitions are common. Without the edge guard each of those would
  // re-subscribe the relay AND send another ClientHello, producing a storm
  // of hellos on the wire — 130k+ ready frames per socket in the field.
  bool wasReady = false;
  void onConnectChange() {
    final bool nowReady = c.state is ConnectReady;
    if (nowReady && !wasReady) {
      attachClient();
      final active = store.state.activeId;
      final pending = store.consumePendingCwd();
      if (active != null && pending == null) {
        store.switchTo(active);
      } else if (pending != null) {
        store.newSession(pending);
      } else {
        // No prior session and no pending cwd — ConnectController already sent
        // a stub ClientHello(cwd: '/tmp') so the server will emit ServerReady;
        // we just wait.
      }
    }
    wasReady = nowReady;
  }

  c.addListener(onConnectChange);
  onConnectChange();

  ref.onDispose(() {
    c.removeListener(onConnectChange);
    wsSub?.cancel();
    relay.close();
    store.dispose();
  });

  return store;
});

/// Skin/theme — reads the saved choice and exposes it as a NotifierProvider
/// so the whole app rebuilds when the user picks a different skin.
final skinStoreProvider = Provider<SkinStore>((Ref ref) {
  final ConnectController c = ref.watch(connectControllerProvider);
  final SecureKeyValueStore kv = c.kv;
  return SkinStore(kv);
});

class SkinNotifier extends AsyncNotifier<SkinId> {
  @override
  Future<SkinId> build() async {
    final SkinStore store = ref.read(skinStoreProvider);
    return store.read();
  }

  Future<void> set(SkinId id) async {
    state = AsyncData<SkinId>(id);
    await ref.read(skinStoreProvider).write(id);
  }
}

final skinProvider =
    AsyncNotifierProvider<SkinNotifier, SkinId>(SkinNotifier.new);

/// Current palette derived from the active skin, with a sync fallback so
/// callers don't have to wait for AsyncValue during first paint.
final palettePrvider = Provider<SkinPalette>((Ref ref) {
  final AsyncValue<SkinId> s = ref.watch(skinProvider);
  return paletteFor(s.value ?? kDefaultSkin);
});

/// Pushes the SessionsStore state out as a stream for UI consumption.
final sessionsStateProvider = StreamProvider<SessionsState>((Ref ref) {
  final store = ref.watch(sessionsStoreProvider);
  return Stream<SessionsState>.multi((controller) {
    controller.add(store.state);
    final sub = store.stream.listen(controller.add);
    controller.onCancel = sub.cancel;
  });
});
