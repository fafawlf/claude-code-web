import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'src/app/connect_controller.dart';
import 'src/app/connect_screen.dart' show showTofuDialog;
import 'src/app/home_shell.dart';
import 'src/app/providers.dart';
import 'src/app/skin_backdrop.dart';
import 'src/profiles/profile_store.dart';
import 'src/theme/skin_palette.dart';
import 'src/theme/theme_builder.dart';

void main() {
  runApp(const ClaudeCodeApp());
}

class ClaudeCodeApp extends StatefulWidget {
  const ClaudeCodeApp({super.key});

  @override
  State<ClaudeCodeApp> createState() => _ClaudeCodeAppState();
}

class _ClaudeCodeAppState extends State<ClaudeCodeApp> {
  final GlobalKey<NavigatorState> _navKey = GlobalKey<NavigatorState>();
  late final ConnectController _controller;

  @override
  void initState() {
    super.initState();
    _controller = ConnectController(
      kv: FlutterSecureKvAdapter(),
      confirmer: (String keyType, fingerprint) async {
        final NavigatorState? nav = _navKey.currentState;
        if (nav == null) return false;
        return showTofuDialog(
          nav.context,
          keyType: keyType,
          fingerprint: fingerprint,
        );
      },
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ProviderScope(
      overrides: [
        connectControllerProvider.overrideWithValue(_controller),
      ],
      child: _ThemedRoot(navKey: _navKey),
    );
  }
}

class _ThemedRoot extends ConsumerWidget {
  const _ThemedRoot({required this.navKey});
  final GlobalKey<NavigatorState> navKey;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final SkinPalette palette = ref.watch(palettePrvider);
    final ThemeData theme = themeFromPalette(palette);
    return MaterialApp(
      title: 'claudecode-web',
      navigatorKey: navKey,
      theme: theme,
      darkTheme: theme,
      themeMode: ThemeMode.system,
      builder: (BuildContext ctx, Widget? child) {
        return SkinBackdrop(
          palette: palette,
          child: child ?? const SizedBox.shrink(),
        );
      },
      home: const HomeShell(),
    );
  }
}
