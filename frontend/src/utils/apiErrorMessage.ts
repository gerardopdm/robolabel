import axios from 'axios'

/** Mensaje legible a partir de errores Axios / DRF (detail, campos, HTML 500, etc.). */
export function apiErrorMessage(err: unknown, fallback = 'Ha ocurrido un error.'): string {
  if (!axios.isAxiosError(err)) {
    return err instanceof Error ? err.message : fallback
  }
  const status = err.response?.status
  const data = err.response?.data

  if (typeof data === 'string') {
    const t = data.trim()
    if (t.startsWith('<!') || t.toLowerCase().startsWith('<html')) {
      return status
        ? `Error del servidor (${status}). Si persiste, revisá los logs del backend.`
        : 'Error del servidor.'
    }
    return t.slice(0, 800)
  }

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if ('detail' in data) {
      const detail = (data as { detail: unknown }).detail
      if (typeof detail === 'string') return detail
      if (Array.isArray(detail)) {
        return detail
          .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
          .join(' ')
      }
    }
    const parts: string[] = []
    for (const [k, v] of Object.entries(data)) {
      if (k === 'detail') continue
      if (Array.isArray(v)) parts.push(`${k}: ${v.map(String).join(' ')}`)
      else if (typeof v === 'string') parts.push(`${k}: ${v}`)
    }
    if (parts.length) return parts.join(' · ')
  }

  if (status) {
    return `Error ${status}${err.response?.statusText ? ` (${err.response.statusText})` : ''}`
  }
  return err.message || fallback
}
