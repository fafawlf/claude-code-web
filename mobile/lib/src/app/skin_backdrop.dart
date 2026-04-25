import 'package:flutter/material.dart';

import '../theme/skin_palette.dart';

/// Paints the skin-specific background gradient + optional scanline overlay
/// behind its child. Mirrors the CSS `--skin-bg-image` and `body::before`
/// overlay from the web app.
class SkinBackdrop extends StatelessWidget {
  const SkinBackdrop({super.key, required this.palette, required this.child});

  final SkinPalette palette;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: <Widget>[
        // Base color always paints — gradient layers on top when present.
        Positioned.fill(
          child: DecoratedBox(
            decoration: BoxDecoration(color: palette.bgBase),
          ),
        ),
        if (palette.skinBgGradient != null)
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(gradient: palette.skinBgGradient),
            ),
          ),
        child,
        if (palette.overlayStripes)
          const IgnorePointer(child: _ScanlineOverlay()),
      ],
    );
  }
}

class _ScanlineOverlay extends StatelessWidget {
  const _ScanlineOverlay();

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: _ScanlinePainter(),
      size: Size.infinite,
    );
  }
}

class _ScanlinePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final Paint paint = Paint()
      ..color = const Color(0x0BFFFFFF)
      ..strokeWidth = 1;
    for (double y = 0; y < size.height; y += 3) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
