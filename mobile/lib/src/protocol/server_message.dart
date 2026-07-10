import 'package:flutter/foundation.dart';

import 'session_state.dart';

enum ReplayMode {
  full,
  delta;

  static ReplayMode? fromJson(Object? value) => switch (value) {
        'full' => ReplayMode.full,
        'delta' => ReplayMode.delta,
        null => null,
        _ => throw FormatException('Unknown ReplayMode: $value'),
      };
}

enum HistoryStatus {
  loading,
  ready,
  error;

  static HistoryStatus? fromJson(Object? value) => switch (value) {
        'loading' => HistoryStatus.loading,
        'ready' => HistoryStatus.ready,
        'error' => HistoryStatus.error,
        null => null,
        _ => throw FormatException('Unknown HistoryStatus: $value'),
      };
}

/// Implemented by frames that belong to one WebSocket attachment generation.
/// `sessions_update` is intentionally global and does not implement this type.
abstract interface class AttachmentScopedServerMessage {
  String? get attachId;
  String? get sessionId;
}

sealed class ServerMessage {
  const ServerMessage();

  factory ServerMessage.fromJson(Map<String, dynamic> json) {
    final type = json['type'];
    switch (type) {
      case 'ready':
        return ServerReady(
          state: SessionStateSnapshot.fromJson(json['state'] as Map<String, dynamic>),
          attachId: json['attachId'] as String?,
          sessionId: json['sessionId'] as String?,
          replayMode: ReplayMode.fromJson(json['replayMode']),
          historyStatus: HistoryStatus.fromJson(json['historyStatus']),
          historyTruncated: json['historyTruncated'] as bool?,
        );
      case 'sdk_event':
        return ServerSdkEvent(
          id: (json['id'] as num).toInt(),
          event: json['event'],
          attachId: json['attachId'] as String?,
          sessionId: json['sessionId'] as String?,
        );
      case 'sdk_events_batch':
        final list = (json['events'] as List)
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList(growable: false);
        return ServerSdkEventBatch(
          events: list
              .map((e) => SdkEventEntry(id: (e['id'] as num).toInt(), event: e['event']))
              .toList(growable: false),
          attachId: json['attachId'] as String?,
          sessionId: json['sessionId'] as String?,
          replayComplete: json['replayComplete'] as bool?,
          historyStatus: HistoryStatus.fromJson(json['historyStatus']),
          historyTruncated: json['historyTruncated'] as bool?,
        );
      case 'permission_request':
        return ServerPermissionRequest(
          reqId: json['reqId'] as String,
          toolName: json['toolName'] as String,
          toolUseId: json['toolUseId'] as String?,
          input: Map<String, dynamic>.from(json['input'] as Map),
          title: json['title'] as String?,
          displayName: json['displayName'] as String?,
          description: json['description'] as String?,
          attachId: json['attachId'] as String?,
          sessionId: json['sessionId'] as String?,
        );
      case 'plan_proposed':
        return ServerPlanProposed(
          reqId: json['reqId'] as String,
          plan: json['plan'] as String,
          attachId: json['attachId'] as String?,
          sessionId: json['sessionId'] as String?,
        );
      case 'pending_control':
        return ServerPendingControl.fromJson(json);
      case 'sessions_update':
        final arr = (json['sessions'] as List)
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList(growable: false);
        return ServerSessionsUpdate(
          sessions: arr.map(SessionStateSnapshot.fromJson).toList(growable: false),
        );
      case 'state_update':
        return ServerStateUpdate(
          state: SessionStatePatch.fromJson(Map<String, dynamic>.from(json['state'] as Map)),
          attachId: json['attachId'] as String?,
          sessionId: json['sessionId'] as String?,
        );
      case 'heartbeat':
        return ServerHeartbeat(
          now: (json['now'] as num).toInt(),
          session: json['session'] == null
              ? null
              : SessionStateSnapshot.fromJson(json['session'] as Map<String, dynamic>),
          noActivityMs: (json['noActivityMs'] as num?)?.toInt(),
          attachId: json['attachId'] as String?,
          sessionId: json['sessionId'] as String?,
        );
      case 'error':
        return ServerError(
          message: json['message'] as String,
          attachId: json['attachId'] as String?,
          sessionId: json['sessionId'] as String?,
        );
      default:
        throw FormatException('Unknown ServerMessage type: $type');
    }
  }
}

class SdkEventEntry {
  const SdkEventEntry({required this.id, required this.event});
  final int id;
  final Object? event;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is SdkEventEntry &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          event == other.event;

  @override
  int get hashCode => Object.hash(id, event);
}

class ServerReady extends ServerMessage implements AttachmentScopedServerMessage {
  const ServerReady({
    required this.state,
    this.attachId,
    this.sessionId,
    this.replayMode,
    this.historyStatus,
    this.historyTruncated,
  });
  final SessionStateSnapshot state;
  @override
  final String? attachId;
  @override
  final String? sessionId;
  final ReplayMode? replayMode;
  final HistoryStatus? historyStatus;
  final bool? historyTruncated;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ServerReady &&
          runtimeType == other.runtimeType &&
          state == other.state &&
          attachId == other.attachId &&
          sessionId == other.sessionId &&
          replayMode == other.replayMode &&
          historyStatus == other.historyStatus &&
          historyTruncated == other.historyTruncated;

  @override
  int get hashCode => Object.hash(
        state,
        attachId,
        sessionId,
        replayMode,
        historyStatus,
        historyTruncated,
      );
}

class ServerSdkEvent extends ServerMessage implements AttachmentScopedServerMessage {
  const ServerSdkEvent({
    required this.id,
    required this.event,
    this.attachId,
    this.sessionId,
  });
  final int id;
  final Object? event;
  @override
  final String? attachId;
  @override
  final String? sessionId;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ServerSdkEvent &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          event == other.event &&
          attachId == other.attachId &&
          sessionId == other.sessionId;

  @override
  int get hashCode => Object.hash(id, event, attachId, sessionId);
}

class ServerSdkEventBatch extends ServerMessage implements AttachmentScopedServerMessage {
  const ServerSdkEventBatch({
    required this.events,
    this.attachId,
    this.sessionId,
    this.replayComplete,
    this.historyStatus,
    this.historyTruncated,
  });
  final List<SdkEventEntry> events;
  @override
  final String? attachId;
  @override
  final String? sessionId;
  final bool? replayComplete;
  final HistoryStatus? historyStatus;
  final bool? historyTruncated;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ServerSdkEventBatch &&
          runtimeType == other.runtimeType &&
          listEquals(events, other.events) &&
          attachId == other.attachId &&
          sessionId == other.sessionId &&
          replayComplete == other.replayComplete &&
          historyStatus == other.historyStatus &&
          historyTruncated == other.historyTruncated;

  @override
  int get hashCode => Object.hash(
        Object.hashAll(events),
        attachId,
        sessionId,
        replayComplete,
        historyStatus,
        historyTruncated,
      );
}

class ServerPermissionRequest extends ServerMessage
    implements AttachmentScopedServerMessage {
  const ServerPermissionRequest({
    required this.reqId,
    required this.toolName,
    required this.input,
    this.toolUseId,
    this.title,
    this.displayName,
    this.description,
    this.attachId,
    this.sessionId,
  });
  final String reqId;
  final String toolName;
  final String? toolUseId;
  final Map<String, dynamic> input;
  final String? title;
  final String? displayName;
  final String? description;
  @override
  final String? attachId;
  @override
  final String? sessionId;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ServerPermissionRequest &&
          runtimeType == other.runtimeType &&
          reqId == other.reqId &&
          toolName == other.toolName &&
          toolUseId == other.toolUseId &&
          mapEquals(input, other.input) &&
          title == other.title &&
          displayName == other.displayName &&
          description == other.description &&
          attachId == other.attachId &&
          sessionId == other.sessionId;

  @override
  int get hashCode => Object.hash(
        reqId,
        toolName,
        toolUseId,
        Object.hashAllUnordered(input.entries.map((e) => Object.hash(e.key, e.value))),
        title,
        displayName,
        description,
        attachId,
        sessionId,
      );
}

class ServerPlanProposed extends ServerMessage implements AttachmentScopedServerMessage {
  const ServerPlanProposed({
    required this.reqId,
    required this.plan,
    this.attachId,
    this.sessionId,
  });
  final String reqId;
  final String plan;
  @override
  final String? attachId;
  @override
  final String? sessionId;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ServerPlanProposed &&
          runtimeType == other.runtimeType &&
          reqId == other.reqId &&
          plan == other.plan &&
          attachId == other.attachId &&
          sessionId == other.sessionId;

  @override
  int get hashCode => Object.hash(reqId, plan, attachId, sessionId);
}

sealed class PendingControl {
  const PendingControl();
}

class PendingPermission extends PendingControl {
  const PendingPermission({
    required this.reqId,
    required this.toolName,
    required this.input,
    this.toolUseId,
    this.title,
    this.displayName,
    this.description,
  });
  final String reqId;
  final String toolName;
  final String? toolUseId;
  final Map<String, dynamic> input;
  final String? title;
  final String? displayName;
  final String? description;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is PendingPermission &&
          runtimeType == other.runtimeType &&
          reqId == other.reqId &&
          toolName == other.toolName &&
          toolUseId == other.toolUseId &&
          mapEquals(input, other.input) &&
          title == other.title &&
          displayName == other.displayName &&
          description == other.description;

  @override
  int get hashCode => Object.hash(
        reqId,
        toolName,
        toolUseId,
        Object.hashAllUnordered(input.entries.map((e) => Object.hash(e.key, e.value))),
        title,
        displayName,
        description,
      );
}

class PendingPlan extends PendingControl {
  const PendingPlan({required this.reqId, required this.plan});
  final String reqId;
  final String plan;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is PendingPlan &&
          runtimeType == other.runtimeType &&
          reqId == other.reqId &&
          plan == other.plan;

  @override
  int get hashCode => Object.hash(reqId, plan);
}

class ServerPendingControl extends ServerMessage implements AttachmentScopedServerMessage {
  const ServerPendingControl({
    required this.sessionId,
    required this.control,
    this.attachId,
  });
  @override
  final String sessionId;
  final PendingControl control;
  @override
  final String? attachId;

  factory ServerPendingControl.fromJson(Map<String, dynamic> json) {
    final ctrl = Map<String, dynamic>.from(json['control'] as Map);
    final kind = ctrl['kind'];
    final control = switch (kind) {
      'permission' => PendingPermission(
          reqId: ctrl['reqId'] as String,
          toolName: ctrl['toolName'] as String,
          toolUseId: ctrl['toolUseId'] as String?,
          input: Map<String, dynamic>.from(ctrl['input'] as Map),
          title: ctrl['title'] as String?,
          displayName: ctrl['displayName'] as String?,
          description: ctrl['description'] as String?,
        ),
      'plan' => PendingPlan(
          reqId: ctrl['reqId'] as String,
          plan: ctrl['plan'] as String,
        ),
      _ => throw FormatException('Unknown PendingControl.kind: $kind'),
    };
    return ServerPendingControl(
      sessionId: json['sessionId'] as String,
      control: control,
      attachId: json['attachId'] as String?,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ServerPendingControl &&
          runtimeType == other.runtimeType &&
          sessionId == other.sessionId &&
          control == other.control &&
          attachId == other.attachId;

  @override
  int get hashCode => Object.hash(sessionId, control, attachId);
}

class ServerSessionsUpdate extends ServerMessage {
  const ServerSessionsUpdate({required this.sessions});
  final List<SessionStateSnapshot> sessions;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ServerSessionsUpdate &&
          runtimeType == other.runtimeType &&
          listEquals(sessions, other.sessions);

  @override
  int get hashCode => Object.hashAll(sessions);
}

class ServerStateUpdate extends ServerMessage implements AttachmentScopedServerMessage {
  const ServerStateUpdate({
    required this.state,
    this.attachId,
    this.sessionId,
  });
  final SessionStatePatch state;
  @override
  final String? attachId;
  @override
  final String? sessionId;

  Map<String, dynamic> toJson() => {
        'type': 'state_update',
        if (attachId != null) 'attachId': attachId,
        if (sessionId != null) 'sessionId': sessionId,
        'state': state.toJson(),
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ServerStateUpdate &&
          runtimeType == other.runtimeType &&
          state == other.state &&
          attachId == other.attachId &&
          sessionId == other.sessionId;

  @override
  int get hashCode => Object.hash(state, attachId, sessionId);
}

class ServerHeartbeat extends ServerMessage implements AttachmentScopedServerMessage {
  const ServerHeartbeat({
    required this.now,
    this.session,
    this.noActivityMs,
    this.attachId,
    this.sessionId,
  });
  final int now;
  final SessionStateSnapshot? session;
  final int? noActivityMs;
  @override
  final String? attachId;
  @override
  final String? sessionId;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ServerHeartbeat &&
          runtimeType == other.runtimeType &&
          now == other.now &&
          session == other.session &&
          noActivityMs == other.noActivityMs &&
          attachId == other.attachId &&
          sessionId == other.sessionId;

  @override
  int get hashCode => Object.hash(now, session, noActivityMs, attachId, sessionId);
}

class ServerError extends ServerMessage implements AttachmentScopedServerMessage {
  const ServerError({required this.message, this.attachId, this.sessionId});
  final String message;
  @override
  final String? attachId;
  @override
  final String? sessionId;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ServerError &&
          runtimeType == other.runtimeType &&
          message == other.message &&
          attachId == other.attachId &&
          sessionId == other.sessionId;

  @override
  int get hashCode => Object.hash(message, attachId, sessionId);
}
