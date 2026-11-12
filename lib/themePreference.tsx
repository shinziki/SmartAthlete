import { useColorScheme } from '@/hooks/use-color-scheme';
import * as SecureStore from 'expo-secure-store';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'smartathlete_theme_preference';

interface ThemePreferenceValue {
  /** What the user picked (system follows the phone setting). */
  preference: ThemePreference;
  /** The scheme actually in use. */
  scheme: 'light' | 'dark';
  setPreference: (p: ThemePreference) => void;
  /** Flips between light and dark based on what is currently shown. */
  toggleScheme: () => void;
}

const ThemePreferenceContext = createContext<ThemePreferenceValue>({
  preference: 'system',
  scheme: 'light',
  setPreference: () => undefined,
  toggleScheme: () => undefined,
});

export function ThemePreferenceProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    SecureStore.getItemAsync(STORAGE_KEY)
      .then((v) => {
        if (v === 'light' || v === 'dark' || v === 'system') setPreferenceState(v);
      })
      .catch(() => undefined);
  }, []);

  const setPreference = useCallback((p: ThemePreference) => {
    setPreferenceState(p);
    SecureStore.setItemAsync(STORAGE_KEY, p).catch(() => undefined);
  }, []);

  const scheme: 'light' | 'dark' =
    preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;

  const toggleScheme = useCallback(
    () => setPreference(scheme === 'dark' ? 'light' : 'dark'),
    [scheme, setPreference]
  );

  const value = useMemo(
    () => ({ preference, scheme, setPreference, toggleScheme }),
    [preference, scheme, setPreference, toggleScheme]
  );

  return <ThemePreferenceContext.Provider value={value}>{children}</ThemePreferenceContext.Provider>;
}

export function useThemePreference() {
  return useContext(ThemePreferenceContext);
}

