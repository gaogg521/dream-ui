/**
 * Copyright 2026 One Work
 */

// context/ThemeContext.tsx - Unified Theme Management Context 统一主题管理上下文
import type { PropsWithChildren } from 'react';
import React, { createContext, useCallback, useContext } from 'react';
import type { Theme, ThemeAppearance } from '@/common/theme/types';
import useTheme from '@renderer/hooks/system/useTheme';
import { LIGHT_THEME_ID, DARK_THEME_ID } from '@/common/theme/constants';
import useFontScale from '@renderer/hooks/ui/font/useFontScale';
import useFontSizes from '@renderer/hooks/ui/font/useFontSizes';
import useFontFamilies from '@renderer/hooks/ui/font/useFontFamilies';
import useFontWeights from '@renderer/hooks/ui/font/useFontWeights';
import type { FontSizeKey, FontSizes } from '@/common/config/fontSizes';
import type { FontFamilyKey, FontFamilies } from '@/common/config/fontFamilies';
import type { FontWeightKey, FontWeights } from '@/common/config/fontWeights';
import type { ColorScheme } from '@renderer/hooks/ui/useColorScheme';
import useColorScheme from '@renderer/hooks/ui/useColorScheme';

interface ThemeContextValue {
  theme: ThemeAppearance;
  setTheme: (appearance: ThemeAppearance) => Promise<void>;
  activeTheme: Theme | null;
  activeId: string | null;
  selectTheme: (id: string) => Promise<void>;
  colorScheme: ColorScheme;
  setColorScheme: (scheme: ColorScheme) => Promise<void>;
  fontScale: number;
  setFontScale: (scale: number) => Promise<void>;
  fontSizes: FontSizes;
  setFontSize: (key: FontSizeKey, px: number) => Promise<void>;
  // Per-region font families ('' means "no override — use the built-in default stack")
  fontFamilies: FontFamilies;
  setFontFamily: (key: FontFamilyKey, family: string) => Promise<void>;
  // Per-region font weights ('' means "no override — inherit the surrounding weight")
  fontWeights: FontWeights;
  setFontWeight: (key: FontWeightKey, weight: string) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const ThemeProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [activeTheme, selectTheme, activeId] = useTheme();
  const [colorScheme, setColorScheme] = useColorScheme();
  const [fontScale, setFontScale] = useFontScale();
  const { fontSizes, setFontSize } = useFontSizes();
  const { fontFamilies, setFontFamily } = useFontFamilies();
  const { fontWeights, setFontWeight } = useFontWeights();
  const theme: ThemeAppearance = activeTheme?.appearance ?? 'light';
  const setTheme = useCallback(
    (appearance: ThemeAppearance) => selectTheme(appearance === 'dark' ? DARK_THEME_ID : LIGHT_THEME_ID),
    [selectTheme]
  );

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme,
        activeTheme,
        activeId,
        selectTheme,
        colorScheme,
        setColorScheme,
        fontScale,
        setFontScale,
        fontSizes,
        setFontSize,
        fontFamilies,
        setFontFamily,
        fontWeights,
        setFontWeight,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useThemeContext = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useThemeContext must be used within ThemeProvider');
  }
  return context;
};
