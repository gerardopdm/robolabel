import axios from 'axios'

const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

export function setAuthToken(access: string | null) {
  if (access) {
    api.defaults.headers.common.Authorization = `Bearer ${access}`
  } else {
    delete api.defaults.headers.common.Authorization
  }
}

export default api
