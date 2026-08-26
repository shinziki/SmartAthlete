import { createClient } from '@supabase/supabase-js'

// Retrieve environment variables using Vite's import.meta.env
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Initialize the single Supabase client instance
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
