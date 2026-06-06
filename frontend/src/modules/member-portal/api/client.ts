import axios from 'axios'

const PORTAL_TOKEN_KEY = 'club-erp-member-portal-token'
const PORTAL_PROFILE_KEY = 'club-erp-member-portal-profile'

const configuredApiBaseUrl = import.meta.env.VITE_API_URL?.trim()
const resolvedApiBaseUrl =
  configuredApiBaseUrl && configuredApiBaseUrl.length > 0
    ? configuredApiBaseUrl
    : window.location.origin

export function getPortalToken(): string | null {
  return sessionStorage.getItem(PORTAL_TOKEN_KEY)
}

export function setPortalToken(token: string): void {
  sessionStorage.setItem(PORTAL_TOKEN_KEY, token)
}

export function clearPortalToken(): void {
  sessionStorage.removeItem(PORTAL_TOKEN_KEY)
  sessionStorage.removeItem(PORTAL_PROFILE_KEY)
}

export function getPortalProfile<T>(): T | null {
  try {
    const raw = sessionStorage.getItem(PORTAL_PROFILE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function setPortalProfile(profile: unknown): void {
  sessionStorage.setItem(PORTAL_PROFILE_KEY, JSON.stringify(profile))
}

export function isPortalAuthenticated(): boolean {
  return getPortalToken() !== null
}

export const portalApiClient = axios.create({
  baseURL: resolvedApiBaseUrl,
  withCredentials: false,
  headers: { 'Content-Type': 'application/json' },
})

portalApiClient.interceptors.request.use((config) => {
  const token = getPortalToken()
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`)
  }
  return config
})

portalApiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      clearPortalToken()
      window.location.href = '/member-portal/login'
    }
    return Promise.reject(error)
  },
)
