/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';

export type ColorScheme = 'default' | '1one-cyber' | '1one-volcanic' | '1one-forest' | '1one-aurora' | '1one-moonlight';

const DEFAULT_COLOR_SCHEME: ColorScheme = 'default';
const COLOR_SCHEME_CACHE_KEY = '__1one_colorScheme';

const initColorScheme = async (): Promise<ColorScheme> => {
  try {
    let initialScheme: ColorScheme = DEFAULT_COLOR_SCHEME;
    try {
      const cached = localStorage.getItem(COLOR_SCHEME_CACHE_KEY) as ColorScheme | null;
      if (cached) {
        initialScheme = cached;
      }
    } catch {
      /* noop */
    }
    document.documentElement.setAttribute('data-color-scheme', initialScheme);
    return initialScheme;
  } catch (error) {
    console.error('Failed to load initial color scheme:', error);
    document.documentElement.setAttribute('data-color-scheme', DEFAULT_COLOR_SCHEME);
    return DEFAULT_COLOR_SCHEME;
  }
};

let initialColorSchemePromise: Promise<ColorScheme> | null = null;
if (typeof window !== 'undefined') {
  initialColorSchemePromise = initColorScheme();
}

const useColorScheme = (): [ColorScheme, (scheme: ColorScheme) => Promise<void>] => {
  const [colorScheme, setColorSchemeState] = useState<ColorScheme>(DEFAULT_COLOR_SCHEME);

  const applyColorScheme = useCallback((newScheme: ColorScheme) => {
    document.documentElement.setAttribute('data-color-scheme', newScheme);
    try {
      localStorage.setItem(COLOR_SCHEME_CACHE_KEY, newScheme);
    } catch {
      /* noop */
    }
  }, []);

  const setColorScheme = useCallback(
    async (newScheme: ColorScheme) => {
      try {
        setColorSchemeState(newScheme);
        applyColorScheme(newScheme);
      } catch (error) {
        console.error('Failed to save color scheme:', error);
        setColorSchemeState(colorScheme);
        applyColorScheme(colorScheme);
      }
    },
    [colorScheme, applyColorScheme]
  );

  useEffect(() => {
    if (initialColorSchemePromise) {
      initialColorSchemePromise
        .then((initialScheme) => {
          setColorSchemeState(initialScheme);
        })
        .catch((error) => {
          console.error('Failed to initialize color scheme:', error);
        });
    }
  }, []);

  return [colorScheme, setColorScheme];
};

export default useColorScheme;
