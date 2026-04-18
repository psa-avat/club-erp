import axios, { AxiosError } from 'axios'

import { useAuthStore } from '../auth/store/authStore'

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
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
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
