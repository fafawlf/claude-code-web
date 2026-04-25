import 'dart:math';

import '../protocol/session_state.dart';
import 'assistant_text.dart';
import 'chat_state.dart';

final Random _rng = Random();
String _rid() => _rng.nextInt(1 << 32).toRadixString(36);

/// Extract a user text payload from an SDK user event's `content` field.
/// Mirrors `extractUserText` in `web/src/reducer.ts`.
String? _extractUserText(Object? content) {
  if (content is String) return content.isEmpty ? null : content;
  if (content is! List) return null;
  final buf = StringBuffer();
  for (final part in content) {
    if (part is! Map) continue;
    if (part['type'] == 'text' && part['text'] is String) {
      buf.write(part['text']);
    }
  }
  final out = buf.toString();
  return out.isEmpty ? null : out;
}

List<ChatItem>? _absorbOptimistic(List<ChatItem> items, String text) {
  final scan = items.length < 5 ? items.length : 5;
  for (int i = items.length - 1; i >= items.length - scan && i >= 0; i--) {
    final it = items[i];
    if (it is UserItem && it.optimistic && it.text == text) {
      final copy = List<ChatItem>.of(items);
      copy[i] = it.copyWith(optimistic: false);
      return copy;
    }
  }
  return null;
}

/// Belt-and-suspenders: when the server produces any assistant-side activity
/// (message_start, a streamed text delta, or a full assistant message), the
/// user's latest optimistic message is unambiguously "sent". The text-based
/// absorb in [_absorbOptimistic] can miss when a `user` echo event never
/// arrives or text trims differ; this guarantees the "Sending…" status
/// eventually clears. Mutates [items] in place.
void _confirmLatestOptimistic(List<ChatItem> items) {
  for (int i = items.length - 1; i >= 0; i--) {
    final it = items[i];
    if (it is UserItem) {
      if (it.optimistic) items[i] = it.copyWith(optimistic: false);
      return;
    }
  }
}

bool _isStreamHandoff(String streamingText, String finalText) {
  if (streamingText.isEmpty || finalText.isEmpty) return false;
  final a = streamingText.replaceAll(RegExp(r'\s+$'), '');
  final b = finalText.replaceAll(RegExp(r'\s+$'), '');
  return a == b;
}

/// Fold a single SDK event into a [ChatState]. 1:1 port of `applyEvent` from
/// `web/src/reducer.ts`. `ev` is the raw SDK payload; shape is loose by design.
ChatState applyEvent(ChatState s, Object? ev, int eventId) {
  if (ev is! Map) return s.copyWith(lastEventId: max(s.lastEventId, eventId));
  final List<ChatItem> items = List<ChatItem>.of(s.items);
  bool busy = s.busy;
  String streamingText = s.streamingText;

  final String? type = ev['type'] as String?;
  if (type == 'stream_event') {
    final inner = ev['event'];
    if (inner is Map) {
      if (inner['type'] == 'content_block_delta') {
        final delta = inner['delta'];
        if (delta is Map && delta['type'] == 'text_delta' && delta['text'] is String) {
          streamingText = streamingText + (delta['text'] as String);
          busy = true;
          _confirmLatestOptimistic(items);
        }
      } else if (inner['type'] == 'message_start') {
        streamingText = '';
        busy = true;
        _confirmLatestOptimistic(items);
      }
    }
    return s.copyWith(
      items: items,
      busy: busy,
      streamingText: streamingText,
      lastEventId: max(s.lastEventId, eventId),
    );
  }

  if (type == 'assistant') {
    final msg = ev['message'];
    final content = msg is Map ? msg['content'] : null;
    if (content is List) {
      final String streamedText = streamingText;
      busy = true;
      streamingText = '';
      _confirmLatestOptimistic(items);
      for (final part in content) {
        if (part is! Map) continue;
        final partType = part['type'];
        if (partType == 'text' && part['text'] is String) {
          final text = cleanAssistantText(part['text'] as String);
          if (text.isEmpty) continue;
          items.add(AssistantTextItem(
            id: _rid(),
            text: text,
            streamed: _isStreamHandoff(cleanAssistantText(streamedText), text),
          ));
        } else if (partType == 'thinking' && part['thinking'] is String) {
          items.add(ThinkingItem(id: _rid(), text: part['thinking'] as String));
        } else if (partType == 'tool_use') {
          items.add(ToolUseItem(
            id: _rid(),
            toolUseId: part['id'] as String,
            name: part['name'] as String,
            input: Map<String, dynamic>.from(part['input'] as Map? ?? <String, dynamic>{}),
          ));
        }
      }
    }
  } else if (type == 'user') {
    final msg = ev['message'];
    final content = msg is Map ? msg['content'] : null;
    final text = _extractUserText(content);
    if (text != null) {
      final absorbed = _absorbOptimistic(items, text);
      if (absorbed != null) {
        return s.copyWith(
          items: absorbed,
          busy: busy,
          streamingText: streamingText,
          lastEventId: max(s.lastEventId, eventId),
        );
      }
      items.add(UserItem(id: _rid(), text: text));
    }
    if (content is List) {
      for (final part in content) {
        if (part is! Map) continue;
        if (part['type'] != 'tool_result') continue;
        final toolUseId = part['tool_use_id'] as String;
        final rawContent = part['content'];
        final String resultContent = rawContent is String ? rawContent : rawContent.toString();
        final bool isError = part['is_error'] == true;
        for (int i = items.length - 1; i >= 0; i--) {
          final x = items[i];
          if (x is ToolUseItem && x.toolUseId == toolUseId) {
            items[i] = x.withResult(ToolResult(content: resultContent, isError: isError));
            break;
          }
        }
      }
    }
  } else if (type == 'result') {
    busy = false;
    streamingText = '';
  } else if (type == 'system' && ev['subtype'] == 'error') {
    final String text = (ev['message'] ?? 'error').toString();
    items.add(SystemItem(id: _rid(), text: text, level: SystemLevel.error));
    busy = false;
    streamingText = '';
  }

  return s.copyWith(
    items: items,
    busy: busy,
    streamingText: streamingText,
    lastEventId: max(s.lastEventId, eventId),
  );
}

/// Optimistically append a user message on send (replaced when the echo arrives).
ChatState addUserOptimistic(ChatState s, String text) {
  final items = List<ChatItem>.of(s.items)
    ..add(UserItem(id: _rid(), text: text, optimistic: true));
  return s.copyWith(items: items);
}

/// Merge a partial SessionStateSnapshot patch onto the existing snapshot.
ChatState applyStateDelta(ChatState s, SessionStatePatch delta) {
  if (s.state == null) return s;
  return s.copyWith(state: delta.applyTo(s.state!));
}

/// Set the full snapshot from a `ready` or initial `sessions_update` row.
ChatState withReady(ChatState s, SessionStateSnapshot snap) => s.copyWith(state: snap);

ChatState addSystem(ChatState s, String text, {SystemLevel level = SystemLevel.info}) {
  final items = List<ChatItem>.of(s.items)..add(SystemItem(id: _rid(), text: text, level: level));
  return s.copyWith(items: items);
}
