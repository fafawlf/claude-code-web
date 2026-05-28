import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../protocol/protocol.dart';
import 'providers.dart';

/// Bottom sheet that asks the user whether Claude may run a tool the server
/// flagged as requiring permission. Mirrors the web PermissionModal.
class PermissionSheet extends ConsumerWidget {
  const PermissionSheet({super.key, required this.pending});
  final PendingPermission pending;

  static const Set<String> _editTools = <String>{
    'Edit',
    'Write',
    'MultiEdit',
    'NotebookEdit',
  };

  bool get _isEdit => _editTools.contains(pending.toolName);

  String get _primaryArg {
    final Map<String, dynamic> i = pending.input;
    switch (pending.toolName) {
      case 'Bash':
        return (i['command'] ?? '').toString();
      case 'Read':
      case 'Edit':
      case 'Write':
      case 'MultiEdit':
      case 'NotebookEdit':
        return (i['file_path'] ?? i['notebook_path'] ?? '').toString();
      case 'Grep':
        return (i['pattern'] ?? '').toString();
      case 'Glob':
        return (i['pattern'] ?? '').toString();
      case 'WebFetch':
        return (i['url'] ?? '').toString();
      case 'WebSearch':
        return (i['query'] ?? '').toString();
    }
    return '';
  }

  void _send(BuildContext context, WidgetRef ref, PermissionDecision d,
      PermissionScope? s) {
    ref.read(sessionsStoreProvider).respondPermission(
          reqId: pending.reqId,
          decision: d,
          scope: s,
        );
    Navigator.of(context).maybePop();
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final String title = pending.title ??
        pending.displayName ??
        'Allow ${pending.toolName}?';
    final String arg = _primaryArg;
    final String inputJson =
        const JsonEncoder.withIndent('  ').convert(pending.input);

    return SafeArea(
      top: false,
      child: Padding(
        padding: EdgeInsets.fromLTRB(
            16, 16, 16, 16 + MediaQuery.of(context).viewInsets.bottom),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Row(
              children: <Widget>[
                Icon(Icons.lock_outline,
                    color: Theme.of(context).colorScheme.primary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(title,
                      style: const TextStyle(
                          fontSize: 16, fontWeight: FontWeight.w600)),
                ),
              ],
            ),
            if (pending.description != null && pending.description!.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(pending.description!,
                  style: const TextStyle(fontSize: 13, color: Colors.black54)),
            ],
            if (arg.isNotEmpty) ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: Colors.black.withValues(alpha: 0.05),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(arg,
                    maxLines: 6,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontFamily: 'monospace', fontSize: 13)),
              ),
            ],
            const SizedBox(height: 8),
            ExpansionTile(
              tilePadding: EdgeInsets.zero,
              childrenPadding: const EdgeInsets.only(bottom: 8),
              title: const Text('Full input',
                  style: TextStyle(fontSize: 12, color: Colors.black54)),
              children: <Widget>[
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.05),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: SelectableText(
                    inputJson,
                    style: const TextStyle(
                        fontFamily: 'monospace', fontSize: 12),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: <Widget>[
                Expanded(
                  child: OutlinedButton(
                    onPressed: () =>
                        _send(context, ref, PermissionDecision.deny, null),
                    child: const Text('Deny'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => _send(context, ref,
                        PermissionDecision.allow, PermissionScope.once),
                    child: const Text('Allow once'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => _send(context, ref, PermissionDecision.allow,
                  PermissionScope.session),
              child: Text(_isEdit
                  ? 'Allow all edits this session'
                  : 'Allow for this session'),
            ),
          ],
        ),
      ),
    );
  }
}
