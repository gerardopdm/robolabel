import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'

const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

const STORAGE_KEY = 'robolabel_auth'

export function setAuthToken(access: string | null) {
  if (access) {
    api.defaults.headers.common.Authorization = `Bearer ${access}`
  } else {
    delete api.defaults.headers.common.Authorization
  }
}

type SessionExpiredHandler = () => void
let onSessionExpired: SessionExpiredHandler | null = null

export function setSessionExpiredHandler(handler: SessionExpiredHandler | null) {
  onSessionExpired = handler
}

interface QueueItem {
  resolve: (token: string) => void
  reject: (err: unknown) => void
}

let isRefreshing = false
let failedQueue: QueueItem[] = []

function processQueue(error: unknown, token: string | null) {
  failedQueue.forEach((p) => {
    if (token) p.resolve(token)
    else p.reject(error)
  })
  failedQueue = []
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean }

    if (error.response?.status !== 401 || original._retry) {
      return Promise.reject(error)
    }

    const url = original.url ?? ''
    if (url.includes('/auth/login/') || url.includes('/auth/refresh/')) {
      return Promise.reject(error)
    }

    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject })
      }).then((newAccess) => {
        original.headers.Authorization = `Bearer ${newAccess}`
        return api(original)
      })
    }

    original._retry = true
    isRefreshing = true

    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      const stored = raw ? (JSON.parse(raw) as { access: string; refresh: string }) : null
      if (!stored?.refresh) throw new Error('no refresh token')

      const { data } = await axios.post<{ access: string; refresh?: string }>(
        '/api/v1/auth/refresh/',
        { refresh: stored.refresh },
      )

      const newAccess = data.access
      const newRefresh = data.refresh ?? stored.refresh
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ access: newAccess, refresh: newRefresh }))
      setAuthToken(newAccess)

      window.dispatchEvent(
        new CustomEvent('robolabel:tokens-refreshed', {
          detail: { access: newAccess, refresh: newRefresh },
        }),
      )

      processQueue(null, newAccess)
      original.headers.Authorization = `Bearer ${newAccess}`
      return api(original)
    } catch (refreshError) {
      processQueue(refreshError, null)
      localStorage.removeItem(STORAGE_KEY)
      setAuthToken(null)
      onSessionExpired?.()
      return Promise.reject(refreshError)
    } finally {
      isRefreshing = false
    }
  },
)

export default api
