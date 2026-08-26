/**
 * SmartAthlete Material 3 Theme
 *
 * Custom M3 color scheme derived from a teal/green seed color
 * matching the Coach Login design. Uses react-native-paper's
 * MD3 theme system with adaptNavigationTheme for React Navigation
 * integration.
 */

import { Platform } from 'react-native';
import {
  MD3LightTheme,
  MD3DarkTheme,
  adaptNavigationTheme,
} from 'react-native-paper';
import {
  DefaultTheme as NavigationDefaultTheme,
  DarkTheme as NavigationDarkTheme,
} from '@react-navigation/native';
import merge from 'deepmerge';

// ─── Custom M3 Colors ────────────────────────────────────────
// Teal/green palette matching the design screenshot

const customLightColors = {
  primary: '#1B5E3B',
  onPrimary: '#FFFFFF',
  primaryContainer: '#A7F5C5',
  onPrimaryContainer: '#00210E',
  secondary: '#4F6353',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#D2E8D4',
  onSecondaryContainer: '#0D1F13',
  tertiary: '#3A646F',
  onTertiary: '#FFFFFF',
  tertiaryContainer: '#BDE9F6',
  onTertiaryContainer: '#001F27',
  error: '#BA1A1A',
  onError: '#FFFFFF',
  errorContainer: '#FFDAD6',
  onErrorContainer: '#410002',
  background: '#FBFDF8',
  onBackground: '#191C19',
  surface: '#FBFDF8',
  onSurface: '#191C19',
  surfaceVariant: '#DDE5DB',
  onSurfaceVariant: '#414941',
  outline: '#717971',
  outlineVariant: '#C1C9BF',
  shadow: '#000000',
  scrim: '#000000',
  inverseSurface: '#2E312E',
  inverseOnSurface: '#F0F1EC',
  inversePrimary: '#8CD8AA',
  elevation: {
    level0: 'transparent',
    level1: '#EFF5EE',
    level2: '#E8F0E7',
    level3: '#E1ECE0',
    level4: '#DFE9DE',
    level5: '#DAE6D9',
  },
  surfaceDisabled: 'rgba(25, 28, 25, 0.12)',
  onSurfaceDisabled: 'rgba(25, 28, 25, 0.38)',
  backdrop: 'rgba(0, 0, 0, 0.4)',
};

const customDarkColors = {
  primary: '#8CD8AA',
  onPrimary: '#00391C',
  primaryContainer: '#005229',
  onPrimaryContainer: '#A7F5C5',
  secondary: '#B6CCB8',
  onSecondary: '#223527',
  secondaryContainer: '#384B3D',
  onSecondaryContainer: '#D2E8D4',
  tertiary: '#A1CDDA',
  onTertiary: '#003640',
  tertiaryContainer: '#1F4D57',
  onTertiaryContainer: '#BDE9F6',
  error: '#FFB4AB',
  onError: '#690005',
  errorContainer: '#93000A',
  onErrorContainer: '#FFDAD6',
  background: '#191C19',
  onBackground: '#E1E3DE',
  surface: '#191C19',
  onSurface: '#E1E3DE',
  surfaceVariant: '#414941',
  onSurfaceVariant: '#C1C9BF',
  outline: '#8B938A',
  outlineVariant: '#414941',
  shadow: '#000000',
  scrim: '#000000',
  inverseSurface: '#E1E3DE',
  inverseOnSurface: '#191C19',
  inversePrimary: '#1B5E3B',
  elevation: {
    level0: 'transparent',
    level1: '#1F2E22',
    level2: '#233826',
    level3: '#273E2B',
    level4: '#29412D',
    level5: '#2C4530',
  },
  surfaceDisabled: 'rgba(225, 227, 222, 0.12)',
  onSurfaceDisabled: 'rgba(225, 227, 222, 0.38)',
  backdrop: 'rgba(0, 0, 0, 0.4)',
};

// ─── Paper Themes ────────────────────────────────────────────

export const SmartAthleteLightTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    ...customLightColors,
  },
};

export const SmartAthleteDarkTheme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    ...customDarkColors,
  },
};

// ─── Combined Paper + Navigation Themes ──────────────────────

const { LightTheme: AdaptedLightTheme, DarkTheme: AdaptedDarkTheme } =
  adaptNavigationTheme({
    reactNavigationLight: NavigationDefaultTheme,
    reactNavigationDark: NavigationDarkTheme,
  });

export const CombinedLightTheme = merge(AdaptedLightTheme, SmartAthleteLightTheme);
export const CombinedDarkTheme = merge(AdaptedDarkTheme, SmartAthleteDarkTheme);

// ─── Legacy exports (for existing components that use them) ──

const tintColorLight = '#1B5E3B';
const tintColorDark = '#8CD8AA';

export const Colors = {
  light: {
    text: '#191C19',
    background: '#FBFDF8',
    tint: tintColorLight,
    icon: '#717971',
    tabIconDefault: '#717971',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#E1E3DE',
    background: '#191C19',
    tint: tintColorDark,
    icon: '#8B938A',
    tabIconDefault: '#8B938A',
    tabIconSelected: tintColorDark,
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
