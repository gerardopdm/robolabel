import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import api, { setAuthToken, setSessionExpiredHandler } from '../api/client'

export type User = {
  id: number
  email: string
  first_name: string
  last_name: string
  is_administrador: boolean
  is_asignador: boolean
  is_etiquetador: boolean
  is_validador: boolean
  company: { id: number; name: string }
}

type AuthState = {
  user: User | null
  access: string | null
  refresh: string | null
  loading: boolean
  sessionExpired: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

const STORAGE_KEY = 'robolabel_auth'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [access, setAccess] = useState<string | null>(null)
  const [refresh, setRefresh] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessionExpired, setSessionExpired] = useState(false)

  const clearSession = useCallback(() => {
    setUser(null)
    setAccess(null)
    setRefresh(null)
    setAuthToken(null)
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  useEffect(() => {
    setSessionExpiredHandler(() => {
      clearSession()
      setSessionExpired(true)
    })
    return () => setSessionExpiredHandler(null)
  }, [clearSession])

  useEffect(() => {
    const handler = (e: Event) => {
      const { access: a, refresh: r } = (e as CustomEvent).detail
      setAccess(a)
      setRefresh(r)
    }
    window.addEventListener('robolabel:tokens-refreshed', handler)
    return () => window.removeEventListener('robolabel:tokens-refreshed', handler)
  }, [])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as { access: string; refresh: string }
        setAccess(parsed.access)
        setRefresh(parsed.refresh)
        setAuthToken(parsed.access)
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!access) {
      setUser(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await api.get<User>('/auth/me/')
        if (!cancelled) setUser(data)
      } catch {
        if (!cancelled) clearSession()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [access, clearSession])

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post<{ access: string; refresh: string }>('/auth/login/', {
      email,
      password,
    })
    setAccess(data.access)
    setRefresh(data.refresh)
    setAuthToken(data.access)
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ access: data.access, refresh: data.refresh }))
    const me = await api.get<User>('/auth/me/')
    setUser(me.data)
    setSessionExpired(false)
  }, [])

  const logout = useCallback(() => {
    clearSession()
    setSessionExpired(false)
  }, [clearSession])

  const value = useMemo(
    () => ({ user, access, refresh, loading, sessionExpired, login, logout }),
    [user, access, refresh, loading, sessionExpired, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth fuera de AuthProvider')
  return ctx
}
