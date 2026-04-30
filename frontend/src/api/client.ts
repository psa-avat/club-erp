import axios, { AxiosError } from 'axios'

import { useAuthStore } from '../auth/store/authStore'

function getPersistedToken(): string | null {
  try {
    const raw = sessionStorage.getItem('club-erp-auth')
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as { state?: { token?: string | null } }
    return parsed.state?.token ?? null
  } catch {
    return null
  }
}

export function getAuthToken(): string | null {
  const token = useAuthStore.getState().token ?? getPersistedToken()
  const normalizedToken = token?.trim()
  return normalizedToken && normalizedToken.length > 0 ? normalizedToken : null
}

export function getAuthRequestConfig() {
  const token = getAuthToken()
  return token
    ? {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    : undefined
}

const configuredApiBaseUrl = import.meta.env.VITE_API_URL?.trim()
const resolvedApiBaseUrl = configuredApiBaseUrl && configuredApiBaseUrl.length > 0
  ? configuredApiBaseUrl
  : window.location.origin

export const apiClient = axios.create({
  baseURL: resolvedApiBaseUrl,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
})

apiClient.interceptors.request.use((config) => {
  const normalizedToken = getAuthToken()

  // Let the browser set multipart boundaries for FormData payloads.
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    if (config.headers && typeof config.headers.delete === 'function') {
      config.headers.delete('Content-Type')
    } else if (config.headers) {
      delete config.headers['Content-Type']
    }
  }

  if (normalizedToken) {
    if (config.headers && typeof config.headers.set === 'function') {
      config.headers.set('Authorization', `Bearer ${normalizedToken}`)
    } else {
      config.headers = config.headers ?? {}
      config.headers.Authorization = `Bearer ${normalizedToken}`
    }
  }

  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().clearSession()
    }

    return Promise.reject(error)
  },
)
