import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../chat/chat_state.dart';
import '../chat/sessions_store.dart';
import '../protocol/session_state.dart';
import 'providers.dart';

class SessionListScreen extends ConsumerWidget {
  const SessionListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<SessionsState> async = ref.watch(sessionsStateProvider);
    final SessionsState s = async.value ?? const SessionsState();
    final SessionsStore store = ref.watch(sessionsStoreProvider);

    return SafeArea(
      child: Column(
        children: <Widget>[
          const Padding(
            padding: EdgeInsets.all(16),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text('Sessions',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: ListView.separated(
              itemCount: s.list.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (BuildContext context, int idx) {
                final SessionStateSnapshot snap = s.list[idx];
                final ChatState? cs = s.byId[snap.sessionId];
                final String preview = _firstUserPreview(cs);
                final bool active = snap.sessionId == s.activeId;
                return ListTile(
                  leading: Icon(Icons.circle,
                      size: 10, color: _dotColor(snap.runtimeStatus)),
                  title: Text(snap.cwd,
                      maxLines: 1, overflow: TextOverflow.ellipsis),
                  subtitle: preview.isEmpty
                      ? null
                      : Text(preview,
                          maxLines: 1, overflow: TextOverflow.ellipsis),
                  trailing: active
                      ? const Icon(Icons.keyboard_arrow_right, size: 18)
                      : null,
                  onTap: () {
                    store.switchTo(snap.sessionId);
                    Navigator.of(context).pop();
                  },
                );
              },
            ),
          ),
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.all(12),
            child: FilledButton.icon(
              icon: const Icon(Icons.add),
              label: const Text('New session'),
              onPressed: () {
                // Match web: no prompt — inherit the active session's cwd.
                final ChatState? active =
                    s.activeId != null ? s.byId[s.activeId!] : null;
                store.newSession(active?.state?.cwd);
                Navigator.of(context).pop();
              },
            ),
          ),
        ],
      ),
    );
  }

  String _firstUserPreview(ChatState? cs) {
    if (cs == null) return '';
    for (final ChatItem it in cs.items) {
      if (it is UserItem) {
        final String t = it.text.replaceAll('\n', ' ');
        return t.length > 60 ? '${t.substring(0, 60)}…' : t;
      }
    }
    return '';
  }

  Color _dotColor(SessionRuntimeStatus status) {
    switch (status) {
      case SessionRuntimeStatus.idle:
        return Colors.green;
      case SessionRuntimeStatus.running:
      case SessionRuntimeStatus.waitingPermission:
      case SessionRuntimeStatus.waitingPlan:
        return Colors.amber;
      case SessionRuntimeStatus.error:
        return Colors.red;
      case SessionRuntimeStatus.closed:
        return Colors.grey;
    }
  }
}

