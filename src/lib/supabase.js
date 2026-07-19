import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  // Helpful message during local dev if .env isn't set up yet.
  console.warn(
    '[Supabase] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. ' +
      'Copy .env.example to .env and fill in your project values.'
  )
}

// ---- "Remember me" storage -------------------------------------------
// When enabled, the session lives in localStorage (survives browser restart).
// When disabled, it lives in sessionStorage (cleared when the tab closes).
// Call setRememberMe(value) before signing in.
const REMEMBER_KEY = 'nt-remember-me'

export function setRememberMe(value) {
  try {
    localStorage.setItem(REMEMBER_KEY, value ? 'true' : 'false')
  } catch {
    /* ignore (e.g. Safari private mode) */
  }
}

function rememberEnabled() {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== 'false'
  } catch {
    return true
  }
}

const hybridStorage = {
  getItem: (key) => {
    try {
      return localStorage.getItem(key) ?? sessionStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem: (key, value) => {
    try {
      if (rememberEnabled()) {
        localStorage.setItem(key, value)
        sessionStorage.removeItem(key)
      } else {
        sessionStorage.setItem(key, value)
        localStorage.removeItem(key)
      }
    } catch {
      /* ignore */
    }
  },
  removeItem: (key) => {
    try {
      localStorage.removeItem(key)
      sessionStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  },
}

// Fall back to harmless placeholders so the app still renders (login screen)
// instead of crashing when .env isn't configured yet. Auth calls will simply
// fail until real values are provided.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: hybridStorage,
    },
  }
)
