import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../chat/assistant_text.dart';
import '../chat/chat_state.dart';
import '../chat/sessions_store.dart';
import '../protocol/protocol.dart';
import '../theme/skin_palette.dart';
import 'connect_controller.dart';
import 'providers.dart';

class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key});

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final TextEditingController _input = TextEditingController();
  final ScrollController _scroll = ScrollController();
  final FocusNode _focus = FocusNode();

  // In-memory ring of last sent prompts for ↑/↓ recall. -1 means "not cycling".
  final List<String> _history = <String>[];
  int _historyIndex = -1;
  static const int _historyCap = 50;

  // ChatGPT-style scroll behavior: when the user sends a message, snap it to
  // the TOP of the viewport so the answer streams in below it. We track the
  // session whose last-seen messages count we've already settled on, so that
  // switching sessions / first-render can still jump to bottom for context.
  String? _lastActiveId;
  int _lastItemCountForSession = 0;

  // Set fresh on each send; attached to the newly-appended user item via
  // KeyedSubtree. Cleared once we've pinned it to the top.
  GlobalKey? _pinKey;

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _send() {
    final String text = _input.text.trim();
    if (text.isEmpty) return;
    // Arm the pin BEFORE dispatching so the next rebuild (triggered by the
    // store's optimistic UserItem append) attaches the key to the new item.
    _pinKey = GlobalKey();
    ref.read(sessionsStoreProvider).sendUser(text);
    _history.add(text);
    if (_history.length > _historyCap) {
      _history.removeAt(0);
    }
    _historyIndex = -1;
    _input.clear();
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent ev) {
    if (ev is! KeyDownEvent) return KeyEventResult.ignored;
    // Only intercept arrows when the field is empty or we're already cycling,
    // so normal editing isn't disturbed.
    final bool cycling = _historyIndex >= 0;
    final bool empty = _input.text.isEmpty;
    if (ev.logicalKey == LogicalKeyboardKey.arrowUp && (empty || cycling)) {
      if (_history.isEmpty) return KeyEventResult.handled;
      final int next = _historyIndex < 0
          ? _history.length - 1
          : (_historyIndex - 1).clamp(0, _history.length - 1);
      setState(() => _historyIndex = next);
      _input.text = _history[next];
      _input.selection =
          TextSelection.collapsed(offset: _input.text.length);
      return KeyEventResult.handled;
    }
    if (ev.logicalKey == LogicalKeyboardKey.arrowDown && cycling) {
      final int next = _historyIndex + 1;
      if (next >= _history.length) {
        setState(() => _historyIndex = -1);
        _input.clear();
      } else {
        setState(() => _historyIndex = next);
        _input.text = _history[next];
        _input.selection =
            TextSelection.collapsed(offset: _input.text.length);
      }
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<SessionsState> async = ref.watch(sessionsStateProvider);
    final ConnectController cc = ref.watch(connectControllerProvider);
    final bool connected = cc.state is ConnectReady;
    final SkinPalette palette = ref.watch(palettePrvider);
    final ThemeData t = Theme.of(context);

    final SessionsState s = async.value ?? const SessionsState();
    final ChatState? active = s.activeId != null ? s.byId[s.activeId!] : null;
    final List<ChatItem> items = active?.items ?? const <ChatItem>[];
    final String streaming = active?.streamingText ?? '';
    final bool busy = active?.busy ?? false;

    // On session switch (or first attach) we want to land at the bottom so the
    // user sees the latest context. After that, we stop auto-following stream
    // deltas — the pin-to-top on send (below) takes over.
    final bool sessionChanged = s.activeId != _lastActiveId;
    if (sessionChanged) {
      _lastActiveId = s.activeId;
      _lastItemCountForSession = items.length;
      _scheduleJumpToBottom();
    } else if (items.length != _lastItemCountForSession) {
      _lastItemCountForSession = items.length;
      if (_pinKey != null) {
        _schedulePinToTop();
      }
    }

    final bool empty = items.isEmpty && streaming.isEmpty;
    // Bottom padding lets the newly-sent user message actually reach the top
    // of the viewport via ensureVisible even when nothing's rendered below it
    // yet. Sized to roughly one viewport's worth so the pin always has room.
    final double bottomSpacer = MediaQuery.of(context).size.height * 0.6;

    // Show a "Processing…" row when the server is working but hasn't produced
    // streaming text yet (e.g. running a tool or thinking silently).
    final bool showProcessing = busy && streaming.isEmpty;
    final int ghostCount = streaming.isNotEmpty ? 1 : 0;
    final int processingCount = showProcessing ? 1 : 0;
    final int totalCount =
        items.length + ghostCount + processingCount + 1;

    return Column(
      children: <Widget>[
        Expanded(
          child: empty
              ? _emptyState(palette, t)
              : ListView.builder(
                  controller: _scroll,
                  padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
                  itemCount: totalCount,
                  itemBuilder: (BuildContext context, int idx) {
                    if (idx < items.length) {
                      final ChatItem item = items[idx];
                      final bool isLastItem = idx == items.length - 1;
                      final bool showTokens = isLastItem &&
                          item is AssistantTextItem &&
                          !busy &&
                          active?.state != null;
                      Widget w = _itemWidget(item, palette, t);
                      if (showTokens) {
                        w = Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            w,
                            _tokenStatsRow(active!.state!, palette),
                          ],
                        );
                      }
                      if (isLastItem &&
                          _pinKey != null &&
                          item is UserItem) {
                        return KeyedSubtree(key: _pinKey, child: w);
                      }
                      return w;
                    }
                    int tail = idx - items.length;
                    if (tail == 0 && ghostCount == 1) {
                      return _ghost(streaming, palette, t);
                    }
                    tail -= ghostCount;
                    if (tail == 0 && processingCount == 1) {
                      return _processingRow(palette);
                    }
                    return SizedBox(height: bottomSpacer);
                  },
                ),
        ),
        _composer(palette, t, connected, busy),
      ],
    );
  }

  Widget _userStatusLine(bool optimistic, SkinPalette p) {
    if (optimistic) {
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          SizedBox(
            width: 9,
            height: 9,
            child: CircularProgressIndicator(
              strokeWidth: 1.2,
              valueColor: AlwaysStoppedAnimation<Color>(p.textMuted),
            ),
          ),
          const SizedBox(width: 6),
          Text(
            'Sending…',
            style: TextStyle(color: p.textMuted, fontSize: 11),
          ),
        ],
      );
    }
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Icon(Icons.check, size: 11, color: p.textMuted),
        const SizedBox(width: 4),
        Text(
          'Sent',
          style: TextStyle(color: p.textMuted, fontSize: 11),
        ),
      ],
    );
  }

  Widget _tokenStatsRow(SessionStateSnapshot s, SkinPalette p) {
    final TextStyle style = TextStyle(fontSize: 11, color: p.textMuted);
    return Padding(
      padding: const EdgeInsets.only(left: 42, top: 4, bottom: 2),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(Icons.arrow_downward, size: 11, color: p.textMuted),
          const SizedBox(width: 2),
          Text(_formatTokens(s.tokensIn), style: style),
          const SizedBox(width: 8),
          Icon(Icons.arrow_upward, size: 11, color: p.textMuted),
          const SizedBox(width: 2),
          Text(_formatTokens(s.tokensOut), style: style),
        ],
      ),
    );
  }

  static String _formatTokens(int n) {
    if (n < 1000) return '$n';
    if (n < 1000000) return '${(n / 1000).toStringAsFixed(1)}k';
    return '${(n / 1000000).toStringAsFixed(1)}M';
  }

  Widget _processingRow(SkinPalette p) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 42),
      child: Row(
        children: <Widget>[
          SizedBox(
            width: 12,
            height: 12,
            child: CircularProgressIndicator(
              strokeWidth: 1.5,
              valueColor: AlwaysStoppedAnimation<Color>(p.accent),
            ),
          ),
          const SizedBox(width: 8),
          Text(
            'Processing…',
            style: TextStyle(color: p.textMuted, fontSize: 12.5),
          ),
        ],
      ),
    );
  }

  void _scheduleJumpToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.jumpTo(_scroll.position.maxScrollExtent);
    });
  }

  void _schedulePinToTop() {
    final GlobalKey? key = _pinKey;
    if (key == null) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final BuildContext? ctx = key.currentContext;
      if (ctx == null) return;
      Scrollable.ensureVisible(
        ctx,
        alignment: 0.0,
        duration: const Duration(milliseconds: 260),
        curve: Curves.easeOutCubic,
      );
      if (identical(_pinKey, key)) _pinKey = null;
    });
  }

  Widget _emptyState(SkinPalette p, ThemeData t) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                color: p.bgAccentSoft,
                shape: BoxShape.circle,
              ),
              child: Icon(Icons.auto_awesome, color: p.accent, size: 28),
            ),
            const SizedBox(height: 16),
            Text('Ready when you are',
                style: t.textTheme.titleMedium
                    ?.copyWith(fontWeight: FontWeight.w600)),
            const SizedBox(height: 6),
            Text(
              'Type a prompt below to start the conversation.',
              textAlign: TextAlign.center,
              style: t.textTheme.bodySmall?.copyWith(color: p.textMuted),
            ),
          ],
        ),
      ),
    );
  }

  Widget _composer(SkinPalette p, ThemeData t, bool connected, bool busy) {
    return Container(
      decoration: BoxDecoration(
        color: p.bgRaised,
        border: Border(top: BorderSide(color: p.borderSubtle)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: <Widget>[
              Expanded(
                child: Focus(
                  focusNode: _focus,
                  onKeyEvent: _onKey,
                  child: TextField(
                    controller: _input,
                    minLines: 1,
                    maxLines: 8,
                    keyboardType: TextInputType.multiline,
                    decoration: InputDecoration(
                      hintText: 'Message Claude…',
                      filled: true,
                      fillColor: p.bgSurface,
                      contentPadding: const EdgeInsets.symmetric(
                          horizontal: 14, vertical: 12),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide: BorderSide(color: p.borderSubtle),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide: BorderSide(color: p.accent, width: 1.6),
                      ),
                      disabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide: BorderSide(
                            color: p.borderSubtle.withValues(alpha: 0.5)),
                      ),
                    ),
                    enabled: connected,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              if (busy)
                Material(
                  color: p.danger.withValues(alpha: 0.12),
                  shape: const CircleBorder(),
                  child: InkWell(
                    customBorder: const CircleBorder(),
                    onTap: () =>
                        ref.read(sessionsStoreProvider).interrupt(),
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Icon(Icons.stop_rounded,
                          color: p.danger, size: 20),
                    ),
                  ),
                )
              else
                Material(
                  color: connected ? p.accent : p.borderSubtle,
                  shape: const CircleBorder(),
                  child: InkWell(
                    customBorder: const CircleBorder(),
                    onTap: connected ? _send : null,
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Icon(Icons.arrow_upward_rounded,
                          color:
                              connected ? p.textInverse : p.textMuted,
                          size: 20),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _ghost(String streaming, SkinPalette p, ThemeData t) {
    final String cleaned = cleanStreamingAssistantText(streaming);
    if (cleaned.isEmpty) return const SizedBox.shrink();
    return _assistantBubble(cleaned, p, t, streaming: true);
  }

  Widget _assistantBubble(String text, SkinPalette p, ThemeData t,
      {bool streaming = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          _avatar(p, assistant: true),
          const SizedBox(width: 10),
          Expanded(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: p.bgSurface,
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(4),
                  topRight: Radius.circular(14),
                  bottomLeft: Radius.circular(14),
                  bottomRight: Radius.circular(14),
                ),
                border: Border.all(color: p.borderSubtle),
              ),
              child: Opacity(
                opacity: streaming ? 0.75 : 1.0,
                child: MarkdownBody(
                  data: text,
                  selectable: true,
                  styleSheet: _markdownStyle(p, t),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _itemWidget(ChatItem item, SkinPalette p, ThemeData t) {
    switch (item) {
      case UserItem(:final String text, :final bool optimistic):
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: <Widget>[
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.end,
                children: <Widget>[
                  Flexible(
                    child: Opacity(
                      opacity: optimistic ? 0.6 : 1.0,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 14, vertical: 10),
                        decoration: BoxDecoration(
                          color: p.accent,
                          borderRadius: const BorderRadius.only(
                            topLeft: Radius.circular(14),
                            topRight: Radius.circular(4),
                            bottomLeft: Radius.circular(14),
                            bottomRight: Radius.circular(14),
                          ),
                        ),
                        child: Text(
                          text,
                          style: TextStyle(
                            color: p.textInverse,
                            fontSize: 14,
                            height: 1.4,
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  _avatar(p, assistant: false),
                ],
              ),
              Padding(
                padding: const EdgeInsets.only(right: 42, top: 2),
                child: _userStatusLine(optimistic, p),
              ),
            ],
          ),
        );
      case AssistantTextItem(:final String text):
        return _assistantBubble(text, p, t);
      case ThinkingItem(:final String text):
        return _ThinkingBlock(text: text, palette: p);
      case ToolUseItem(:final String name, :final ToolResult? result):
        final String status = result == null
            ? 'running'
            : (result.isError ? 'error' : 'done');
        final Color statusColor = result == null
            ? p.warning
            : (result.isError ? p.danger : p.success);
        final IconData icon = result == null
            ? Icons.sync
            : (result.isError ? Icons.error_outline : Icons.check_circle_outline);
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 42),
          child: Container(
            padding:
                const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: p.bgRaised,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: p.borderSubtle),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Icon(icon, size: 14, color: statusColor),
                const SizedBox(width: 6),
                Flexible(
                  child: Text(
                    name,
                    style: TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 12,
                      color: p.textSecondary,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                const SizedBox(width: 6),
                Text(
                  '· $status',
                  style: TextStyle(
                    fontSize: 11,
                    color: statusColor,
                  ),
                ),
              ],
            ),
          ),
        );
      case SystemItem(:final String text, :final SystemLevel level):
        final bool err = level == SystemLevel.error;
        final Color bg = err
            ? p.danger.withValues(alpha: 0.14)
            : p.bgRaised;
        final Color fg = err ? p.danger : p.textMuted;
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 42),
          child: Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: bg,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                  color: err
                      ? p.danger.withValues(alpha: 0.3)
                      : p.borderSubtle),
            ),
            child: Text(text, style: TextStyle(fontSize: 12, color: fg)),
          ),
        );
    }
  }

  Widget _avatar(SkinPalette p, {required bool assistant}) {
    return Container(
      width: 32,
      height: 32,
      decoration: BoxDecoration(
        color: assistant ? p.bgAccentSoft : p.bgHover,
        shape: BoxShape.circle,
        border: Border.all(color: p.borderSubtle),
      ),
      alignment: Alignment.center,
      child: Icon(
        assistant ? Icons.auto_awesome : Icons.person_outline,
        size: 16,
        color: assistant ? p.accent : p.textSecondary,
      ),
    );
  }

  MarkdownStyleSheet _markdownStyle(SkinPalette p, ThemeData t) {
    return MarkdownStyleSheet.fromTheme(t).copyWith(
      p: TextStyle(color: p.textPrimary, fontSize: 14, height: 1.5),
      code: TextStyle(
        backgroundColor: p.bgHover,
        color: p.accent,
        fontFamily: 'monospace',
        fontSize: 13,
      ),
      codeblockDecoration: BoxDecoration(
        color: p.bgBase,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: p.borderSubtle),
      ),
      codeblockPadding: const EdgeInsets.all(10),
      blockquote: TextStyle(color: p.textSecondary),
      blockquoteDecoration: BoxDecoration(
        border: Border(left: BorderSide(color: p.accent, width: 3)),
      ),
      h1: TextStyle(
          color: p.textPrimary, fontWeight: FontWeight.w700, fontSize: 22),
      h2: TextStyle(
          color: p.textPrimary, fontWeight: FontWeight.w700, fontSize: 19),
      h3: TextStyle(
          color: p.textPrimary, fontWeight: FontWeight.w600, fontSize: 16),
      a: TextStyle(color: p.accentHi, decoration: TextDecoration.underline),
      listBullet: TextStyle(color: p.textSecondary),
    );
  }
}

/// Collapsible "thinking" block — collapsed by default to match web's
/// <details> behavior. Tap the header to expand and read the reasoning.
class _ThinkingBlock extends StatefulWidget {
  const _ThinkingBlock({required this.text, required this.palette});

  final String text;
  final SkinPalette palette;

  @override
  State<_ThinkingBlock> createState() => _ThinkingBlockState();
}

class _ThinkingBlockState extends State<_ThinkingBlock> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final SkinPalette p = widget.palette;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 42),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          InkWell(
            onTap: () => setState(() => _expanded = !_expanded),
            borderRadius: BorderRadius.circular(4),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                children: <Widget>[
                  Icon(Icons.auto_awesome_outlined, size: 14, color: p.textMuted),
                  const SizedBox(width: 6),
                  Text(
                    'Thought',
                    style: TextStyle(
                      color: p.textMuted,
                      fontSize: 12.5,
                      fontStyle: FontStyle.italic,
                    ),
                  ),
                  const SizedBox(width: 4),
                  Icon(
                    _expanded ? Icons.expand_less : Icons.expand_more,
                    size: 14,
                    color: p.textMuted,
                  ),
                ],
              ),
            ),
          ),
          if (_expanded)
            Padding(
              padding: const EdgeInsets.only(top: 4, left: 20),
              child: Text(
                widget.text,
                style: TextStyle(
                  fontStyle: FontStyle.italic,
                  color: p.textMuted,
                  fontSize: 12.5,
                ),
              ),
            ),
        ],
      ),
    );
  }
}
