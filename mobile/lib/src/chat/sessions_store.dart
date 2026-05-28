import 'dart:async';

import '../protocol/protocol.dart';
import 'chat_state.dart';
import 'reducer.dart';

typedef SendFn = void Function(ClientMessage msg);

class SessionsState {
  const SessionsState({
    this.byId = const <String, ChatState>{},
    this.list = const <SessionStateSnapshot>[],
    this.activeId,
  });

  final Map<String, ChatState> byId;
  final List<SessionStateSnapshot> list;
  final String? activeId;

  SessionsState copyWith({
    Map<String, ChatState>? byId,
    List<SessionStateSnapshot>? list,
    Object? activeId = _sentinel,
  }) {
    return SessionsState(
      byId: byId ?? this.byId,
      list: list ?? this.list,
      activeId: identical(activeId, _sentinel) ? this.activeId : activeId as String?,
    );
  }

  static const Object _sentinel = Object();
}

/// Non-Riverpod-backed SessionsStore. Tests instantiate via [forTest]; app code
/// uses the sessionsStoreProvider in providers.dart, which wires it into a real
/// ConnectController.
class SessionsStore {
  SessionsStore.forTest({
    required Stream<ServerMessage> messages,
    required SendFn send,
  }) : _send = send {
    _sub = messages.listen(_onMessage);
  }

  final SendFn _send;
  StreamSubscription<ServerMessage>? _sub;
  String? _pendingCwd;

  SessionsState _state = const SessionsState();
  SessionsState get state => _state;

  final StreamController<SessionsState> _out = StreamController<SessionsState>.broadcast();
  Stream<SessionsState> get stream => _out.stream;

  // Micro-batch state emissions. Each incoming sdk_event / state_update / etc.
  // still mutates `_state` synchronously, so the next event's reducer sees the
  // latest state — but downstream subscribers (UI rebuilds, riverpod relays)
  // only see the final state once per microtask flush. A burst of 50 text
  // deltas arriving in one socket read collapses to ONE _out.add, not 50.
  // Without this, mobile's main isolate spends all its time rebuilding the
  // chat tree and the WebSocket read loop starves, which kills throughput
  // and eventually trips the server's backpressure hard cap.
  bool _flushScheduled = false;
  bool _disposed = false;

  void _emit(SessionsState next) {
    _state = next;
    if (_flushScheduled || _disposed) return;
    _flushScheduled = true;
    scheduleMicrotask(() {
      _flushScheduled = false;
      if (_disposed || _out.isClosed) return;
      _out.add(_state);
    });
  }

  void _onMessage(ServerMessage m) {
    switch (m) {
      case ServerReady(:final SessionStateSnapshot state):
        final Map<String, ChatState> byId = Map<String, ChatState>.of(_state.byId);
        final ChatState prior = byId[state.sessionId] ?? ChatState.initial;
        byId[state.sessionId] = withReady(prior, state);
        _emit(_state.copyWith(byId: byId, activeId: state.sessionId));
        // Pull the list once per attach so the drawer is populated without
        // the old push-on-every-state-change storm.
        _send(const ClientListSessions());
      case ServerSessionsUpdate(:final List<SessionStateSnapshot> sessions):
        final Map<String, ChatState> byId = Map<String, ChatState>.of(_state.byId);
        for (final SessionStateSnapshot s in sessions) {
          byId.putIfAbsent(s.sessionId, () => withReady(ChatState.initial, s));
        }
        _emit(_state.copyWith(byId: byId, list: sessions));
      case ServerSdkEvent(:final int id, :final Object? event):
        final String? active = _state.activeId;
        if (active == null) return;
        final Map<String, ChatState> byId = Map<String, ChatState>.of(_state.byId);
        byId[active] = applyEvent(byId[active] ?? ChatState.initial, event, id);
        _emit(_state.copyWith(byId: byId));
      case ServerSdkEventBatch(:final List<SdkEventEntry> events):
        final String? active = _state.activeId;
        if (active == null) return;
        final Map<String, ChatState> byId = Map<String, ChatState>.of(_state.byId);
        ChatState cs = byId[active] ?? ChatState.initial;
        for (final SdkEventEntry e in events) {
          cs = applyEvent(cs, e.event, e.id);
        }
        byId[active] = cs;
        _emit(_state.copyWith(byId: byId));
      case ServerStateUpdate(:final SessionStatePatch state):
        final String? active = _state.activeId;
        if (active == null) return;
        final ChatState? prior = _state.byId[active];
        if (prior == null) return;
        final Map<String, ChatState> byId = Map<String, ChatState>.of(_state.byId);
        byId[active] = applyStateDelta(prior, state);
        _emit(_state.copyWith(byId: byId));
      case ServerError(:final String message):
        final String? active = _state.activeId;
        if (active == null) return;
        final Map<String, ChatState> byId = Map<String, ChatState>.of(_state.byId);
        final ChatState prior = byId[active] ?? ChatState.initial;
        byId[active] = addSystem(prior, message, level: SystemLevel.error);
        _emit(_state.copyWith(byId: byId));
      case ServerHeartbeat(:final SessionStateSnapshot? session, :final int? noActivityMs):
        final String? sid = session?.sessionId ?? _state.activeId;
        if (sid == null) return;
        final Map<String, ChatState> byId = Map<String, ChatState>.of(_state.byId);
        final ChatState prior = byId[sid] ?? ChatState.initial;
        final int? inactive =
            noActivityMs == null ? null : (noActivityMs / 1000).round();
        byId[sid] = prior.copyWith(
          heartbeatInactiveSeconds: inactive,
          state: session ?? prior.state,
        );
        _emit(_state.copyWith(byId: byId));
      case ServerPermissionRequest(
          :final String reqId,
          :final String toolName,
          :final String? toolUseId,
          :final Map<String, dynamic> input,
          :final String? title,
          :final String? displayName,
          :final String? description,
        ):
        final String? active = _state.activeId;
        if (active == null) return;
        final Map<String, ChatState> byId = Map<String, ChatState>.of(_state.byId);
        final ChatState prior = byId[active] ?? ChatState.initial;
        byId[active] = prior.copyWith(
          pendingPermission: PendingPermission(
            reqId: reqId,
            toolName: toolName,
            toolUseId: toolUseId,
            input: input,
            title: title,
            displayName: displayName,
            description: description,
          ),
        );
        _emit(_state.copyWith(byId: byId));
      case ServerPlanProposed(:final String reqId, :final String plan):
        final String? active = _state.activeId;
        if (active == null) return;
        final Map<String, ChatState> byId = Map<String, ChatState>.of(_state.byId);
        final ChatState prior = byId[active] ?? ChatState.initial;
        byId[active] = prior.copyWith(
          pendingPlan: PendingPlan(reqId: reqId, plan: plan),
        );
        _emit(_state.copyWith(byId: byId));
      case ServerPendingControl(:final String sessionId, :final PendingControl control):
        final Map<String, ChatState> byId = Map<String, ChatState>.of(_state.byId);
        final ChatState prior = byId[sessionId] ?? ChatState.initial;
        switch (control) {
          case PendingPermission():
            byId[sessionId] = prior.copyWith(pendingPermission: control);
          case PendingPlan():
            byId[sessionId] = prior.copyWith(pendingPlan: control);
        }
        _emit(_state.copyWith(byId: byId));
    }
  }

  /// Reply to a permission request and clear the pending control locally.
  void respondPermission({
    required String reqId,
    required PermissionDecision decision,
    PermissionScope? scope,
  }) {
    _send(ClientPermissionResponse(
      reqId: reqId,
      decision: decision,
      scope: scope,
    ));
    final String? active = _state.activeId;
    if (active == null) return;
    final ChatState? prior = _state.byId[active];
    if (prior == null) return;
    if (prior.pendingPermission?.reqId != reqId) return;
    final Map<String, ChatState> byId = Map<String, ChatState>.of(_state.byId);
    byId[active] = prior.copyWith(pendingPermission: null);
    _emit(_state.copyWith(byId: byId));
  }

  /// Reply to a plan proposal and clear the pending control locally.
  void respondPlan({required String reqId, required PlanDecision decision}) {
    _send(ClientPlanResponse(reqId: reqId, decision: decision));
    final String? active = _state.activeId;
    if (active == null) return;
    final ChatState? prior = _state.byId[active];
    if (prior == null) return;
    if (prior.pendingPlan?.reqId != reqId) return;
    final Map<String, ChatState> byId = Map<String, ChatState>.of(_state.byId);
    byId[active] = prior.copyWith(pendingPlan: null);
    _emit(_state.copyWith(byId: byId));
  }

  /// Send an interrupt for the active session.
  void interrupt() {
    _send(const ClientInterrupt());
  }

  /// Set the model for the active session. Optimistically patch local snapshot
  /// so the UI reflects the change immediately; server will confirm via
  /// state_update.
  void setModel(String model) {
    _send(ClientSetModel(model: model));
    final String? active = _state.activeId;
    if (active == null) return;
    final ChatState? prior = _state.byId[active];
    if (prior?.state == null) return;
    final Map<String, ChatState> byId = Map<String, ChatState>.of(_state.byId);
    byId[active] = prior!.copyWith(state: prior.state!.copyWith(model: model));
    _emit(_state.copyWith(byId: byId));
  }

  /// Set the permission mode. Optimistically patches local snapshot.
  void setMode(PermissionMode mode) {
    _send(ClientSetMode(mode: mode));
    final String? active = _state.activeId;
    if (active == null) return;
    final ChatState? prior = _state.byId[active];
    if (prior?.state == null) return;
    final Map<String, ChatState> byId = Map<String, ChatState>.of(_state.byId);
    byId[active] =
        prior!.copyWith(state: prior.state!.copyWith(permissionMode: mode));
    _emit(_state.copyWith(byId: byId));
  }

  /// Ask the server to rescan and re-emit the sessions list.
  void refreshHistory() {
    _send(const ClientRefreshHistory());
  }

  /// Ask the server for a fresh snapshot of every session. Use this when the
  /// drawer/sidebar is opened — the server no longer pushes this automatically.
  void listSessions() {
    _send(const ClientListSessions());
  }

  /// Optimistically append a user message and send it over the wire.
  void sendUser(String text) {
    final String? active = _state.activeId;
    if (active == null) return;
    final Map<String, ChatState> byId = Map<String, ChatState>.of(_state.byId);
    byId[active] = addUserOptimistic(byId[active] ?? ChatState.initial, text);
    _emit(_state.copyWith(byId: byId));
    _send(ClientUserMessage(text: text));
  }

  /// Switch the active session by re-issuing hello with sessionId + lastEventId.
  /// Resume cursor = max of the SDK-event cursor and the snapshot's cursor —
  /// either can be ahead depending on whether we've been streaming live events
  /// or only receiving sessions_update rows.
  void switchTo(String sessionId) {
    final ChatState? cs = _state.byId[sessionId];
    final int fromEvents = cs?.lastEventId ?? 0;
    final int fromSnap = cs?.state?.lastEventId ?? 0;
    final int resume = fromEvents > fromSnap ? fromEvents : fromSnap;
    _send(ClientHello(sessionId: sessionId, lastEventId: resume));
    _emit(_state.copyWith(activeId: sessionId));
  }

  /// Start a new session. If [cwd] is null the server uses its default working
  /// directory — matches the web client's Cmd+N / "New chat" behavior.
  /// activeId becomes null until the next ServerReady arrives, at which point
  /// it's set to the new sessionId.
  void newSession([String? cwd]) {
    _send(ClientHello(cwd: cwd));
    _emit(_state.copyWith(activeId: null));
  }

  /// Stash a cwd to be used on the next ConnectReady (first-time connect).
  void setPendingCwd(String cwd) {
    _pendingCwd = cwd;
  }

  /// Consume and return any pending cwd. Returns null if none set.
  String? consumePendingCwd() {
    final c = _pendingCwd;
    _pendingCwd = null;
    return c;
  }

  void dispose() {
    _disposed = true;
    _sub?.cancel();
    _out.close();
  }
}
