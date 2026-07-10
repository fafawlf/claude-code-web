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
    this.attachId,
    this.attachmentSessionId,
    this.attachmentReady = false,
    this.attachmentHistoryStatus,
    this.attachmentHistoryTruncated = false,
  });

  final Map<String, ChatState> byId;
  final List<SessionStateSnapshot> list;
  final String? activeId;
  final String? attachId;
  final String? attachmentSessionId;

  /// True only after the current attachment has received both `ready` and the
  /// final replay batch. Session commands must not be sent before this point.
  final bool attachmentReady;
  final HistoryStatus? attachmentHistoryStatus;
  final bool attachmentHistoryTruncated;

  SessionsState copyWith({
    Map<String, ChatState>? byId,
    List<SessionStateSnapshot>? list,
    Object? activeId = _sentinel,
    Object? attachId = _sentinel,
    Object? attachmentSessionId = _sentinel,
    bool? attachmentReady,
    Object? attachmentHistoryStatus = _sentinel,
    bool? attachmentHistoryTruncated,
  }) {
    return SessionsState(
      byId: byId ?? this.byId,
      list: list ?? this.list,
      activeId: identical(activeId, _sentinel) ? this.activeId : activeId as String?,
      attachId: identical(attachId, _sentinel) ? this.attachId : attachId as String?,
      attachmentSessionId: identical(attachmentSessionId, _sentinel)
          ? this.attachmentSessionId
          : attachmentSessionId as String?,
      attachmentReady: attachmentReady ?? this.attachmentReady,
      attachmentHistoryStatus: identical(attachmentHistoryStatus, _sentinel)
          ? this.attachmentHistoryStatus
          : attachmentHistoryStatus as HistoryStatus?,
      attachmentHistoryTruncated:
          attachmentHistoryTruncated ?? this.attachmentHistoryTruncated,
    );
  }

  static const Object _sentinel = Object();
}

class _AttachmentAttempt {
  _AttachmentAttempt({
    required this.attachId,
    required this.generation,
    this.sessionId,
  });

  final String attachId;
  final int generation;
  String? sessionId;
  bool legacyProtocol = false;
  bool readyReceived = false;
  bool replayComplete = false;
  ReplayMode replayMode = ReplayMode.delta;
  ChatState? replayState;
  HistoryStatus? historyStatus;
  bool historyTruncated = false;
  bool historyErrorReported = false;

  bool get canSend =>
      readyReceived && replayComplete && historyStatus != HistoryStatus.error;
}

/// Non-Riverpod-backed SessionsStore. Tests instantiate via [forTest]; app code
/// uses the sessionsStoreProvider in providers.dart, which wires it into a real
/// ConnectController.
class SessionsStore {
  SessionsStore.forTest({
    required Stream<ServerMessage> messages,
    required SendFn send,
  }) : _send = send {
    _sub = messages.listen(
      _onMessage,
      onDone: _onDisconnected,
      onError: (Object _, StackTrace __) => _onDisconnected(),
    );
  }

  final SendFn _send;
  StreamSubscription<ServerMessage>? _sub;
  String? _pendingCwd;
  _AttachmentAttempt? _attachment;
  int _attachmentGeneration = 0;

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

  bool _isCurrentAttachmentFrame(AttachmentScopedServerMessage frame) {
    final _AttachmentAttempt? current = _attachment;
    if (current == null) return false;
    final String? frameAttachId = frame.attachId;
    if (frameAttachId == null) {
      // An old server does not echo attachment scope. Compatibility is safe
      // only for the first client-owned attachment on this socket: after any
      // switch/retry/new-session, a delayed unscoped A frame cannot be proven
      // to belong to B and must be dropped.
      if (current.generation != 1) return false;
      if (frame is ServerReady) {
        final String frameSessionId = frame.sessionId ?? frame.state.sessionId;
        return current.sessionId == null || frameSessionId == current.sessionId;
      }
      if (!current.legacyProtocol) return false;
      final String? frameSessionId = frame.sessionId;
      return frameSessionId == null ||
          current.sessionId == null ||
          frameSessionId == current.sessionId;
    }
    if (frameAttachId != current.attachId) return false;
    // A matching attachId is the authority for ready. The server may recover
    // an expired runtime id from its stable transcript key and assign a fresh
    // session id; rejecting that ready would leave the client syncing forever.
    if (frame is ServerReady) return true;
    final String? frameSessionId = frame.sessionId;
    return frameSessionId == null ||
        current.sessionId == null ||
        frameSessionId == current.sessionId;
  }

  void _beginAttachment(ClientHello hello, {required String? selectedSessionId}) {
    final String attachId = hello.attachId!;
    _attachmentGeneration += 1;
    _attachment = _AttachmentAttempt(
      attachId: attachId,
      generation: _attachmentGeneration,
      sessionId: selectedSessionId,
    );
    _send(hello);
    _emit(_state.copyWith(
      activeId: selectedSessionId,
      attachId: attachId,
      attachmentSessionId: selectedSessionId,
      attachmentReady: false,
      attachmentHistoryStatus: null,
      attachmentHistoryTruncated: false,
    ));
  }

  void _onDisconnected() {
    _attachment = null;
    // A reconnect is a fresh transport: frames from the closed socket cannot
    // arrive on it, so the first attachment may safely use legacy fallback.
    _attachmentGeneration = 0;
    _emit(_state.copyWith(
      attachId: null,
      attachmentSessionId: null,
      attachmentReady: false,
      attachmentHistoryStatus: null,
      attachmentHistoryTruncated: false,
    ));
  }

  /// Mark the current WebSocket transport as gone. A later connection starts
  /// a fresh attachment generation, so its first hello may safely interoperate
  /// with an older server that does not echo attachment scope.
  void resetTransport() {
    _onDisconnected();
  }

  void _acceptBootstrapReady(ServerReady message) {
    final SessionStateSnapshot snapshot = message.state;
    final Map<String, ChatState> byId = Map<String, ChatState>.of(_state.byId);
    byId[snapshot.sessionId] = withReady(
      byId[snapshot.sessionId] ?? ChatState.initial,
      snapshot,
    );
    _emit(_state.copyWith(byId: byId, activeId: snapshot.sessionId));

    // ConnectController consumes the first ready frame before SessionsStore is
    // subscribed, then replays only its unscoped snapshot. Replace that
    // bootstrap attachment with a full, client-scoped attach so no transcript
    // frames can be lost or mistaken for a later switch.
    _beginAttachment(
      ClientHello.attached(sessionId: snapshot.sessionId, lastEventId: 0),
      selectedSessionId: snapshot.sessionId,
    );
  }

  bool get _canSendToAttachment {
    final _AttachmentAttempt? current = _attachment;
    return current != null &&
        current.canSend &&
        current.sessionId != null &&
        current.sessionId == _state.activeId;
  }

  bool _sendAttachmentCommand(ClientMessage command) {
    final _AttachmentAttempt? current = _attachment;
    final String? sessionId = current?.sessionId;
    if (current == null ||
        !current.canSend ||
        sessionId == null ||
        sessionId != _state.activeId) {
      return false;
    }
    _send(ClientAttachmentCommand(
      command: command,
      attachId: current.attachId,
      sessionId: sessionId,
    ));
    return true;
  }

  /// Control and heartbeat frames use the high-priority WebSocket lane, so
  /// they may arrive before the final full-replay batch even though the server
  /// enqueued them later. Mirror those updates into the staging state or the
  /// final atomic history swap would silently discard them.
  void _updateFullReplayState(ChatState Function(ChatState) update) {
    final _AttachmentAttempt? current = _attachment;
    if (current == null ||
        current.replayMode != ReplayMode.full ||
        current.replayComplete ||
        current.replayState == null) {
      return;
    }
    current.replayState = update(current.replayState!);
  }

  void _onMessage(ServerMessage m) {
    if (m is AttachmentScopedServerMessage && !_isCurrentAttachmentFrame(m)) {
      if (m is ServerReady && m.attachId == null && _attachment == null) {
        _acceptBootstrapReady(m);
      }
      return;
    }

    switch (m) {
      case ServerReady(
          :final SessionStateSnapshot state,
          :final String? attachId,
          :final String? sessionId,
          :final ReplayMode? replayMode,
          :final HistoryStatus? historyStatus,
          :final bool? historyTruncated,
        ):
        final _AttachmentAttempt current = _attachment!;
        final String scopedSessionId = sessionId ?? state.sessionId;
        if (scopedSessionId != state.sessionId) {
          return;
        }
        final bool legacyProtocol = attachId == null;
        current
          ..sessionId = state.sessionId
          ..readyReceived = true
          ..legacyProtocol = legacyProtocol
          ..replayMode = replayMode ?? ReplayMode.delta
          // Old servers send `ready` before optional replay batches and have
          // no replayComplete frame. Match their protocol semantics: ready is
          // the completion signal, and later unscoped batches append normally.
          ..replayComplete = legacyProtocol
          ..historyStatus = historyStatus ??
              (legacyProtocol ? HistoryStatus.ready : null)
          ..historyTruncated = historyTruncated ?? false;
        if (current.replayMode == ReplayMode.full) {
          current.replayState = withReady(ChatState.initial, state);
        }
        final Map<String, ChatState> byId = Map<String, ChatState>.of(_state.byId);
        final ChatState prior = byId[state.sessionId] ?? ChatState.initial;
        byId[state.sessionId] = withReady(prior, state);
        _emit(_state.copyWith(
          byId: byId,
          activeId: state.sessionId,
          attachmentSessionId: state.sessionId,
          attachmentReady: current.canSend,
          attachmentHistoryStatus: current.historyStatus,
          attachmentHistoryTruncated: current.historyTruncated,
        ));
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
        final _AttachmentAttempt current = _attachment!;
        if (current.replayMode == ReplayMode.full && !current.replayComplete) {
          current.replayState = applyEvent(
            current.replayState ?? ChatState.initial,
            event,
            id,
          );
          return;
        }
        final Map<String, ChatState> byId = Map<String, ChatState>.of(_state.byId);
        byId[active] = applyEvent(byId[active] ?? ChatState.initial, event, id);
        _emit(_state.copyWith(byId: byId));
      case ServerSdkEventBatch(
          :final List<SdkEventEntry> events,
          :final bool? replayComplete,
          :final HistoryStatus? historyStatus,
          :final bool? historyTruncated,
        ):
        final String? active = _state.activeId;
        if (active == null) return;
        final Map<String, ChatState> byId = Map<String, ChatState>.of(_state.byId);
        final _AttachmentAttempt current = _attachment!;
        final bool fullReplay = current.replayMode == ReplayMode.full;
        ChatState cs = fullReplay
            ? (current.replayState ?? ChatState.initial)
            : (byId[active] ?? ChatState.initial);
        for (final SdkEventEntry e in events) {
          cs = applyEvent(cs, e.event, e.id);
        }
        final HistoryStatus? finalHistoryStatus =
            historyStatus ?? current.historyStatus;
        if (replayComplete == true &&
            finalHistoryStatus == HistoryStatus.error &&
            !current.historyErrorReported) {
          cs = addSystem(
            cs,
            'History could not be loaded. Retry to sync this chat.',
            level: SystemLevel.error,
          );
          current.historyErrorReported = true;
        }
        if (fullReplay) {
          current.replayState = cs;
          if (replayComplete == true) byId[active] = cs;
        } else {
          byId[active] = cs;
        }
        if (replayComplete == true) {
          current
            ..replayComplete = true
            ..historyStatus = finalHistoryStatus
            ..historyTruncated =
                historyTruncated ?? current.historyTruncated;
        }
        _emit(_state.copyWith(
          byId: byId,
          attachmentReady: current.canSend,
          attachmentHistoryStatus: current.historyStatus,
          attachmentHistoryTruncated: current.historyTruncated,
        ));
      case ServerStateUpdate(:final SessionStatePatch state):
        final String? active = _state.activeId;
        if (active == null) return;
        if (state.sessionId != null && state.sessionId != active) return;
        final ChatState? prior = _state.byId[active];
        if (prior == null) return;
        final Map<String, ChatState> byId = Map<String, ChatState>.of(_state.byId);
        byId[active] = applyStateDelta(prior, state);
        final _AttachmentAttempt? current = _attachment;
        if (current?.replayMode == ReplayMode.full &&
            current?.replayComplete == false &&
            current?.replayState != null) {
          current!.replayState = applyStateDelta(current.replayState!, state);
        }
        _emit(_state.copyWith(byId: byId));
      case ServerError(:final String message):
        final String? active = _state.activeId;
        if (active == null) return;
        final Map<String, ChatState> byId = Map<String, ChatState>.of(_state.byId);
        final ChatState prior = byId[active] ?? ChatState.initial;
        byId[active] = addSystem(prior, message, level: SystemLevel.error);
        final _AttachmentAttempt? current = _attachment;
        if (current != null && !current.replayComplete) {
          current.historyErrorReported = true;
          if (current.replayMode == ReplayMode.full &&
              current.replayState != null) {
            current.replayState = addSystem(
              current.replayState!,
              message,
              level: SystemLevel.error,
            );
          }
        }
        _emit(_state.copyWith(byId: byId));
      case ServerHeartbeat(:final SessionStateSnapshot? session, :final int? noActivityMs):
        if (session != null && session.sessionId != _attachment?.sessionId) return;
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
        _updateFullReplayState((ChatState replay) => replay.copyWith(
              heartbeatInactiveSeconds: inactive,
              state: session ?? replay.state,
            ));
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
        final PendingPermission pending = PendingPermission(
          reqId: reqId,
          toolName: toolName,
          toolUseId: toolUseId,
          input: input,
          title: title,
          displayName: displayName,
          description: description,
        );
        byId[active] = prior.copyWith(pendingPermission: pending);
        _updateFullReplayState(
          (ChatState replay) => replay.copyWith(pendingPermission: pending),
        );
        _emit(_state.copyWith(byId: byId));
      case ServerPlanProposed(:final String reqId, :final String plan):
        final String? active = _state.activeId;
        if (active == null) return;
        final Map<String, ChatState> byId = Map<String, ChatState>.of(_state.byId);
        final ChatState prior = byId[active] ?? ChatState.initial;
        final PendingPlan pending = PendingPlan(reqId: reqId, plan: plan);
        byId[active] = prior.copyWith(pendingPlan: pending);
        _updateFullReplayState(
          (ChatState replay) => replay.copyWith(pendingPlan: pending),
        );
        _emit(_state.copyWith(byId: byId));
      case ServerPendingControl(:final String sessionId, :final PendingControl control):
        final Map<String, ChatState> byId = Map<String, ChatState>.of(_state.byId);
        final ChatState prior = byId[sessionId] ?? ChatState.initial;
        switch (control) {
          case PendingPermission():
            byId[sessionId] = prior.copyWith(pendingPermission: control);
            _updateFullReplayState(
              (ChatState replay) => replay.copyWith(pendingPermission: control),
            );
          case PendingPlan():
            byId[sessionId] = prior.copyWith(pendingPlan: control);
            _updateFullReplayState(
              (ChatState replay) => replay.copyWith(pendingPlan: control),
            );
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
    if (!_canSendToAttachment) return;
    if (!_sendAttachmentCommand(ClientPermissionResponse(
      reqId: reqId,
      decision: decision,
      scope: scope,
    ))) return;
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
    if (!_canSendToAttachment) return;
    if (!_sendAttachmentCommand(
      ClientPlanResponse(reqId: reqId, decision: decision),
    )) return;
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
    if (!_canSendToAttachment) return;
    _sendAttachmentCommand(const ClientInterrupt());
  }

  /// Set the model for the active session. Optimistically patch local snapshot
  /// so the UI reflects the change immediately; server will confirm via
  /// state_update.
  void setModel(String model) {
    if (!_canSendToAttachment) return;
    if (!_sendAttachmentCommand(ClientSetModel(model: model))) return;
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
    if (!_canSendToAttachment) return;
    if (!_sendAttachmentCommand(ClientSetMode(mode: mode))) return;
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
    if (!_canSendToAttachment) return;
    _sendAttachmentCommand(const ClientRefreshHistory());
  }

  /// Ask the server for a fresh snapshot of every session. Use this when the
  /// drawer/sidebar is opened — the server no longer pushes this automatically.
  void listSessions() {
    _send(const ClientListSessions());
  }

  /// Optimistically append a user message and send it over the wire.
  void sendUser(String text) {
    if (!_canSendToAttachment) return;
    final String? active = _state.activeId;
    if (active == null) return;
    final Map<String, ChatState> byId = Map<String, ChatState>.of(_state.byId);
    byId[active] = addUserOptimistic(byId[active] ?? ChatState.initial, text);
    _emit(_state.copyWith(byId: byId));
    _sendAttachmentCommand(ClientUserMessage(text: text));
  }

  /// Switch the active session by re-issuing hello with sessionId + lastEventId.
  /// The resume cursor acknowledges only events already materialised locally;
  /// sessions_update metadata is not proof that the transcript is cached.
  void switchTo(String sessionId) {
    final ChatState? cs = _state.byId[sessionId];
    // Only acknowledge events actually materialised in this client. A
    // sessions_update snapshot may advertise a much newer server cursor while
    // the local cache still has no transcript at all.
    final int resume = cs?.lastEventId ?? 0;
    _beginAttachment(
      ClientHello.attached(sessionId: sessionId, lastEventId: resume),
      selectedSessionId: sessionId,
    );
  }

  /// Retry a failed history attachment from a clean cursor. Keeping this as a
  /// new hello also supersedes any delayed frames from the failed generation.
  void retryAttachment() {
    final String? sessionId = _state.activeId;
    if (sessionId == null) return;
    _beginAttachment(
      ClientHello.attached(sessionId: sessionId, lastEventId: 0),
      selectedSessionId: sessionId,
    );
  }

  /// Start a new session. If [cwd] is null the server uses its default working
  /// directory — matches the web client's Cmd+N / "New chat" behavior.
  /// activeId becomes null until the next ServerReady arrives, at which point
  /// it's set to the new sessionId.
  void newSession([String? cwd]) {
    _beginAttachment(
      ClientHello.attached(cwd: cwd),
      selectedSessionId: null,
    );
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
