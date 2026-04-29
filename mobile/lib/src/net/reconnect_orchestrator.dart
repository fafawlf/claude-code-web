import 'dart:async';

import '../app/connect_controller.dart';

abstract class ConnectSink {
  Future<void> connect(ConnectTarget target);
  Future<void> disconnect();
}

/// Automatic reconnect with exponential backoff. Re-fires [ConnectSink.connect]
/// using the last-remembered target after an unexpected disconnect. Gives up
/// after 5 failed attempts; the UI then offers a manual retry.
class ReconnectOrchestrator {
  ReconnectOrchestrator({required this.sink});

  final ConnectSink sink;

  ConnectTarget? _lastTarget;
  int _attempt = 0;
  Timer? _timer;
  bool _userInitiated = false;
  bool _gaveUp = false;

  static const int _maxAttempts = 5;

  bool get gaveUp => _gaveUp;
  int get attempt => _attempt;

  /// True between a [userDisconnect] and the next successful connect (or
  /// [manualReconnect]). The ConnectScreen reads this to suppress its
  /// auto-reconnect-from-saved-credentials behavior so a manual disconnect
  /// actually lets the user edit connection settings.
  bool get userInitiatedDisconnect => _userInitiated;

  void rememberTarget(ConnectTarget target) {
    _lastTarget = target;
  }

  void notifyConnected() {
    _attempt = 0;
    _gaveUp = false;
    _userInitiated = false;
    _timer?.cancel();
    _timer = null;
  }

  void notifyDisconnected() {
    if (_userInitiated) return;
    if (_lastTarget == null) return;
    if (_attempt >= _maxAttempts) {
      _gaveUp = true;
      return;
    }
    _scheduleNext();
  }

  void _scheduleNext() {
    final int exp = _attempt;
    _attempt++;
    final Duration delay = Duration(seconds: 1 << exp);
    _timer?.cancel();
    _timer = Timer(delay, () {
      final ConnectTarget? t = _lastTarget;
      if (t != null) sink.connect(t);
    });
  }

  Future<void> userDisconnect() async {
    _userInitiated = true;
    _timer?.cancel();
    _timer = null;
    await sink.disconnect();
  }

  Future<void> manualReconnect() async {
    _attempt = 0;
    _gaveUp = false;
    _userInitiated = false;
    _timer?.cancel();
    _timer = null;
    final ConnectTarget? t = _lastTarget;
    if (t != null) await sink.connect(t);
  }

  void dispose() {
    _timer?.cancel();
    _timer = null;
  }
}
