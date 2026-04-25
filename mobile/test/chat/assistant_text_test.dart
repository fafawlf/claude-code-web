import 'package:claudecode_mobile/src/chat/assistant_text.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('cleanAssistantText', () {
    test('strips closed local-command-stdout "Set model to" block', () {
      const raw = 'hello <local-command-stdout>Set model to sonnet</local-command-stdout> world';
      expect(cleanAssistantText(raw), 'hello world');
    });

    test('is idempotent on clean text', () {
      const raw = 'just plain content';
      expect(cleanAssistantText(raw), 'just plain content');
    });

    test('trims trailing whitespace', () {
      expect(cleanAssistantText('hello   '), 'hello');
    });
  });

  group('cleanStreamingAssistantText', () {
    test('strips open-ended "Set model to" block mid-stream', () {
      const raw = 'hello <local-command-stdout>Set model to so';
      expect(cleanStreamingAssistantText(raw), 'hello');
    });

    test('falls back to cleanAssistantText when no open tag', () {
      expect(cleanStreamingAssistantText('hello world'), 'hello world');
    });
  });
}
