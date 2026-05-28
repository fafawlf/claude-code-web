import 'dart:typed_data';

import 'package:claudecode_mobile/src/transport/ssh_tunnel.dart';
import 'package:flutter_test/flutter_test.dart';

SshExecResult _r({
  required int exitCode,
  required String out,
  String err = '',
}) =>
    SshExecResult(
      exitCode: exitCode,
      stdout: Uint8List.fromList(out.codeUnits),
      stderr: Uint8List.fromList(err.codeUnits),
    );

void main() {
  test('parses token from trimmed stdout of cat command', () {
    final token = parseTokenFromExec(
      _r(exitCode: 0, out: '  abc123\n\n'),
      command: 'cat ~/.claude-code-web/token',
    );
    expect(token, 'abc123');
  });

  test('throws when exit code non-zero', () {
    expect(
      () => parseTokenFromExec(
        _r(exitCode: 1, out: '', err: 'No such file'),
        command: 'cat ~/.claude-code-web/token',
      ),
      throwsA(isA<SshExecException>()),
    );
  });

  test('throws when stdout is empty after trim', () {
    expect(
      () => parseTokenFromExec(
        _r(exitCode: 0, out: '   \n\n'),
        command: 'cat ~/.claude-code-web/token',
      ),
      throwsA(isA<FormatException>()),
    );
  });

  test('preserves multi-line stdout? No — token is single-line; we reject', () {
    expect(
      () => parseTokenFromExec(
        _r(exitCode: 0, out: 'line1\nline2\n'),
        command: 'cat t',
      ),
      throwsA(isA<FormatException>()),
    );
  });
}
