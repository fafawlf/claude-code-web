import 'package:flutter/foundation.dart';

import '../protocol/server_message.dart';
import '../protocol/session_state.dart';

sealed class ChatItem {
  const ChatItem({required this.id});
  final String id;
}

class UserItem extends ChatItem {
  const UserItem({required super.id, required this.text, this.optimistic = false});
  final String text;
  final bool optimistic;

  UserItem copyWith({String? text, bool? optimistic}) => UserItem(
        id: id,
        text: text ?? this.text,
        optimistic: optimistic ?? this.optimistic,
      );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is UserItem &&
          id == other.id &&
          text == other.text &&
          optimistic == other.optimistic;

  @override
  int get hashCode => Object.hash(id, text, optimistic);
}

class AssistantTextItem extends ChatItem {
  const AssistantTextItem({required super.id, required this.text, this.streamed = false});
  final String text;
  final bool streamed;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AssistantTextItem &&
          id == other.id &&
          text == other.text &&
          streamed == other.streamed;

  @override
  int get hashCode => Object.hash(id, text, streamed);
}

class ThinkingItem extends ChatItem {
  const ThinkingItem({required super.id, required this.text});
  final String text;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ThinkingItem && id == other.id && text == other.text;

  @override
  int get hashCode => Object.hash(id, text);
}

class ToolResult {
  const ToolResult({required this.content, required this.isError});
  final String content;
  final bool isError;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ToolResult && content == other.content && isError == other.isError;

  @override
  int get hashCode => Object.hash(content, isError);
}

class ToolUseItem extends ChatItem {
  const ToolUseItem({
    required super.id,
    required this.toolUseId,
    required this.name,
    required this.input,
    this.result,
  });
  final String toolUseId;
  final String name;
  final Map<String, dynamic> input;
  final ToolResult? result;

  ToolUseItem withResult(ToolResult r) => ToolUseItem(
        id: id,
        toolUseId: toolUseId,
        name: name,
        input: input,
        result: r,
      );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ToolUseItem &&
          id == other.id &&
          toolUseId == other.toolUseId &&
          name == other.name &&
          mapEquals(input, other.input) &&
          result == other.result;

  @override
  int get hashCode => Object.hash(id, toolUseId, name, Object.hashAll(input.entries), result);
}

enum SystemLevel { info, error }

class SystemItem extends ChatItem {
  const SystemItem({required super.id, required this.text, this.level = SystemLevel.info});
  final String text;
  final SystemLevel level;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is SystemItem && id == other.id && text == other.text && level == other.level;

  @override
  int get hashCode => Object.hash(id, text, level);
}

class ChatState {
  const ChatState({
    this.items = const <ChatItem>[],
    this.busy = false,
    this.lastEventId = 0,
    this.state,
    this.streamingText = '',
    this.pendingPermission,
    this.pendingPlan,
    this.heartbeatInactiveSeconds,
  });

  final List<ChatItem> items;
  final bool busy;
  final int lastEventId;
  final SessionStateSnapshot? state;
  final String streamingText;

  /// Set when the server is asking the user to approve a tool invocation.
  /// Cleared when the user responds or the server tells us the control lapsed.
  final PendingPermission? pendingPermission;

  /// Set when the session is in plan-mode and Claude proposed a plan awaiting approval.
  final PendingPlan? pendingPlan;

  /// Latest "seconds since last SDK event" reported by the server heartbeat.
  /// Null if we haven't received a heartbeat yet.
  final int? heartbeatInactiveSeconds;

  static const ChatState initial = ChatState();

  ChatState copyWith({
    List<ChatItem>? items,
    bool? busy,
    int? lastEventId,
    SessionStateSnapshot? state,
    String? streamingText,
    Object? pendingPermission = _sentinel,
    Object? pendingPlan = _sentinel,
    Object? heartbeatInactiveSeconds = _sentinel,
  }) {
    return ChatState(
      items: items ?? this.items,
      busy: busy ?? this.busy,
      lastEventId: lastEventId ?? this.lastEventId,
      state: state ?? this.state,
      streamingText: streamingText ?? this.streamingText,
      pendingPermission: identical(pendingPermission, _sentinel)
          ? this.pendingPermission
          : pendingPermission as PendingPermission?,
      pendingPlan: identical(pendingPlan, _sentinel)
          ? this.pendingPlan
          : pendingPlan as PendingPlan?,
      heartbeatInactiveSeconds: identical(heartbeatInactiveSeconds, _sentinel)
          ? this.heartbeatInactiveSeconds
          : heartbeatInactiveSeconds as int?,
    );
  }

  static const Object _sentinel = Object();
}
