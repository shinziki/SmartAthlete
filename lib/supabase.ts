import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import 'react-native-url-polyfill/auto';

// Retrieve your environment variables safely
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * React Native's fetch has no timeout. A request started while the connection drops
 * (e.g. the background token refresh) can then hang forever, and every later auth call
 * waits behind it, leaving screens on "Loading…" even after the internet comes back.
 */
const REQUEST_TIMEOUT_MS = 15_000;

const fetchWithTimeout: typeof fetch = (input, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  // Keep any abort signal the caller passed
  init?.signal?.addEventListener?.('abort', () => controller.abort());
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
};

// Initialize and export the client instance
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        storage: AsyncStorage as any, // Persists user sessions on the mobile device
        autoRefreshToken: true,        // Automatically refreshes expired auth tokens
        persistSession: true,
        detectSessionInUrl: false,     // Required false: Mobile apps lack a standard web URL bar
    },
    global: { fetch: fetchWithTimeout },
});

// Supabase's guidance for React Native: refresh tokens only while the app is in the
// foreground, and resume refreshing as soon as it returns.
AppState.addEventListener('change', (state) => {
    if (state === 'active') {
        supabase.auth.startAutoRefresh();
    } else {
        supabase.auth.stopAutoRefresh();
    }
});
