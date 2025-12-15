import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { supabase, User, Session } from './supabase'
import toast from 'react-hot-toast'

interface AuthContextType {
  user: User | null
  session: Session | null
  login: (pin: string) => Promise<boolean>
  logout: () => void
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Check for existing session on mount
    checkSession()
  }, [])

  const checkSession = async () => {
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession()
      
      if (currentSession?.user) {
        // Get user details from our users table
        const { data: userData, error } = await supabase
          .from('users')
          .select('*')
          .eq('id', currentSession.user.id)
          .single()

        if (error) throw error

        setUser(userData)
        setSession(currentSession as any)
      }
    } catch (error) {
      console.error('Session check error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const login = async (pin: string): Promise<boolean> => {
    try {
      setIsLoading(true)

      // Find user by PIN
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('pin_hash', pin) // In production, hash the PIN
        .single()

      if (userError || !userData) {
        toast.error('Invalid PIN')
        return false
      }

      // Check if user is active
      if (!userData.active) {
        toast.error('Your account is inactive. Please contact an administrator.')
        return false
      }

      // Create session record
      const { data: sessionData, error: sessionError } = await supabase
        .from('sessions')
        .insert({
          user_id: userData.id,
          created_at: new Date().toISOString()
        })
        .select()
        .single()

      if (sessionError) throw sessionError

      setUser(userData)
      setSession(sessionData)
      
      toast.success(`Welcome, ${userData.name}`)
      return true
    } catch (error) {
      console.error('Login error:', error)
      toast.error('Login failed')
      return false
    } finally {
      setIsLoading(false)
    }
  }

  const logout = async () => {
    try {
      if (session) {
        // End the session
        await supabase
          .from('sessions')
          .update({ ended_at: new Date().toISOString() })
          .eq('id', session.id)
      }
    } catch (error) {
      console.error('Logout error:', error)
    } finally {
      setUser(null)
      setSession(null)
      toast.success('Logged out')
    }
  }

  return (
    <AuthContext.Provider value={{ user, session, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
