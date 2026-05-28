import 'package:claudecode_mobile/src/app/connect_controller.dart';
import 'package:claudecode_mobile/src/net/reconnect_orchestrator.dart';
import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeSink implements ConnectSink {
  _FakeSink();
  final List<ConnectTarget> connects = <ConnectTarget>[];
  final List<void> disconnects = <void>[];
  @override
  Future<void> connect(ConnectTarget target) async {
    connects.add(target);
  }

  @override
  Future<void> disconnect() async {
    disconnects.add(null);
  }
}

ConnectTarget _t() =>
    const WsDirectTarget(host: 'h', port: 1, token: 'x');

void main() {
  test('backoff sequence is 1s, 2s, 4s, 8s, 16s', () {
    fakeAsync((FakeAsync async) {
      final sink = _FakeSink();
      final orch = ReconnectOrchestrator(sink: sink);
      orch.rememberTarget(_t());

      final List<int> secondsSeen = <int>[];
      void drop() {
        final before = sink.connects.length;
        orch.notifyDisconnected();
        int seconds = 0;
        while (sink.connects.length == before) {
          async.elapse(const Duration(seconds: 1));
          seconds++;
          if (seconds > 20) break;
        }
        secondsSeen.add(seconds);
      }

      for (int i = 0; i < 5; i++) {
        drop();
      }

      expect(secondsSeen, <int>[1, 2, 4, 8, 16]);
      expect(orch.gaveUp, isFalse);
    });
  });

  test('gives up after 5 attempts', () {
    fakeAsync((FakeAsync async) {
      final sink = _FakeSink();
      final orch = ReconnectOrchestrator(sink: sink);
      orch.rememberTarget(_t());
      for (int i = 0; i < 5; i++) {
        orch.notifyDisconnected();
        async.elapse(const Duration(seconds: 20));
      }
      orch.notifyDisconnected();
      async.elapse(const Duration(seconds: 60));
      expect(sink.connects.length, 5);
      expect(orch.gaveUp, isTrue);
    });
  });

  test('userDisconnect cancels pending retries', () {
    fakeAsync((FakeAsync async) {
      final sink = _FakeSink();
      final orch = ReconnectOrchestrator(sink: sink);
      orch.rememberTarget(_t());
      orch.notifyDisconnected();
      async.elapse(const Duration(milliseconds: 500));
      orch.userDisconnect();
      async.elapse(const Duration(seconds: 60));
      expect(sink.connects, isEmpty);
    });
  });

  test('successful connect resets attempt counter', () {
    fakeAsync((FakeAsync async) {
      final sink = _FakeSink();
      final orch = ReconnectOrchestrator(sink: sink);
      orch.rememberTarget(_t());
      orch.notifyDisconnected();
      async.elapse(const Duration(seconds: 1));
      expect(sink.connects.length, 1);
      orch.notifyConnected();
      orch.notifyDisconnected();
      async.elapse(const Duration(seconds: 1));
      expect(sink.connects.length, 2,
          reason: 'after successful reconnect, next drop should retry at 1s again');
    });
  });

  test('manualReconnect clears gaveUp and reconnects immediately', () {
    fakeAsync((FakeAsync async) {
      final sink = _FakeSink();
      final orch = ReconnectOrchestrator(sink: sink);
      orch.rememberTarget(_t());
      for (int i = 0; i < 5; i++) {
        orch.notifyDisconnected();
        async.elapse(const Duration(seconds: 20));
      }
      orch.notifyDisconnected();
      async.elapse(const Duration(seconds: 60));
      expect(orch.gaveUp, isTrue);
      sink.connects.clear();
      orch.manualReconnect();
      async.elapse(const Duration(milliseconds: 1));
      expect(sink.connects, hasLength(1));
      expect(orch.gaveUp, isFalse);
    });
  });
}
