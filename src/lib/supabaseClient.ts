import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Vite automatically exposes VITE_* prefixed environment variables via import.meta.env
// @ts-ignore - Vite environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co'

// @ts-ignore - Vite environment variables  
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key'

// Singleton pattern to prevent multiple GoTrueClient instances
let supabaseClientInstance: SupabaseClient | null = null

/**
 * Get or create a singleton Supabase client instance
 * This prevents the "Multiple GoTrueClient instances detected" warning
 */
export function getSupabaseClient(): SupabaseClient {
  // Check global scope first (prevents React StrictMode duplicates)
  if (typeof window !== 'undefined' && (window as any).__sigmaSupabaseClient) {
    return (window as any).__sigmaSupabaseClient
  }

  if (!supabaseClientInstance) {
    console.log('[Supabase] Creating singleton client instance')
    
    supabaseClientInstance = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        storageKey: 'sigma-auth-v1', // Stable, unique storage key
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      },
      global: {
        headers: {
          'x-client-info': 'sigma-app@1.0.0'
        }
      }
    })

    // Store in global scope to prevent React StrictMode from creating duplicates
    if (typeof window !== 'undefined') {
      (window as any).__sigmaSupabaseClient = supabaseClientInstance
    }
  }

  return supabaseClientInstance
}

// Export the singleton instance
export const supabase = getSupabaseClient()

// Helper to get the logo URL from Supabase Storage
// Always returns Supabase Storage URL to avoid 404s on Vercel
export function getLogoUrl(): string {
  // HARDCODED: Always return the Supabase Storage URL directly
  // This prevents any possibility of Vercel paths or local paths being used
  const SUPABASE_LOGO_URL = 'https://rfzkpgtancqsjxivrnts.supabase.co/storage/v1/object/public/assets/logo-sigma.png'
  
  // Log for debugging - check browser console to verify this URL is being used
  if (typeof window !== 'undefined') {
    console.log('[Logo] getLogoUrl() returning:', SUPABASE_LOGO_URL)
  }
  
  return SUPABASE_LOGO_URL
}

