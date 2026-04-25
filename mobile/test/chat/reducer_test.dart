import 'package:claudecode_mobile/src/chat/chat_state.dart';
import 'package:claudecode_mobile/src/chat/reducer.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('applyEvent', () {
    test('stream_event content_block_delta appends to streamingText and sets busy', () {
      final s0 = ChatState.initial;
      final ev = {
        'type': 'stream_event',
        'event': {
          'type': 'content_block_delta',
          'delta': {'type': 'text_delta', 'text': 'hel'},
        },
      };
      final s1 = applyEvent(s0, ev, 1);
      expect(s1.streamingText, 'hel');
      expect(s1.busy, isTrue);
      expect(s1.lastEventId, 1);
    });

    test('stream_event message_start resets streamingText', () {
      final s0 = ChatState.initial.copyWith(streamingText: 'leftover');
      final ev = {'type': 'stream_event', 'event': {'type': 'message_start'}};
      final s1 = applyEvent(s0, ev, 2);
      expect(s1.streamingText, '');
      expect(s1.busy, isTrue);
    });

    test('assistant content text emits AssistantTextItem and clears streamingText', () {
      final s0 = ChatState.initial.copyWith(streamingText: 'hel');
      final ev = {
        'type': 'assistant',
        'message': {
          'content': [
            {'type': 'text', 'text': 'hello world'},
          ],
        },
      };
      final s1 = applyEvent(s0, ev, 3);
      expect(s1.items, hasLength(1));
      final item = s1.items.single as AssistantTextItem;
      expect(item.text, 'hello world');
      expect(s1.streamingText, '');
      expect(s1.busy, isTrue);
    });

    test('assistant content thinking emits ThinkingItem', () {
      final ev = {
        'type': 'assistant',
        'message': {
          'content': [
            {'type': 'thinking', 'thinking': 'pondering'},
          ],
        },
      };
      final s1 = applyEvent(ChatState.initial, ev, 4);
      expect(s1.items.single, isA<ThinkingItem>());
      expect((s1.items.single as ThinkingItem).text, 'pondering');
    });

    test('assistant content tool_use emits ToolUseItem with id/name/input', () {
      final ev = {
        'type': 'assistant',
        'message': {
          'content': [
            {'type': 'tool_use', 'id': 'tu_1', 'name': 'Bash', 'input': {'cmd': 'ls'}},
          ],
        },
      };
      final s1 = applyEvent(ChatState.initial, ev, 5);
      final item = s1.items.single as ToolUseItem;
      expect(item.toolUseId, 'tu_1');
      expect(item.name, 'Bash');
      expect(item.input, {'cmd': 'ls'});
      expect(item.result, isNull);
    });

    test('user echo absorbs matching optimistic item', () {
      final s0 = ChatState.initial.copyWith(items: <ChatItem>[
        const UserItem(id: 'u1', text: 'hi there', optimistic: true),
      ]);
      final ev = {'type': 'user', 'message': {'content': 'hi there'}};
      final s1 = applyEvent(s0, ev, 6);
      expect(s1.items, hasLength(1));
      expect((s1.items.single as UserItem).optimistic, isFalse);
    });

    test('user echo without matching optimistic appends new UserItem', () {
      final ev = {'type': 'user', 'message': {'content': 'fresh'}};
      final s1 = applyEvent(ChatState.initial, ev, 7);
      expect(s1.items, hasLength(1));
      expect((s1.items.single as UserItem).text, 'fresh');
    });

    test('user tool_result binds to prior ToolUseItem by tool_use_id', () {
      final s0 = ChatState.initial.copyWith(items: <ChatItem>[
        const ToolUseItem(id: 't1', toolUseId: 'tu_X', name: 'Bash', input: {}),
      ]);
      final ev = {
        'type': 'user',
        'message': {
          'content': [
            {'type': 'tool_result', 'tool_use_id': 'tu_X', 'content': 'ok', 'is_error': false},
          ],
        },
      };
      final s1 = applyEvent(s0, ev, 8);
      final item = s1.items.single as ToolUseItem;
      expect(item.result, isNotNull);
      expect(item.result!.content, 'ok');
      expect(item.result!.isError, isFalse);
    });

    test('result clears busy and streamingText', () {
      final s0 = ChatState.initial.copyWith(busy: true, streamingText: 'x');
      final s1 = applyEvent(s0, {'type': 'result'}, 9);
      expect(s1.busy, isFalse);
      expect(s1.streamingText, '');
    });

    test('system error appends error SystemItem and clears busy', () {
      final s0 = ChatState.initial.copyWith(busy: true);
      final ev = {'type': 'system', 'subtype': 'error', 'message': 'boom'};
      final s1 = applyEvent(s0, ev, 10);
      final item = s1.items.single as SystemItem;
      expect(item.text, 'boom');
      expect(item.level, SystemLevel.error);
      expect(s1.busy, isFalse);
    });

    test('lastEventId is monotonic', () {
      final s0 = ChatState.initial.copyWith(lastEventId: 100);
      final s1 = applyEvent(s0, {'type': 'result'}, 5);
      expect(s1.lastEventId, 100);
    });
  });

  group('helpers', () {
    test('addUserOptimistic appends optimistic UserItem', () {
      final s1 = addUserOptimistic(ChatState.initial, 'draft');
      final item = s1.items.single as UserItem;
      expect(item.text, 'draft');
      expect(item.optimistic, isTrue);
    });
  });
}
