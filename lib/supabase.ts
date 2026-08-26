import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

// Retrieve your environment variables safely
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// Initialize and export the client instance
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        storage: AsyncStorage as any, // Persists user sessions on the mobile device
        autoRefreshToken: true,        // Automatically refreshes expired auth tokens
        persistSession: true,
        detectSessionInUrl: false,     // Required false: Mobile apps lack a standard web URL bar
    },
});