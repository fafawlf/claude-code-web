import 'package:flutter/material.dart';

/// Five named skins mirrored from `web/src/skins.ts`. Each maps to the same
/// CSS custom-property token set the web app exposes, just expressed as Dart
/// Color fields so we can bake them into a ThemeData.
enum SkinId { warm, cyberpunk, wechat, catgirl, emochi }

const SkinId kDefaultSkin = SkinId.warm;

String skinIdToString(SkinId id) => id.name;

SkinId? skinIdFromString(String? s) {
  for (final SkinId id in SkinId.values) {
    if (id.name == s) return id;
  }
  return null;
}

/// Token set for one skin. Field names intentionally mirror the CSS variables
/// on the web side so porting components is mechanical.
class SkinPalette {
  const SkinPalette({
    required this.id,
    required this.label,
    required this.hint,
    required this.swatches,
    required this.bgBase,
    required this.bgRaised,
    required this.bgSurface,
    required this.bgHover,
    required this.bgAccentSoft,
    required this.borderSubtle,
    required this.borderDefault,
    required this.textPrimary,
    required this.textSecondary,
    required this.textMuted,
    required this.textInverse,
    required this.accent,
    required this.accentHi,
    required this.accentLo,
    required this.success,
    required this.warning,
    required this.danger,
    required this.brightness,
    this.skinBgGradient,
    this.overlayStripes = false,
    this.fontFamily,
  });

  final SkinId id;
  final String label;
  final String hint;
  final List<Color> swatches;

  final Color bgBase;
  final Color bgRaised;
  final Color bgSurface;
  final Color bgHover;
  final Color bgAccentSoft;

  final Color borderSubtle;
  final Color borderDefault;

  final Color textPrimary;
  final Color textSecondary;
  final Color textMuted;
  final Color textInverse;

  final Color accent;
  final Color accentHi;
  final Color accentLo;

  final Color success;
  final Color warning;
  final Color danger;

  final Brightness brightness;

  /// Optional radial/linear gradient layered behind the scaffold.
  final Gradient? skinBgGradient;

  /// Cyberpunk-style scanline overlay flag.
  final bool overlayStripes;

  /// Only set when the skin intentionally deviates from the system sans
  /// (e.g. cyberpunk → monospace, catgirl/emochi → rounded).
  final String? fontFamily;
}

/// Constants so callers can swatch-preview without constructing the whole
/// palette.
const List<SkinId> kAllSkinIds = SkinId.values;

const Map<SkinId, List<Color>> kSkinSwatches = <SkinId, List<Color>>{
  SkinId.warm: <Color>[Color(0xFF19161A), Color(0xFFD97757), Color(0xFFF0E8D9)],
  SkinId.cyberpunk: <Color>[
    Color(0xFF080B10),
    Color(0xFFF6FF00),
    Color(0xFF00E7FF)
  ],
  SkinId.wechat: <Color>[
    Color(0xFFF5F5F5),
    Color(0xFF07C160),
    Color(0xFF2E3238)
  ],
  SkinId.catgirl: <Color>[
    Color(0xFFFFFAFD),
    Color(0xFFF0A8C8),
    Color(0xFFA8D8C8)
  ],
  SkinId.emochi: <Color>[
    Color(0xFF121212),
    Color(0xFFFFEB00),
    Color(0xFFFFFFFF)
  ],
};

const Map<SkinId, String> kSkinLabels = <SkinId, String>{
  SkinId.warm: 'Warm dusk',
  SkinId.cyberpunk: 'Cyberpunk',
  SkinId.wechat: 'DevChat',
  SkinId.catgirl: 'Catgirl',
  SkinId.emochi: 'Emochi',
};

const Map<SkinId, String> kSkinHints = <SkinId, String>{
  SkinId.warm: 'default focused workspace',
  SkinId.cyberpunk: 'neon terminal deck',
  SkinId.wechat: 'light chat bubbles',
  SkinId.catgirl: 'pastel cute desk',
  SkinId.emochi: 'bold mochi code buddy',
};

SkinPalette paletteFor(SkinId id) {
  switch (id) {
    case SkinId.warm:
      return const SkinPalette(
        id: SkinId.warm,
        label: 'Warm dusk',
        hint: 'default focused workspace',
        swatches: <Color>[
          Color(0xFF19161A),
          Color(0xFFD97757),
          Color(0xFFF0E8D9)
        ],
        bgBase: Color(0xFF19161A),
        bgRaised: Color(0xFF22201E),
        bgSurface: Color(0xFF2A2724),
        bgHover: Color(0xFF332F2A),
        bgAccentSoft: Color(0xFF39241C),
        borderSubtle: Color(0xFF2F2B27),
        borderDefault: Color(0xFF3F3830),
        textPrimary: Color(0xFFF0E8D9),
        textSecondary: Color(0xFFB5A898),
        textMuted: Color(0xFF7A7065),
        textInverse: Color(0xFF1A1714),
        accent: Color(0xFFD97757),
        accentHi: Color(0xFFE28B70),
        accentLo: Color(0xFFB85F44),
        success: Color(0xFF8AA876),
        warning: Color(0xFFD4A95E),
        danger: Color(0xFFC66A4F),
        brightness: Brightness.dark,
      );
    case SkinId.cyberpunk:
      return const SkinPalette(
        id: SkinId.cyberpunk,
        label: 'Cyberpunk',
        hint: 'neon terminal deck',
        swatches: <Color>[
          Color(0xFF080B10),
          Color(0xFFF6FF00),
          Color(0xFF00E7FF)
        ],
        bgBase: Color(0xFF080B10),
        bgRaised: Color(0xFF0E1218),
        bgSurface: Color(0xFF121820),
        bgHover: Color(0xFF1B2530),
        bgAccentSoft: Color(0xFF1C2106),
        borderSubtle: Color(0xFF18313A),
        borderDefault: Color(0xFF2B5965),
        textPrimary: Color(0xFFE7FAFF),
        textSecondary: Color(0xFF9AFFCF),
        textMuted: Color(0xFF5F7880),
        textInverse: Color(0xFF07090C),
        accent: Color(0xFFF6FF00),
        accentHi: Color(0xFF00E7FF),
        accentLo: Color(0xFFFF2E88),
        success: Color(0xFF9AFFCF),
        warning: Color(0xFFF6FF00),
        danger: Color(0xFFFF5C93),
        brightness: Brightness.dark,
        skinBgGradient: RadialGradient(
          center: Alignment(-0.7, -0.75),
          radius: 1.1,
          colors: <Color>[Color(0x2300E7FF), Color(0x00080B10)],
        ),
        overlayStripes: true,
        fontFamily: 'monospace',
      );
    case SkinId.wechat:
      return const SkinPalette(
        id: SkinId.wechat,
        label: 'DevChat',
        hint: 'light chat bubbles',
        swatches: <Color>[
          Color(0xFFF5F5F5),
          Color(0xFF07C160),
          Color(0xFF2E3238)
        ],
        bgBase: Color(0xFFEDEDED),
        bgRaised: Color(0xFFF7F7F7),
        bgSurface: Color(0xFFFFFFFF),
        bgHover: Color(0xFFE6E6E6),
        bgAccentSoft: Color(0xFFE7F7EC),
        borderSubtle: Color(0xFFDEDEDE),
        borderDefault: Color(0xFFCFCFCF),
        textPrimary: Color(0xFF181818),
        textSecondary: Color(0xFF4A4F55),
        textMuted: Color(0xFF858585),
        textInverse: Color(0xFFFFFFFF),
        accent: Color(0xFF07C160),
        accentHi: Color(0xFF04A94D),
        accentLo: Color(0xFF2E3238),
        success: Color(0xFF07C160),
        warning: Color(0xFFD49B26),
        danger: Color(0xFFFA5151),
        brightness: Brightness.light,
      );
    case SkinId.catgirl:
      return const SkinPalette(
        id: SkinId.catgirl,
        label: 'Catgirl',
        hint: 'pastel cute desk',
        swatches: <Color>[
          Color(0xFFFFFAFD),
          Color(0xFFF0A8C8),
          Color(0xFFA8D8C8)
        ],
        bgBase: Color(0xFFFFFAFD),
        bgRaised: Color(0xFFFFF4FA),
        bgSurface: Color(0xFFFFFFFF),
        bgHover: Color(0xFFFFEEF6),
        bgAccentSoft: Color(0xFFFFF0F7),
        borderSubtle: Color(0xFFF5D7E4),
        borderDefault: Color(0xFFE8B0C8),
        textPrimary: Color(0xFF5F3D5C),
        textSecondary: Color(0xFF8A637E),
        textMuted: Color(0xFFBD8CA6),
        textInverse: Color(0xFFFFFAFD),
        accent: Color(0xFFF0A8C8),
        accentHi: Color(0xFFB86A92),
        accentLo: Color(0xFFA8D8C8),
        success: Color(0xFF74BCA0),
        warning: Color(0xFFE3A84F),
        danger: Color(0xFFDC6F91),
        brightness: Brightness.light,
        skinBgGradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: <Color>[Color(0xFFFFE4F1), Color(0xFFFFFAFD), Color(0xFFD8F5EA)],
        ),
      );
    case SkinId.emochi:
      return const SkinPalette(
        id: SkinId.emochi,
        label: 'Emochi',
        hint: 'bold mochi code buddy',
        swatches: <Color>[
          Color(0xFF121212),
          Color(0xFFFFEB00),
          Color(0xFFFFFFFF)
        ],
        bgBase: Color(0xFF121212),
        bgRaised: Color(0xFF1B1B1B),
        bgSurface: Color(0xFF262626),
        bgHover: Color(0xFF303030),
        bgAccentSoft: Color(0xFF3C3800),
        borderSubtle: Color(0xFF2E2E2E),
        borderDefault: Color(0xFF000000),
        textPrimary: Color(0xFFF4F4F4),
        textSecondary: Color(0xFFCFCFCF),
        textMuted: Color(0xFF8A8A8A),
        textInverse: Color(0xFF0A0A0A),
        accent: Color(0xFFFFEB00),
        accentHi: Color(0xFFFFF26B),
        accentLo: Color(0xFFE8D400),
        success: Color(0xFFB8F0C0),
        warning: Color(0xFFFFEB00),
        danger: Color(0xFFFF7B7B),
        brightness: Brightness.dark,
        skinBgGradient: RadialGradient(
          center: Alignment(-0.68, -0.65),
          radius: 1.2,
          colors: <Color>[Color(0x1FFFEB00), Color(0x00121212)],
        ),
      );
  }
}
