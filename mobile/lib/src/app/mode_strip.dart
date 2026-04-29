import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../protocol/protocol.dart';
import 'providers.dart';

/// Compact row of segmented buttons letting the user swap the session's
/// permission mode. Mirrors the web PermissionModeStrip.
class ModeStrip extends ConsumerWidget {
  const ModeStrip({super.key, required this.current});
  final PermissionMode current;

  static const List<_ModeSpec> _modes = <_ModeSpec>[
    _ModeSpec(PermissionMode.default_, 'Default'),
    _ModeSpec(PermissionMode.acceptEdits, 'Auto-edit'),
    _ModeSpec(PermissionMode.plan, 'Plan'),
    _ModeSpec(PermissionMode.bypassPermissions, 'Bypass'),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return SizedBox(
      height: 32,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: _modes.length,
        separatorBuilder: (_, __) => const SizedBox(width: 6),
        padding: const EdgeInsets.symmetric(horizontal: 8),
        itemBuilder: (BuildContext ctx, int i) {
          final _ModeSpec m = _modes[i];
          final bool active = m.mode == current;
          return ChoiceChip(
            label: Text(m.label, style: const TextStyle(fontSize: 12)),
            selected: active,
            visualDensity: VisualDensity.compact,
            onSelected: (_) {
              if (!active) {
                ref.read(sessionsStoreProvider).setMode(m.mode);
              }
            },
          );
        },
      ),
    );
  }
}

class _ModeSpec {
  const _ModeSpec(this.mode, this.label);
  final PermissionMode mode;
  final String label;
}
