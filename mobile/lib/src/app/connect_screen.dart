import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../profiles/auth_credential.dart';
import '../profiles/connection_profile.dart';
import '../profiles/last_target_store.dart';
import 'connect_controller.dart';

class ConnectScreen extends StatefulWidget {
  const ConnectScreen({
    super.key,
    required this.controller,
    this.suppressAutoConnect = false,
  });

  final ConnectController controller;

  /// When true, skip the saved-credentials auto-connect path in [initState].
  /// Set this after a manual disconnect so the user can edit the connection
  /// settings instead of being bounced back into the previous session.
  final bool suppressAutoConnect;

  @override
  State<ConnectScreen> createState() => _ConnectScreenState();
}

class _ConnectScreenState extends State<ConnectScreen> {
  // WS direct fields (primary mode).
  final TextEditingController _wsHost = TextEditingController(text: '10.0.2.2');
  final TextEditingController _wsPort = TextEditingController(text: '8080');
  final TextEditingController _wsToken = TextEditingController();
  bool _wsSecure = false;

  // SSH tunnel fields (advanced).
  final TextEditingController _sshHost = TextEditingController(text: '10.0.2.2');
  final TextEditingController _sshPort = TextEditingController(text: '22');
  final TextEditingController _sshUser = TextEditingController();
  final TextEditingController _sshPem = TextEditingController();
  final TextEditingController _sshPassphrase = TextEditingController();
  final TextEditingController _sshServerPort = TextEditingController(text: '8080');

  bool _advancedOpen = false;
  bool _showLog = false;

  late final LastTargetStore _lastTargetStore =
      LastTargetStore(widget.controller.kv);

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_onChange);
    _loadAndMaybeAutoConnect();
  }

  Future<void> _loadAndMaybeAutoConnect() async {
    final LastWsTarget? saved = await _lastTargetStore.read();
    if (saved == null || !mounted) return;
    setState(() {
      _wsHost.text = saved.host;
      _wsPort.text = saved.port.toString();
      _wsToken.text = saved.token;
      _wsSecure = saved.secure;
    });
    // Auto-connect if we're still idle (user hasn't already started something)
    // AND this isn't a post-manual-disconnect mount — after a manual
    // disconnect the whole point is to let the user edit settings, so
    // silently dialing the previous host right back would defeat that.
    if (widget.suppressAutoConnect) return;
    if (widget.controller.state is ConnectIdle) {
      widget.controller.connect(WsDirectTarget(
        host: saved.host,
        port: saved.port,
        token: saved.token,
        secure: saved.secure,
      ));
    }
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onChange);
    _wsHost.dispose();
    _wsPort.dispose();
    _wsToken.dispose();
    _sshHost.dispose();
    _sshPort.dispose();
    _sshUser.dispose();
    _sshPem.dispose();
    _sshPassphrase.dispose();
    _sshServerPort.dispose();
    super.dispose();
  }

  void _onChange() {
    if (mounted) setState(() {});
  }

  void _onConnect() {
    final ConnectTarget? target =
        _advancedOpen ? _buildSshTarget() : _buildWsTarget();
    if (target == null) return;
    widget.controller.connect(target);
  }

  ConnectTarget? _buildWsTarget() {
    final String host = _wsHost.text.trim();
    final String token = _wsToken.text.trim();
    final int? port = int.tryParse(_wsPort.text.trim());
    if (host.isEmpty || token.isEmpty || port == null) {
      _showSnack('host, port, and token are required');
      return null;
    }
    // Stash so next launch pre-fills and can auto-connect.
    _lastTargetStore.write(LastWsTarget(
      host: host,
      port: port,
      token: token,
      secure: _wsSecure,
    ));
    return WsDirectTarget(
      host: host,
      port: port,
      token: token,
      secure: _wsSecure,
    );
  }

  ConnectTarget? _buildSshTarget() {
    final String host = _sshHost.text.trim();
    final String user = _sshUser.text.trim();
    final String pem = _sshPem.text;
    if (host.isEmpty || user.isEmpty || pem.trim().isEmpty) {
      _showSnack('host, user, and private key are required');
      return null;
    }
    final int sshPort = int.tryParse(_sshPort.text.trim()) ?? 22;
    final int serverPort = int.tryParse(_sshServerPort.text.trim()) ?? 8080;
    final String? pass =
        _sshPassphrase.text.isEmpty ? null : _sshPassphrase.text;

    return SshTunnelTarget(
      profile: ConnectionProfile(
        id: 'scratch',
        label: 'scratch',
        host: host,
        sshPort: sshPort,
        username: user,
        credential:
            PrivateKeyCredential(privateKeyPem: pem, passphrase: pass),
        serverPort: serverPort,
        serverStartCommand: 'node server/dist/bin/claudecode-web.js',
      ),
    );
  }

  void _showSnack(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  @override
  Widget build(BuildContext context) {
    final ConnectState state = widget.controller.state;
    final bool busy = state is ConnectProgress;

    return Scaffold(
      backgroundColor: Colors.transparent,
      appBar: AppBar(
        title: const Text('claudecode-web'),
        actions: <Widget>[
          IconButton(
            icon: const Icon(Icons.delete_outline),
            tooltip: 'Forget saved token',
            onPressed: () async {
              await _lastTargetStore.clear();
              if (!context.mounted) return;
              _showSnack('Saved token cleared');
            },
          ),
          IconButton(
            icon: Icon(_showLog ? Icons.article : Icons.article_outlined),
            tooltip: 'Toggle log',
            onPressed: () => setState(() => _showLog = !_showLog),
          ),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Expanded(child: _buildBody(state, busy)),
              const SizedBox(height: 12),
              _buildPrimaryButton(state, busy),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildBody(ConnectState state, bool busy) {
    if (state is ConnectReady) return _buildReady(state);
    return ListView(
      children: <Widget>[
        _statusBanner(state),
        const SizedBox(height: 8),
        _wsSection(busy),
        const SizedBox(height: 12),
        _advancedSshSection(busy),
        if (_showLog) ...<Widget>[
          const SizedBox(height: 12),
          _logBox(),
        ],
      ],
    );
  }

  Widget _wsSection(bool busy) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        const Text('Direct WebSocket',
            style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
        const SizedBox(height: 4),
        Text(
          'Server must be reachable at this host and port. Typical when the '
          'server was launched with `--host 0.0.0.0` and you are on a trusted '
          'network, or running the server on this device.',
          style: TextStyle(
              fontSize: 12,
              color: Theme.of(context)
                  .colorScheme
                  .onSurface
                  .withValues(alpha: 0.6)),
        ),
        const SizedBox(height: 8),
        Row(
          children: <Widget>[
            Expanded(
              flex: 3,
              child: TextField(
                controller: _wsHost,
                decoration: const InputDecoration(
                  labelText: 'Host (emulator: 10.0.2.2 = Mac)',
                  border: OutlineInputBorder(),
                ),
                enabled: !busy,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: TextField(
                controller: _wsPort,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'Port',
                  border: OutlineInputBorder(),
                ),
                enabled: !busy,
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _wsToken,
          decoration: const InputDecoration(
            labelText: 'Token',
            hintText: 'the `t=...` value from the server banner',
            border: OutlineInputBorder(),
          ),
          enabled: !busy,
          style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
        ),
        const SizedBox(height: 8),
        SwitchListTile(
          dense: true,
          contentPadding: EdgeInsets.zero,
          value: _wsSecure,
          onChanged: busy ? null : (bool v) => setState(() => _wsSecure = v),
          title: const Text('Use wss:// (TLS)'),
          subtitle: const Text(
              'Only enable if the server is behind a TLS-terminating proxy.'),
        ),
      ],
    );
  }

  Widget _advancedSshSection(bool busy) {
    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          initiallyExpanded: _advancedOpen,
          onExpansionChanged: (bool v) => setState(() => _advancedOpen = v),
          tilePadding: const EdgeInsets.symmetric(horizontal: 12),
          childrenPadding:
              const EdgeInsets.fromLTRB(12, 0, 12, 12),
          title: const Text(
            'Advanced — connect via SSH tunnel',
            style: TextStyle(fontWeight: FontWeight.bold),
          ),
          subtitle: const Text(
            'Use when the server stays bound to 127.0.0.1 and you only have SSH access.',
            style: TextStyle(fontSize: 12),
          ),
          children: <Widget>[
            if (_advancedOpen) _sshFields(busy),
          ],
        ),
      ),
    );
  }

  Widget _sshFields(bool busy) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Text(
          'dartssh2 dials the host, fetches the token by running a command '
          'remotely, opens a loopback port on this device, and connects the '
          'WebSocket through that port. First-time host key will prompt for '
          'TOFU confirmation.',
          style: TextStyle(
              fontSize: 12,
              color: Theme.of(context)
                  .colorScheme
                  .onSurface
                  .withValues(alpha: 0.6)),
        ),
        const SizedBox(height: 8),
        Row(
          children: <Widget>[
            Expanded(
              flex: 3,
              child: TextField(
                controller: _sshHost,
                decoration: const InputDecoration(
                  labelText: 'SSH host',
                  border: OutlineInputBorder(),
                ),
                enabled: !busy,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: TextField(
                controller: _sshPort,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'SSH port',
                  border: OutlineInputBorder(),
                ),
                enabled: !busy,
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: <Widget>[
            Expanded(
              flex: 2,
              child: TextField(
                controller: _sshUser,
                decoration: const InputDecoration(
                  labelText: 'SSH user',
                  border: OutlineInputBorder(),
                ),
                enabled: !busy,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: TextField(
                controller: _sshServerPort,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'Server port',
                  border: OutlineInputBorder(),
                ),
                enabled: !busy,
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _sshPem,
          minLines: 5,
          maxLines: 10,
          decoration: const InputDecoration(
            labelText: 'Private key PEM',
            hintText:
                '-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----',
            border: OutlineInputBorder(),
          ),
          enabled: !busy,
          style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _sshPassphrase,
          obscureText: true,
          decoration: const InputDecoration(
            labelText: 'Key passphrase (optional)',
            border: OutlineInputBorder(),
          ),
          enabled: !busy,
        ),
      ],
    );
  }

  Widget _statusBanner(ConnectState state) {
    final ThemeData t = Theme.of(context);
    final Color bannerText = t.colorScheme.onSurface;
    switch (state) {
      case ConnectIdle():
        return const SizedBox.shrink();
      case ConnectProgress(:final String step):
        return _banner(
          Color.alphaBlend(
              t.colorScheme.primary.withValues(alpha: 0.14),
              t.colorScheme.surface),
          Icons.sync,
          step,
          bannerText,
          iconColor: t.colorScheme.primary,
        );
      case ConnectFailed(:final String message, :final String? detail):
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            _banner(
              Color.alphaBlend(
                  t.colorScheme.error.withValues(alpha: 0.16),
                  t.colorScheme.surface),
              Icons.error_outline,
              message,
              bannerText,
              iconColor: t.colorScheme.error,
            ),
            if (detail != null) ...<Widget>[
              const SizedBox(height: 4),
              Text(detail,
                  style: TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 11,
                      color: t.colorScheme.onSurface.withValues(alpha: 0.55))),
            ],
          ],
        );
      case ConnectReady():
        return const SizedBox.shrink();
    }
  }

  Widget _buildReady(ConnectReady state) {
    final Map<String, String> rows = <String, String>{
      'Session': state.snapshot.sessionId,
      'CWD': state.snapshot.cwd,
      'Runtime': state.snapshot.runtimeStatus.toString(),
      'Permission mode': state.snapshot.permissionMode.toString(),
      'Attached': state.snapshot.attachedCount.toString(),
      'Last event id': state.snapshot.lastEventId.toString(),
      'Tokens in/out':
          '${state.snapshot.tokensIn} / ${state.snapshot.tokensOut}',
      'Endpoint': state.endpoint,
    };
    final ThemeData t = Theme.of(context);
    return ListView(
      children: <Widget>[
        _banner(
          Color.alphaBlend(
              t.colorScheme.primary.withValues(alpha: 0.14),
              t.colorScheme.surface),
          Icons.check_circle_outline,
          'Connected. ServerReady received.',
          t.colorScheme.onSurface,
          iconColor: t.colorScheme.primary,
        ),
        const SizedBox(height: 12),
        Container(
          margin: const EdgeInsets.only(top: 4),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: t.colorScheme.surface,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: t.colorScheme.outlineVariant),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              for (final MapEntry<String, String> e in rows.entries)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      SizedBox(
                        width: 130,
                        child: Text(
                          e.key,
                          style: TextStyle(
                              fontWeight: FontWeight.w600,
                              color: t.colorScheme.onSurface
                                  .withValues(alpha: 0.75)),
                        ),
                      ),
                      Expanded(
                        child: SelectableText(
                          e.value,
                          style: const TextStyle(fontFamily: 'monospace'),
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
        if (_showLog) ...<Widget>[
          const SizedBox(height: 12),
          _logBox(),
        ],
      ],
    );
  }

  Widget _buildPrimaryButton(ConnectState state, bool busy) {
    if (state is ConnectReady) {
      return FilledButton.icon(
        onPressed: () => widget.controller.disconnect(),
        icon: const Icon(Icons.logout),
        label: const Text('Disconnect'),
      );
    }
    return FilledButton.icon(
      onPressed: busy ? null : _onConnect,
      icon: busy
          ? const SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(strokeWidth: 2))
          : const Icon(Icons.link),
      label: Text(busy
          ? 'Connecting…'
          : _advancedOpen
              ? 'Connect via SSH tunnel'
              : 'Connect'),
    );
  }

  Widget _banner(Color bg, IconData icon, String text, Color fg,
      {Color? iconColor}) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: <Widget>[
          Icon(icon, size: 18, color: iconColor ?? fg),
          const SizedBox(width: 8),
          Expanded(child: Text(text, style: TextStyle(color: fg))),
        ],
      ),
    );
  }

  Widget _logBox() {
    final ThemeData t = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        const Text('Log', style: TextStyle(fontWeight: FontWeight.bold)),
        const SizedBox(height: 4),
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: t.colorScheme.surface,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: t.colorScheme.outlineVariant),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: widget.controller.log
                .map((String s) => Text(s,
                    style: TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 11,
                        color: t.colorScheme.onSurface
                            .withValues(alpha: 0.75))))
                .toList(growable: false),
          ),
        ),
      ],
    );
  }
}

Future<bool> showTofuDialog(
  BuildContext context, {
  required String keyType,
  required Uint8List fingerprint,
}) async {
  final String hex = fingerprint
      .map((int b) => b.toRadixString(16).padLeft(2, '0'))
      .join(':');
  final bool? trusted = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (BuildContext ctx) => AlertDialog(
      title: const Text('First-time host key'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text(
              'This server has not been seen before. Verify the fingerprint matches what the server operator told you. If it does not match, cancel.'),
          const SizedBox(height: 12),
          Text('Key type: $keyType',
              style: const TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          SelectableText(hex,
              style: const TextStyle(fontFamily: 'monospace', fontSize: 12)),
        ],
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(ctx).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(ctx).pop(true),
          child: const Text('Trust'),
        ),
      ],
    ),
  );
  return trusted ?? false;
}
