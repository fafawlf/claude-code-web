import 'package:flutter/foundation.dart';

import 'session_state.dart';

sealed class ServerMessage {
  const ServerMessage();

  factory ServerMessage.fromJson(Map<String, dynamic> json) {
    final type = json['type'];
    switch (type) {
      case 'ready':
        return ServerReady(
          state: SessionStateSnapshot.fromJson(json['state'] as Map<String, dynamic>),
        );
      case 'sdk_event':
        return ServerSdkEvent(
          id: (json['id'] as num).toInt(),
          event: json['event'],
        );
      case 'sdk_events_batch':
        final list = (json['events'] as List)
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList(growable: false);
        return ServerSdkEventBatch(
          events: list
              .map((e) => SdkEventEntry(id: (e['id'] as num).toInt(), event: e['event']))
              .toList(growable: false),
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
        );
      case 'plan_proposed':
        return ServerPlanProposed(
          reqId: json['reqId'] as String,
          plan: json['plan'] as String,
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
        );
      case 'heartbeat':
        return ServerHeartbeat(
          now: (json['now'] as num).toInt(),
          session: json['session'] == null
              ? null
              : SessionStateSnapshot.fromJson(json['session'] as Map<String, dynamic>),
          noActivityMs: (json['noActivityMs'] as num?)?.toInt(),
        );
      case 'error':
        return ServerError(message: json['message'] as String);
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

class ServerReady extends ServerMessage {
  const ServerReady({required this.state});
  final SessionStateSnapshot state;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ServerReady && runtimeType == other.runtimeType && state == other.state;

  @override
  int get hashCode => state.hashCode;
}

class ServerSdkEvent extends ServerMessage {
  const ServerSdkEvent({required this.id, required this.event});
  final int id;
  final Object? event;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ServerSdkEvent &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          event == other.event;

  @override
  int get hashCode => Object.hash(id, event);
}

class ServerSdkEventBatch extends ServerMessage {
  const ServerSdkEventBatch({required this.events});
  final List<SdkEventEntry> events;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ServerSdkEventBatch &&
          runtimeType == other.runtimeType &&
          listEquals(events, other.events);

  @override
  int get hashCode => Object.hashAll(events);
}

class ServerPermissionRequest extends ServerMessage {
  const ServerPermissionRequest({
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
      other is ServerPermissionRequest &&
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

class ServerPlanProposed extends ServerMessage {
  const ServerPlanProposed({required this.reqId, required this.plan});
  final String reqId;
  final String plan;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ServerPlanProposed &&
          runtimeType == other.runtimeType &&
          reqId == other.reqId &&
          plan == other.plan;

  @override
  int get hashCode => Object.hash(reqId, plan);
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

class ServerPendingControl extends ServerMessage {
  const ServerPendingControl({required this.sessionId, required this.control});
  final String sessionId;
  final PendingControl control;

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
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ServerPendingControl &&
          runtimeType == other.runtimeType &&
          sessionId == other.sessionId &&
          control == other.control;

  @override
  int get hashCode => Object.hash(sessionId, control);
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

class ServerStateUpdate extends ServerMessage {
  const ServerStateUpdate({required this.state});
  final SessionStatePatch state;

  Map<String, dynamic> toJson() => {'type': 'state_update', 'state': state.toJson()};

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ServerStateUpdate && runtimeType == other.runtimeType && state == other.state;

  @override
  int get hashCode => state.hashCode;
}

class ServerHeartbeat extends ServerMessage {
  const ServerHeartbeat({required this.now, this.session, this.noActivityMs});
  final int now;
  final SessionStateSnapshot? session;
  final int? noActivityMs;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ServerHeartbeat &&
          runtimeType == other.runtimeType &&
          now == other.now &&
          session == other.session &&
          noActivityMs == other.noActivityMs;

  @override
  int get hashCode => Object.hash(now, session, noActivityMs);
}

class ServerError extends ServerMessage {
  const ServerError({required this.message});
  final String message;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ServerError && runtimeType == other.runtimeType && message == other.message;

  @override
  int get hashCode => message.hashCode;
}
