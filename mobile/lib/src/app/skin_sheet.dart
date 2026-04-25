import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../theme/skin_palette.dart';
import 'providers.dart';

/// Bottom-sheet skin picker. Mirrors the web SkinMenu: a grid of swatch
/// previews with labels, radio-selected by the active skin.
class SkinSheet extends ConsumerWidget {
  const SkinSheet({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final SkinPalette active = ref.watch(palettePrvider);
    final SkinNotifier notifier = ref.read(skinProvider.notifier);

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Row(
              children: <Widget>[
                Icon(Icons.palette_outlined, color: active.accent),
                const SizedBox(width: 8),
                const Expanded(
                  child: Text('Theme',
                      style: TextStyle(
                          fontSize: 16, fontWeight: FontWeight.w600)),
                ),
              ],
            ),
            const SizedBox(height: 12),
            ...SkinId.values.map((SkinId id) {
              final SkinPalette p = paletteFor(id);
              final bool selected = id == active.id;
              return Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: _SkinRow(
                  palette: p,
                  selected: selected,
                  onTap: () {
                    notifier.set(id);
                    Navigator.of(context).maybePop();
                  },
                ),
              );
            }),
          ],
        ),
      ),
    );
  }
}

class _SkinRow extends StatelessWidget {
  const _SkinRow({
    required this.palette,
    required this.selected,
    required this.onTap,
  });

  final SkinPalette palette;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final ThemeData t = Theme.of(context);
    return Material(
      color: selected ? t.colorScheme.surfaceContainerHighest : t.colorScheme.surface,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: selected
                  ? t.colorScheme.primary
                  : t.colorScheme.outlineVariant,
              width: selected ? 1.6 : 1,
            ),
          ),
          child: Row(
            children: <Widget>[
              _SwatchStack(colors: palette.swatches),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(palette.label,
                        style: t.textTheme.titleSmall
                            ?.copyWith(fontWeight: FontWeight.w600)),
                    const SizedBox(height: 2),
                    Text(
                      palette.hint,
                      style: t.textTheme.bodySmall?.copyWith(
                          color: t.colorScheme.onSurface.withValues(alpha: 0.6)),
                    ),
                  ],
                ),
              ),
              Icon(
                selected
                    ? Icons.radio_button_checked
                    : Icons.radio_button_off,
                color: selected
                    ? t.colorScheme.primary
                    : t.colorScheme.outline,
                size: 20,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SwatchStack extends StatelessWidget {
  const _SwatchStack({required this.colors});
  final List<Color> colors;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 54,
      height: 28,
      child: Stack(
        children: <Widget>[
          for (int i = 0; i < colors.length; i++)
            Positioned(
              left: (i * 14).toDouble(),
              top: 0,
              child: Container(
                width: 28,
                height: 28,
                decoration: BoxDecoration(
                  color: colors[i],
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: Theme.of(context).colorScheme.surface,
                    width: 2,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
