import 'package:flutter/material.dart';

import 'skin_palette.dart';

/// Build a [ThemeData] from a skin palette. Keeps color logic in one place so
/// every screen inherits the same treatment without having to look at the
/// palette directly.
ThemeData themeFromPalette(SkinPalette p) {
  final ColorScheme scheme = ColorScheme(
    brightness: p.brightness,
    primary: p.accent,
    onPrimary: p.textInverse,
    primaryContainer: p.bgAccentSoft,
    onPrimaryContainer: p.textPrimary,
    secondary: p.accentHi,
    onSecondary: p.textInverse,
    secondaryContainer: p.bgRaised,
    onSecondaryContainer: p.textPrimary,
    tertiary: p.accentLo,
    onTertiary: p.textInverse,
    tertiaryContainer: p.bgSurface,
    onTertiaryContainer: p.textPrimary,
    error: p.danger,
    onError: p.textInverse,
    errorContainer: Color.alphaBlend(
        p.danger.withValues(alpha: 0.18), p.bgRaised),
    onErrorContainer: p.danger,
    surface: p.bgSurface,
    onSurface: p.textPrimary,
    surfaceContainerHighest: p.bgHover,
    surfaceContainer: p.bgRaised,
    surfaceContainerLow: p.bgRaised,
    surfaceContainerLowest: p.bgBase,
    outline: p.borderDefault,
    outlineVariant: p.borderSubtle,
  );

  final TextTheme baseText = ThemeData(brightness: p.brightness).textTheme;
  final TextTheme text = baseText
      .apply(
        bodyColor: p.textPrimary,
        displayColor: p.textPrimary,
        fontFamily: p.fontFamily,
      )
      .copyWith(
        bodySmall: baseText.bodySmall?.copyWith(color: p.textMuted),
        labelSmall: baseText.labelSmall?.copyWith(color: p.textMuted),
      );

  return ThemeData(
    useMaterial3: true,
    brightness: p.brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor: p.bgBase,
    canvasColor: p.bgBase,
    dividerColor: p.borderSubtle,
    textTheme: text,
    fontFamily: p.fontFamily,
    iconTheme: IconThemeData(color: p.textSecondary),
    primaryIconTheme: IconThemeData(color: p.accent),
    appBarTheme: AppBarTheme(
      backgroundColor: p.bgRaised,
      foregroundColor: p.textPrimary,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(
        color: p.textPrimary,
        fontWeight: FontWeight.w600,
        fontSize: 16,
        fontFamily: p.fontFamily,
      ),
      iconTheme: IconThemeData(color: p.textSecondary),
    ),
    cardTheme: CardThemeData(
      color: p.bgSurface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: p.borderSubtle),
      ),
      margin: EdgeInsets.zero,
    ),
    dividerTheme: DividerThemeData(
      color: p.borderSubtle,
      thickness: 1,
      space: 1,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: p.bgSurface,
      hintStyle: TextStyle(color: p.textMuted),
      labelStyle: TextStyle(color: p.textSecondary),
      contentPadding:
          const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: BorderSide(color: p.borderSubtle),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: BorderSide(color: p.accent, width: 1.6),
      ),
      disabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: BorderSide(color: p.borderSubtle.withValues(alpha: 0.6)),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: BorderSide(color: p.danger),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: p.accent,
        foregroundColor: p.textInverse,
        disabledBackgroundColor: p.borderSubtle,
        disabledForegroundColor: p.textMuted,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10),
        ),
        textStyle: TextStyle(
          fontWeight: FontWeight.w600,
          fontFamily: p.fontFamily,
        ),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: p.textPrimary,
        side: BorderSide(color: p.borderDefault),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10),
        ),
        textStyle: TextStyle(fontFamily: p.fontFamily),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: p.accent,
        textStyle: TextStyle(fontFamily: p.fontFamily),
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(
        foregroundColor: p.textSecondary,
      ),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: p.bgSurface,
      contentTextStyle: TextStyle(color: p.textPrimary),
      actionTextColor: p.accent,
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
      ),
    ),
    drawerTheme: DrawerThemeData(
      backgroundColor: p.bgRaised,
      surfaceTintColor: Colors.transparent,
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: p.bgRaised,
      surfaceTintColor: Colors.transparent,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      modalBackgroundColor: p.bgRaised,
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: p.bgSurface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
      ),
    ),
    listTileTheme: ListTileThemeData(
      iconColor: p.textSecondary,
      textColor: p.textPrimary,
      selectedColor: p.accent,
      selectedTileColor: p.bgHover,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
      ),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith((Set<WidgetState> s) =>
          s.contains(WidgetState.selected) ? p.accent : p.textMuted),
      trackColor: WidgetStateProperty.resolveWith((Set<WidgetState> s) =>
          s.contains(WidgetState.selected)
              ? p.accent.withValues(alpha: 0.4)
              : p.borderDefault),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: p.accent),
    popupMenuTheme: PopupMenuThemeData(
      color: p.bgSurface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: BorderSide(color: p.borderSubtle),
      ),
    ),
  );
}
