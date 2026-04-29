import 'session_state.dart';

sealed class ClientMessage {
  const ClientMessage();
  Map<String, dynamic> toJson();
}

class ClientHello extends ClientMessage {
  const ClientHello({
    this.sessionId,
    this.resumeClaudeId,
    this.cwd,
    this.model,
    this.permissionMode,
    this.lastEventId,
    this.viewerMode,
  });

  final String? sessionId;
  final String? resumeClaudeId;
  final String? cwd;
  final String? model;
  final PermissionMode? permissionMode;
  final int? lastEventId;
  final bool? viewerMode;

  @override
  Map<String, dynamic> toJson() => {
        'type': 'hello',
        if (sessionId != null) 'sessionId': sessionId,
        if (resumeClaudeId != null) 'resumeClaudeId': resumeClaudeId,
        if (cwd != null) 'cwd': cwd,
        if (model != null) 'model': model,
        if (permissionMode != null) 'permissionMode': permissionMode!.toJson(),
        if (lastEventId != null) 'lastEventId': lastEventId,
        if (viewerMode != null) 'viewerMode': viewerMode,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ClientHello &&
          runtimeType == other.runtimeType &&
          sessionId == other.sessionId &&
          resumeClaudeId == other.resumeClaudeId &&
          cwd == other.cwd &&
          model == other.model &&
          permissionMode == other.permissionMode &&
          lastEventId == other.lastEventId &&
          viewerMode == other.viewerMode;

  @override
  int get hashCode =>
      Object.hash(sessionId, resumeClaudeId, cwd, model, permissionMode, lastEventId, viewerMode);
}

class ClientUserMessage extends ClientMessage {
  const ClientUserMessage({required this.text});
  final String text;

  @override
  Map<String, dynamic> toJson() => {'type': 'user', 'text': text};

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ClientUserMessage && runtimeType == other.runtimeType && text == other.text;

  @override
  int get hashCode => text.hashCode;
}

enum PermissionDecision {
  allow('allow'),
  deny('deny');

  const PermissionDecision(this.wire);
  final String wire;

  String toJson() => wire;
}

enum PermissionScope {
  once('once'),
  session('session');

  const PermissionScope(this.wire);
  final String wire;

  String toJson() => wire;
}

class ClientPermissionResponse extends ClientMessage {
  const ClientPermissionResponse({
    required this.reqId,
    required this.decision,
    this.scope,
  });

  final String reqId;
  final PermissionDecision decision;
  final PermissionScope? scope;

  @override
  Map<String, dynamic> toJson() => {
        'type': 'permission_response',
        'reqId': reqId,
        'decision': decision.toJson(),
        if (scope != null) 'scope': scope?.toJson(),
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ClientPermissionResponse &&
          runtimeType == other.runtimeType &&
          reqId == other.reqId &&
          decision == other.decision &&
          scope == other.scope;

  @override
  int get hashCode => Object.hash(reqId, decision, scope);
}

enum PlanDecision {
  approve('approve'),
  reject('reject');

  const PlanDecision(this.wire);
  final String wire;

  String toJson() => wire;
}

class ClientPlanResponse extends ClientMessage {
  const ClientPlanResponse({required this.reqId, required this.decision});
  final String reqId;
  final PlanDecision decision;

  @override
  Map<String, dynamic> toJson() => {
        'type': 'plan_response',
        'reqId': reqId,
        'decision': decision.toJson(),
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ClientPlanResponse &&
          runtimeType == other.runtimeType &&
          reqId == other.reqId &&
          decision == other.decision;

  @override
  int get hashCode => Object.hash(reqId, decision);
}

class ClientInterrupt extends ClientMessage {
  const ClientInterrupt();

  @override
  Map<String, dynamic> toJson() => {'type': 'interrupt'};

  @override
  bool operator ==(Object other) => identical(this, other) || other is ClientInterrupt;

  @override
  int get hashCode => runtimeType.hashCode;
}

class ClientSetModel extends ClientMessage {
  const ClientSetModel({required this.model});
  final String model;

  @override
  Map<String, dynamic> toJson() => {'type': 'set_model', 'model': model};

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ClientSetModel && runtimeType == other.runtimeType && model == other.model;

  @override
  int get hashCode => model.hashCode;
}

class ClientSetMode extends ClientMessage {
  const ClientSetMode({required this.mode});
  final PermissionMode mode;

  @override
  Map<String, dynamic> toJson() => {'type': 'set_permission_mode', 'mode': mode.toJson()};

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ClientSetMode && runtimeType == other.runtimeType && mode == other.mode;

  @override
  int get hashCode => mode.hashCode;
}

class ClientRefreshHistory extends ClientMessage {
  const ClientRefreshHistory();

  @override
  Map<String, dynamic> toJson() => {'type': 'refresh_history'};

  @override
  bool operator ==(Object other) => identical(this, other) || other is ClientRefreshHistory;

  @override
  int get hashCode => runtimeType.hashCode;
}

class ClientSessionClose extends ClientMessage {
  const ClientSessionClose({required this.sessionId});
  final String sessionId;

  @override
  Map<String, dynamic> toJson() => {'type': 'session_close', 'sessionId': sessionId};

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ClientSessionClose &&
          runtimeType == other.runtimeType &&
          sessionId == other.sessionId;

  @override
  int get hashCode => sessionId.hashCode;
}

/// Request a fresh session-list snapshot. Server replies once with a
/// `sessions_update` frame; there is no longer any push on state transitions.
class ClientListSessions extends ClientMessage {
  const ClientListSessions();

  @override
  Map<String, dynamic> toJson() => {'type': 'list_sessions'};

  @override
  bool operator ==(Object other) => identical(this, other) || other is ClientListSessions;

  @override
  int get hashCode => runtimeType.hashCode;
}
