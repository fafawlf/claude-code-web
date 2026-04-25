import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../chat/chat_state.dart';
import '../chat/sessions_store.dart';
import '../protocol/protocol.dart';
import 'chat_screen.dart';
import 'connect_controller.dart';
import 'connect_screen.dart';
import 'mode_strip.dart';
import 'permission_sheet.dart';
import 'plan_sheet.dart';
import 'providers.dart';
import 'session_list_screen.dart';
import 'skin_sheet.dart';

class HomeShell extends ConsumerStatefulWidget {
  const HomeShell({super.key});

  @override
  ConsumerState<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends ConsumerState<HomeShell> {
  // Track the last reqId we've already popped a sheet for, per kind, so that a
  // rebuild doesn't re-open a sheet we just dismissed.
  String? _shownPermissionReqId;
  String? _shownPlanReqId;

  // ConnectController is a ChangeNotifier; ref.watch alone won't rebuild us
  // when its internal state transitions (Idle → Progress → Ready). Subscribe
  // explicitly so we flip into the chat UI once it becomes Ready.
  ConnectController? _subscribedCc;

  void _ccChanged() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _subscribedCc?.removeListener(_ccChanged);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ConnectController cc = ref.watch(connectControllerProvider);
    if (!identical(cc, _subscribedCc)) {
      _subscribedCc?.removeListener(_ccChanged);
      _subscribedCc = cc;
      cc.addListener(_ccChanged);
    }
    final ReconnectUiState ui = ref.watch(reconnectUiProvider);
    final AsyncValue<SessionsState> async = ref.watch(sessionsStateProvider);

    // Auto-open the permission / plan sheet whenever the active session has a
    // fresh pending control we haven't shown yet.
    ref.listen<AsyncValue<SessionsState>>(sessionsStateProvider, (prev, next) {
      final SessionsState? s = next.value;
      if (s == null) return;
      final ChatState? active =
          s.activeId != null ? s.byId[s.activeId!] : null;
      if (active == null) return;

      final PendingPermission? perm = active.pendingPermission;
      if (perm != null && perm.reqId != _shownPermissionReqId) {
        _shownPermissionReqId = perm.reqId;
        _showPermissionSheet(perm);
      } else if (perm == null) {
        _shownPermissionReqId = null;
      }

      final PendingPlan? plan = active.pendingPlan;
      if (plan != null && plan.reqId != _shownPlanReqId) {
        _shownPlanReqId = plan.reqId;
        _showPlanSheet(plan);
      } else if (plan == null) {
        _shownPlanReqId = null;
      }
    });

    final bool ready = cc.state is ConnectReady;
    final bool reconnecting = !ready && ui.attempt > 0 && !ui.gaveUp;

    if (!ready && !reconnecting && !ui.gaveUp) {
      // Block the saved-credentials auto-connect if the user just clicked
      // Disconnect — otherwise the ConnectScreen would silently dial the
      // previous host right back, making the Disconnect button useless.
      final bool userDisconnected =
          ref.read(reconnectOrchestratorProvider).userInitiatedDisconnect;
      return ConnectScreen(
        controller: cc,
        suppressAutoConnect: userDisconnected,
      );
    }

    final SessionsState s = async.value ?? const SessionsState();
    final ChatState? active = s.activeId != null ? s.byId[s.activeId!] : null;
    final String title = _titleFor(active);
    final bool busy = active?.busy ?? false;

    return Scaffold(
      appBar: AppBar(
        title: Text(title),
        actions: <Widget>[
          if (busy)
            IconButton(
              onPressed: () => ref.read(sessionsStoreProvider).interrupt(),
              icon: const Icon(Icons.stop_circle_outlined),
              tooltip: 'Interrupt',
            ),
          IconButton(
            tooltip: 'Theme',
            icon: const Icon(Icons.palette_outlined),
            onPressed: _showSkinSheet,
          ),
          PopupMenuButton<String>(
            onSelected: (String v) async {
              switch (v) {
                case 'disconnect':
                  // Route through the orchestrator so _userInitiated is set —
                  // otherwise notifyDisconnected() schedules an auto-reconnect
                  // the moment the socket closes.
                  ref.read(reconnectOrchestratorProvider).userDisconnect();
                case 'new':
                  // Match the web client: no prompt — reuse the current
                  // session's cwd if there is one, otherwise let the server
                  // fall back to its default working directory.
                  ref
                      .read(sessionsStoreProvider)
                      .newSession(active?.state?.cwd);
              }
            },
            itemBuilder: (BuildContext ctx) => const <PopupMenuEntry<String>>[
              PopupMenuItem<String>(
                  value: 'disconnect', child: Text('Disconnect')),
              PopupMenuItem<String>(value: 'new', child: Text('New session')),
            ],
          ),
        ],
      ),
      drawer: const Drawer(child: SessionListScreen()),
      onDrawerChanged: (bool isOpen) {
        if (isOpen) ref.read(sessionsStoreProvider).listSessions();
      },
      backgroundColor: Colors.transparent,
      body: Column(
        children: <Widget>[
          if (reconnecting)
            _pill(
              Theme.of(context).colorScheme.tertiaryContainer,
              'Reconnecting… (attempt ${ui.attempt}/5)',
              null,
            ),
          if (ui.gaveUp)
            _pill(
              Theme.of(context).colorScheme.errorContainer,
              'Reconnect failed',
              TextButton(
                onPressed: () => ref
                    .read(reconnectOrchestratorProvider)
                    .manualReconnect(),
                child: const Text('Retry'),
              ),
            ),
          if (active?.state != null)
            ModeStrip(current: active!.state!.permissionMode),
          const Expanded(child: ChatScreen()),
        ],
      ),
    );
  }

  void _showSkinSheet() {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext ctx) => const SkinSheet(),
    );
  }

  void _showPermissionSheet(PendingPermission pending) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      isDismissible: false,
      enableDrag: false,
      builder: (BuildContext ctx) => PermissionSheet(pending: pending),
    );
  }

  void _showPlanSheet(PendingPlan pending) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      isDismissible: false,
      enableDrag: false,
      builder: (BuildContext ctx) => PlanSheet(pending: pending),
    );
  }

  Widget _pill(Color bg, String text, Widget? trailing) {
    return Container(
      color: bg,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Row(
        children: <Widget>[
          Expanded(child: Text(text, style: const TextStyle(fontSize: 13))),
          if (trailing != null) trailing,
        ],
      ),
    );
  }

  String _titleFor(ChatState? cs) {
    if (cs == null) return 'new session';
    for (final ChatItem it in cs.items) {
      if (it is UserItem) {
        final String t = it.text.replaceAll('\n', ' ');
        return t.length > 30 ? '${t.substring(0, 30)}…' : t;
      }
    }
    return 'new session';
  }
}
